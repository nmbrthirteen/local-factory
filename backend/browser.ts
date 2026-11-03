import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { parseCommand } from '../shared/commands';
import { type JsonArguments, jsonObjectSchema } from '../shared/json';
import type { PreviewShot, Task } from '../shared/types';
import { type Failure, thrownSchema } from './failure';
import {
  type App,
  agentBrowser,
  type Browser,
  lines,
  loadPage,
  pageErrors,
  resolvePreview,
  screenshot,
  startApp,
} from './preview';

const textLimit = 12_000;
const logLines = 80;

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; shot: PreviewShot };

export type ToolResult = { content: ToolContent[]; error?: boolean };

type SessionOptions = {
  task: Pick<Task, 'id' | 'preview'>;
  cwd: string;
  root: string;
  servicePort?: number;
  browser?: Browser;
};

const text = (value: string): ToolContent => ({ type: 'text', text: value.slice(-textLimit) });
const failed = (value: string): ToolResult => ({ content: [text(value)], error: true });
const leftApp = (url: string) => `The page left the app at ${url}. Call preview_open to load a page on the app.`;

const commandFailure = (failure: Failure) => failed(failure.stderr?.trim() || failure.message);

// The agent's own shell stays offline, so the factory runs the app and the browser for it and hands back what they show.
export class PreviewSession {
  private readonly task: Pick<Task, 'id' | 'preview'>;
  private readonly cwd: string;
  private readonly root: string;
  private readonly blockedPorts: number[];
  private readonly browser: Browser;
  private readonly session: string;
  private app: App | null = null;
  private origin = '';
  private command: string[] = [];
  private viewport: 'desktop' | 'mobile' = 'desktop';

  constructor({ task, cwd, root, servicePort, browser = agentBrowser }: SessionOptions) {
    this.task = task;
    this.cwd = cwd;
    this.root = root;
    this.blockedPorts = servicePort ? [servicePort] : [];
    this.browser = browser;
    this.session = `factory-agent-${task.id}`;
  }

  private get scratch() {
    return join(this.root, '.factory/sandbox', this.task.id, 'preview');
  }

  private readonly page: Browser = (session, args) => this.browser(session, args, this.origin);

  // The page runs code the agent wrote and can navigate itself, so nothing acts on it once it has left the app.
  private async onApp() {
    const current = (await this.page(this.session, ['get', 'url']).catch(() => '')).trim();

    return URL.canParse(current) && new URL(current).origin === this.origin;
  }

  private async switchOrigin(url: string) {
    const { origin } = new URL(url);

    if (origin === this.origin) return;
    await this.page(this.session, ['close']).catch(() => undefined);
    this.origin = origin;
  }

  async open({
    path = '/',
    command = '',
    restart = false,
  }: {
    path?: string;
    command?: string;
    restart?: boolean;
  }): Promise<ToolResult> {
    const next = command.trim()
      ? parseCommand(command)
      : this.command.length
        ? this.command
        : (await resolvePreview(this.cwd, '', this.task.preview)).command;

    if (!next.length) return failed('No start command found. Pass command, for example npm run dev.');

    if (restart || !this.app?.alive() || next.join(' ') !== this.command.join(' ')) {
      this.app?.stop();
      this.app = null;
      this.command = next;

      try {
        this.app = await startApp(next, this.cwd, this.scratch, this.blockedPorts);
        await this.switchOrigin(this.app.url);
      } catch (error) {
        const failure = thrownSchema.parse(error);

        return failed(`${failure.message}\n\nApp output:\n${failure.log ?? ''}`);
      }
    }

    const url = new URL(path, this.app.url);

    if (url.origin !== new URL(this.app.url).origin)
      return failed(`Open a path on the app at ${this.app.url}, for example /settings`);

    try {
      await Promise.all(
        ['console', 'errors'].map(kind => this.page(this.session, [kind, '--clear']).catch(() => undefined)),
      );
      await this.page(this.session, ['network', 'requests', '--clear']).catch(() => undefined);
      await loadPage(this.page, this.session, url.href);
      const shot = await this.capture(this.viewport);
      const errors = await pageErrors(this.page, this.session);

      return {
        content: [
          text(
            `Opened ${url.href} with ${next.join(' ')}.${errors.length ? `\nErrors:\n${errors.join('\n')}` : ' No page errors.'}`,
          ),
          shot,
        ],
      };
    } catch (error) {
      return commandFailure(thrownSchema.parse(error));
    }
  }

  async screenshot({ viewport = this.viewport }: { viewport?: 'desktop' | 'mobile' }): Promise<ToolResult> {
    if (!this.app) return failed('The app is not running. Call preview_open first.');

    try {
      this.viewport = viewport;

      return { content: [await this.capture(viewport)] };
    } catch (error) {
      return commandFailure(thrownSchema.parse(error));
    }
  }

  async logs(): Promise<ToolResult> {
    if (!this.app) return failed('The app is not running. Call preview_open first.');
    const read = (args: string[]) => this.page(this.session, args).catch(() => '');

    const [consoleOutput, errors, requests] = await Promise.all([
      read(['console']),
      read(['errors']),
      read(['network', 'requests']),
    ]);

    const failedRequests = lines(requests).filter(line => !/\s[23]\d\d$/.test(line));

    const section = (title: string, items: string[]) =>
      `${title}:\n${items.length ? items.slice(-logLines).join('\n') : 'none'}`;

    return {
      content: [
        text(
          [
            `App ${this.app.alive() ? 'running' : 'stopped'} at ${this.app.url}`,
            section('Page errors', lines(errors)),
            section('Console', lines(consoleOutput)),
            section('Failed requests', failedRequests),
            section('App output', lines(this.app.log())),
          ].join('\n\n'),
        ),
      ],
    };
  }

  async interact({
    action,
    target = '',
    value = '',
  }: {
    action: 'click' | 'fill' | 'press' | 'eval' | 'snapshot';
    target?: string;
    value?: string;
  }): Promise<ToolResult> {
    if (!this.app) return failed('The app is not running. Call preview_open first.');

    if (action !== 'snapshot' && !target) return failed(`${action} needs a target`);

    const args = {
      click: ['click', target],
      fill: ['fill', target, value],
      press: ['press', target],
      eval: ['eval', target],
      snapshot: ['snapshot'],
    }[action];

    try {
      if (!(await this.onApp())) return failed(leftApp(this.app.url));
      const output = await this.page(this.session, args);

      return { content: [text(output.trim() || 'Done')] };
    } catch (error) {
      return commandFailure(thrownSchema.parse(error));
    }
  }

  async close() {
    const app = this.app;
    this.app = null;
    app?.stop();
    await this.page(this.session, ['close']).catch(() => undefined);
    await rm(this.scratch, { recursive: true, force: true }).catch(() => undefined);
  }

  private async capture(viewport: 'desktop' | 'mobile'): Promise<ToolContent> {
    const directory = join(this.root, '.factory/artifacts', this.task.id, 'agent-preview');
    await mkdir(directory, { recursive: true });

    if (!(await this.onApp())) throw new Error(leftApp(this.app?.url ?? this.origin));
    const shot = await screenshot(this.page, this.session, viewport, join(directory, `${Date.now()}-${viewport}.png`));

    return { type: 'image', data: (await readFile(shot.path)).toString('base64'), shot };
  }
}

const viewport = z.enum(['desktop', 'mobile']);

const previewTool = <Args extends z.ZodObject>(
  description: string,
  schema: Args,
  run: (session: PreviewSession, args: z.infer<Args>) => Promise<ToolResult>,
) => ({
  description,
  schema,
  run: async (session: PreviewSession, input: JsonArguments) => {
    const args = schema.safeParse(input);

    return args.success ? run(session, args.data) : failed(`Invalid arguments: ${args.error.message}`);
  },
});

export const previewTools = {
  preview_open: previewTool(
    'Start the app in the preview sandbox and load a page. Returns a screenshot and any page errors. The app can listen on loopback and reach only its own port. Call again after changes to reload.',
    z.object({
      path: z.string().optional().describe('Page path, for example /settings. Defaults to /.'),
      command: z
        .string()
        .optional()
        .describe(
          'Command that starts the app, for example npm run dev. Defaults to the last command or the package script.',
        ),
      restart: z.boolean().optional().describe('Restart the app first, for example after changing server code.'),
    }),
    (session, args) => session.open(args),
  ),
  preview_screenshot: previewTool(
    'Screenshot the current page at a desktop (1280x800) or phone (390x844) size.',
    z.object({ viewport: viewport.optional() }),
    (session, args) => session.screenshot(args),
  ),
  preview_logs: previewTool(
    'Read console output, page errors, and failed network requests since the last preview_open, plus the app process output.',
    z.object({}),
    session => session.logs(),
  ),
  preview_interact: previewTool(
    'Act on the current page. snapshot returns the accessibility tree with @refs. click, fill, and press take a CSS selector or @ref (press takes a key such as Enter). eval runs JavaScript and returns the result.',
    z.object({
      action: z.enum(['click', 'fill', 'press', 'eval', 'snapshot']),
      target: z.string().optional().describe('Selector or @ref for click and fill, key for press, JavaScript for eval'),
      value: z.string().optional().describe('Text to enter for fill'),
    }),
    (session, args) => session.interact(args),
  ),
};

type PreviewToolName = keyof typeof previewTools;

const isPreviewTool = (name: string): name is PreviewToolName => Object.hasOwn(previewTools, name);

export async function runPreviewTool(session: PreviewSession, name: string, input: JsonArguments): Promise<ToolResult> {
  if (!isPreviewTool(name)) return failed(`Unknown tool ${name}`);

  return previewTools[name].run(session, input);
}

export const previewToolSpecs = () =>
  Object.entries(previewTools).map(([name, tool]) => ({
    type: 'function' as const,
    name,
    description: tool.description,
    inputSchema: jsonObjectSchema.parse(z.toJSONSchema(tool.schema)),
  }));
