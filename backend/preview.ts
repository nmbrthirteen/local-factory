import { spawn } from 'node:child_process';
import { mkdir, realpath, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCommand } from '../shared/commands';
import type { Preview, PreviewShot, Task } from '../shared/types';
import { freePort, sandboxProfile } from './agents/opencode';
import { run, safeEnv, stopProcessGroup } from './process';

const startTimeoutMs = 60_000;
const pollMs = 250;
const settleMs = 300;
const logLimit = 4000;
const previewScripts = ['preview', 'dev', 'start', 'ui', 'serve'];
const viewports = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
// Screenshots vary with animations, transitions, a blinking caret, and late web fonts, so capture waits for fonts and stills motion.
const stillPage = `document.fonts.ready.then(() => {
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  document.head.append(style);
  return true;
})`;
const addressPattern = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+[^\s'"<>)]*/;

export type Browser = (session: string, args: string[]) => Promise<string>;
export type Capture = (url: string, directory: string, session: string) => Promise<{ shots: PreviewShot[]; errors: string[] }>;
export type App = { url: string; log: () => string; alive: () => boolean; stop: () => void; exited: Promise<number | null> };

type Resolved = Pick<Preview, 'command' | 'source'>;
type CaptureOptions = { task: Task; cwd: string; root: string; candidate: string; message?: string; capture?: Capture; servicePort?: number };

export function namedPreview(message = '') {
  const named = [...message.matchAll(/^PREVIEW:\s*`?([^`\n]+?)`?\s*$/gm)].at(-1);
  return named ? parseCommand(named[1]) : [];
}

export async function detectPreview(path: string) {
  const manifest = await Bun.file(join(path, 'package.json')).json().catch(() => null);
  const script = previewScripts.find(name => typeof manifest?.scripts?.[name] === 'string');
  if (!script) return [];
  return [(await Bun.file(join(path, 'bun.lock')).exists()) ? 'bun' : 'npm', 'run', script];
}

export async function resolvePreview(path: string, message?: string, previous?: Resolved | null): Promise<Resolved> {
  const named = namedPreview(message);
  if (named.length) return { command: named, source: 'agent' };
  if (previous?.command.length) return previous;
  return { command: await detectPreview(path), source: 'detected' };
}

export const previewSummary = (preview: Preview) => preview.status === 'captured'
  ? `${preview.shots.length} screenshots${preview.errors.length ? `, ${preview.errors.length} page errors` : ''}`
  : `Screenshots failed: ${preview.note}`;

// The app runs the repository's own scripts, so it gets the agent's sandbox plus loopback networking, minus the factory's own port.
export async function startApp(command: string[], cwd: string, scratch: string, blockedPorts: number[] = []): Promise<App> {
  await mkdir(join(scratch, 'tmp'), { recursive: true });
  const [worktree, tmp] = await Promise.all([realpath(cwd), realpath(join(scratch, 'tmp'))]);
  const profile = join(scratch, 'profile.sb');
  await Bun.write(profile, sandboxProfile([worktree, tmp], { loopback: true, blockedPorts }));
  const port = freePort();
  const child = spawn('/usr/bin/sandbox-exec', ['-f', profile, ...command], {
    cwd: worktree,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...safeEnv(), TMPDIR: tmp, PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none', CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  let output = '';
  const exit = Promise.withResolvers<number | null>();
  let exited = false;
  child.once('exit', code => {
    exited = true;
    exit.resolve(code);
  });
  const stop = () => stopProcessGroup(child);
  const reachable = (address: string) => fetch(address, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let done = false;
      const finish = (error: Error | null, address = '') => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(poll);
        if (error) reject(Object.assign(error, { log: output }));
        else resolve(address);
      };
      const tryAddress = (address: string) => reachable(address).then(up => up && finish(null, address));
      const collect = (chunk: Buffer) => {
        output = (output + chunk).slice(-logLimit);
        const address = output.match(addressPattern)?.[0];
        if (address) tryAddress(address.replace('0.0.0.0', '127.0.0.1').replace('[::1]', '127.0.0.1'));
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', error => finish(error));
      child.once('exit', code => finish(new Error(`The app exited with ${code} before it was ready`)));
      const poll = setInterval(() => tryAddress(`http://127.0.0.1:${port}/`), pollMs);
      const timer = setTimeout(() => finish(new Error(`The app did not start within ${startTimeoutMs / 1000} seconds`)), startTimeoutMs);
    });
    return { url, log: () => output, alive: () => !exited, stop, exited: exit.promise };
  } catch (error) {
    stop();
    throw error;
  }
}

// Pages run code the agent wrote, so the browser is held to loopback: every other request goes to a proxy that does not exist.
const browserEnv = () => ({ ...safeEnv(), AGENT_BROWSER_PROXY: 'http://127.0.0.1:9', AGENT_BROWSER_PROXY_BYPASS: '127.0.0.1,localhost' });

export const agentBrowser: Browser = (session, args) => run(['agent-browser', '--session', session, ...args], { env: browserEnv(), timeoutMs: 60_000 });
export const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);

export async function loadPage(browser: Browser, session: string, url: string) {
  await browser(session, ['open', url]);
  // `wait --load load` sits out its whole timeout when the page already loaded during `open`, so check the ready state instead.
  await browser(session, ['wait', '--fn', "document.readyState === 'complete'"]).catch(() => undefined);
  await browser(session, ['eval', stillPage]).catch(() => undefined);
}

export async function screenshot(browser: Browser, session: string, name: PreviewShot['name'], path: string): Promise<PreviewShot> {
  const { width, height } = viewports.find(viewport => viewport.name === name)!;
  await browser(session, ['set', 'viewport', String(width), String(height)]);
  await Bun.sleep(settleMs);
  await browser(session, ['screenshot', path]);
  return { name, width, height, path, bytes: (await stat(path)).size };
}

export async function pageErrors(browser: Browser, session: string) {
  const [errors, consoleOutput] = await Promise.all([browser(session, ['errors']).catch(() => ''), browser(session, ['console']).catch(() => '')]);
  return [...lines(errors), ...lines(consoleOutput).filter(line => /\berror\b/i.test(line))];
}

const captureWithAgentBrowser: Capture = async (url, directory, session) => {
  const shots: PreviewShot[] = [];
  try {
    for (const [index, { name }] of viewports.entries()) {
      if (index === 0) {
        await agentBrowser(session, ['set', 'viewport', String(viewports[0].width), String(viewports[0].height)]);
        await loadPage(agentBrowser, session, url);
      }
      shots.push(await screenshot(agentBrowser, session, name, join(directory, `${name}.png`)));
    }
    return { shots, errors: await pageErrors(agentBrowser, session) };
  } finally {
    await agentBrowser(session, ['close']).catch(() => undefined);
  }
};

export async function capturePreview({ task, cwd, root, candidate, message, capture = captureWithAgentBrowser, servicePort }: CaptureOptions): Promise<Preview | null> {
  const { command, source } = await resolvePreview(cwd, message, task.preview);
  if (!command.length) return null;
  const directory = join(root, '.factory/artifacts', task.id, candidate, 'preview');
  const scratch = join(root, '.factory/sandbox', `preview-${task.id}`);
  const startedAt = Date.now();
  const finished = () => ({ at: new Date().toISOString(), durationMs: Date.now() - startedAt });
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  let app: App | null = null;
  try {
    app = await startApp(command, cwd, scratch, servicePort ? [servicePort] : []);
    const { shots, errors } = await capture(app.url, directory, `factory-preview-${task.id}`);
    return { status: 'captured', candidate, command, source, url: app.url, shots, errors, log: app.log(), ...finished() };
  } catch (error) {
    const log = (error as { log?: string }).log ?? app?.log();
    return { status: 'failed', candidate, command, source, shots: [], errors: [], note: (error as Error).message, log, ...finished() };
  } finally {
    app?.stop();
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}
