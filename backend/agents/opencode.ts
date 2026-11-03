import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { type Json, type JsonObject, jsonObjectSchema, jsonSchema } from '../../shared/json';
import type { AgentModel, AgentProbe, PromptImage } from '../../shared/types';
import { run, safeEnv, stopProcessGroup } from '../process';

const supportedOpencodeVersion = '1.18.30';

const opencodePermissions = {
  edit: 'allow',
  bash: 'allow',
  webfetch: 'deny',
  websearch: 'deny',
  external_directory: 'ask',
  doom_loop: 'ask',
};

const binary = join(import.meta.dir, '../../node_modules/.bin/opencode');
const startTimeoutMs = 20_000;

const baseConfig = {
  autoupdate: false,
  share: 'disabled',
  snapshot: false,
  mcp: {},
  plugin: [],
  lsp: false,
  formatter: false,
};

const ollamaHost = (Bun.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
const ollamaTimeoutMs = 1500;

const isolationEnv = {
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_DISABLE_SHARE: '1',
  OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
  OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
  OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
};

const questionOptionSchema = z.object({ label: z.string(), description: z.string().optional() });

const askedQuestionSchema = z.object({ question: z.string(), options: z.array(questionOptionSchema).optional() });

export type OpencodeEvent =
  | { type: 'message'; text: string }
  | { type: 'draft'; key: string; text: string }
  | { type: 'tool_started'; toolId?: string; tool: string; text: string }
  | { type: 'tool_result'; toolId?: string; tool: string; error: boolean; output: Json | undefined }
  | { type: 'permission'; id: string; permission: string; patterns: string[]; metadata: Json | undefined }
  | { type: 'question'; id: string; questions: z.infer<typeof askedQuestionSchema>[] }
  | { type: 'idle'; error: string | null; costUsd: number; turns: number };

type OpencodePolicy = { version: string; directory: string; shell: string; permission?: unknown; writable?: string[] };

export type OpencodeSession = {
  pid?: number;
  policy: OpencodePolicy;
  models: AgentModel[];
  events: AsyncIterable<OpencodeEvent>;
  send: (prompt: string, images?: PromptImage[]) => Promise<void>;
  replyPermission: (id: string, reply: 'once' | 'reject') => Promise<void>;
  replyQuestion: (id: string, answers: string[][]) => Promise<void>;
  interrupt: () => Promise<void>;
  close: () => void;
};

export type OpenOpencode = (options: {
  root: string;
  runId: string;
  cwd: string;
  model: string;
  instructions: string;
}) => Promise<OpencodeSession>;

const providersSchema = z.object({
  connected: z.array(z.string()),
  default: z.record(z.string(), z.string()),
  all: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      models: z.record(z.string(), z.object({ id: z.string(), name: z.string() })),
    }),
  ),
});

type Providers = z.infer<typeof providersSchema>;

type Sandbox = {
  shell: string;
  configHome: string;
  serverProfile: string;
  tmp: string;
  worktree: string;
  writable: string[];
};

const opencodeErrorSchema = z.object({
  name: z.string().optional(),
  data: z.object({ message: z.string().optional() }).optional(),
});

type OpencodeError = z.infer<typeof opencodeErrorSchema>;

const rawPartSchema = z.object({
  id: z.string(),
  type: z.string(),
  text: z.string().optional(),
  synthetic: z.boolean().optional(),
  time: z.object({ end: z.number().optional() }).optional(),
  callID: z.string().optional(),
  tool: z.string().optional(),
  state: z
    .object({
      status: z.string(),
      input: jsonObjectSchema.optional(),
      output: jsonSchema.optional(),
      error: jsonSchema.optional(),
    })
    .optional(),
});

// Only the fields the adapter reads. Each event type sends its own subset.
const rawEventSchema = z.object({
  type: z.string(),
  properties: z
    .object({
      sessionID: z.string().optional(),
      part: rawPartSchema.optional(),
      info: z
        .object({
          id: z.string(),
          role: z.string(),
          cost: z.number().optional(),
          error: opencodeErrorSchema.optional(),
        })
        .optional(),
      id: z.string().optional(),
      permission: z.string().optional(),
      patterns: z.array(z.string()).optional(),
      metadata: jsonSchema.optional(),
      questions: z.array(askedQuestionSchema).optional(),
      error: opencodeErrorSchema.optional(),
    })
    .optional(),
});

type RawEvent = z.infer<typeof rawEventSchema>;

const effectiveConfigSchema = z.object({
  shell: z.string().optional(),
  plugin: z.array(jsonSchema).optional(),
  mcp: z.record(z.string(), jsonSchema).optional(),
  permission: z.record(z.string(), jsonSchema).optional(),
});

type EffectiveConfig = z.infer<typeof effectiveConfigSchema>;

async function opencodeVersion() {
  const version = (await run([binary, '--version'], { timeoutMs: 10_000 })).trim();

  if (version !== supportedOpencodeVersion)
    throw new Error(
      `OpenCode ${version} is installed; this adapter supports ${supportedOpencodeVersion}. Run bun install to restore the pinned version.`,
    );

  return version;
}

function quoted(path: string, forbidden: RegExp, quote: string) {
  if (forbidden.test(path)) throw new Error(`Unsupported character in sandbox path: ${path}`);

  return `${quote}${path}${quote}`;
}

type ProfileOptions = { network?: boolean; listen?: boolean; connectPorts?: number[] };

// Each writable root's .git stays read-only: in a worktree it is the file that tells Git where the repository lives.
export const sandboxProfile = (
  writable: string[],
  { network = false, listen = false, connectPorts = [] }: ProfileOptions = {},
) =>
  [
    '(version 1)',
    '(allow default)',
    ...(network ? [] : ['(deny network*)']),
    ...(listen ? ['(allow network-bind network-inbound (local ip "localhost:*"))'] : []),
    ...connectPorts.map(port => `(allow network-outbound (remote ip "localhost:${port}"))`),
    '(deny file-write*)',
    `(allow file-write* ${writable.map(path => `(subpath ${quoted(path, /["\\]/, '"')})`).join(' ')} (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/fd/") (regex #"^/dev/ttys"))`,
    `(deny file-write* ${writable.map(path => `(subpath ${quoted(join(path, '.git'), /["\\]/, '"')})`).join(' ')})`,
  ].join('\n');

// OpenCode keeps sign-ins, sessions, and provider packages here, so its server may write them.
const opencodeHomes = async () => {
  const home = await realpath(homedir());

  return ['.local/share/opencode', '.local/state/opencode', '.cache/opencode'].map(path => join(home, path));
};

// The server needs the network for the model provider, so it keeps network access but writes only where the run and OpenCode need.
async function writeServerProfile(path: string, writable: string[]) {
  await writeFile(path, sandboxProfile([...writable, ...(await opencodeHomes())], { network: true }));

  return path;
}

// OpenCode has no OS sandbox of its own. Its server and its edit tool run under sandbox-exec, and every shell command it runs gets a
// second, offline sandbox. The wrapper and profiles sit outside every writable path, so the agent cannot rewrite them.
async function prepareSandbox(root: string, runId: string, cwd: string): Promise<Sandbox> {
  const directory = join(root, '.factory/sandbox', runId);
  await Promise.all([
    mkdir(join(directory, 'tmp'), { recursive: true }),
    mkdir(join(root, '.factory/cache'), { recursive: true }),
    mkdir(join(directory, 'config'), { recursive: true }),
  ]);

  const [worktree, tmp, cache, configHome] = await Promise.all([
    realpath(cwd),
    realpath(join(directory, 'tmp')),
    realpath(join(root, '.factory/cache')),
    realpath(join(directory, 'config')),
  ]);

  const profile = join(directory, 'profile.sb');
  const shell = join(directory, 'zsh');
  const shellPath = (path: string) => quoted(path, /'/, "'");
  await writeFile(profile, sandboxProfile([worktree, tmp, cache]));
  await writeFile(
    shell,
    `#!/bin/sh\nexport TMPDIR=${shellPath(tmp)} XDG_CACHE_HOME=${shellPath(cache)} npm_config_cache=${shellPath(join(cache, 'npm'))}\nexec /usr/bin/sandbox-exec -f ${shellPath(profile)} /bin/zsh "$@"\n`,
    { mode: 0o700 },
  );
  const serverProfile = await writeServerProfile(join(directory, 'server.sb'), [worktree, tmp, cache, configHome]);

  return { shell, configHome, serverProfile, tmp, worktree, writable: [worktree, tmp, cache] };
}

const ollamaTagsSchema = z.object({
  models: z
    .array(z.object({ model: z.string(), name: z.string(), capabilities: z.array(z.string()).optional() }))
    .optional(),
});

// Ollama serves the OpenAI API, so local models join as one more provider. A model that reports no tool calling cannot drive an agent.
async function ollamaProvider() {
  const tags = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(ollamaTimeoutMs) })
    .then(response => (response.ok ? response.json() : null))
    .then(body => ollamaTagsSchema.parse(body))
    .catch(() => null);

  const models = (tags?.models ?? []).filter(model => model.capabilities?.includes('tools') ?? true);

  if (!models.length) return {};

  return {
    ollama: {
      npm: '@ai-sdk/openai-compatible',
      name: 'Ollama',
      options: { baseURL: `${ollamaHost}/v1` },
      models: Object.fromEntries(models.map(model => [model.model, { name: model.name, tool_call: true }])),
    },
  };
}

// Replies carry nothing the adapter reads.
const acknowledged = z.unknown().transform((): void => undefined);

const sessionConfig = async () => ({ ...baseConfig, provider: await ollamaProvider() });

export function freePort() {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const { port } = probe;
  probe.stop(true);

  if (port === undefined) throw new Error('Could not reserve a local port');

  return port;
}

type ServerOptions = { cwd: string; config: object; configHome: string; profile: string; tmp: string };

async function startServer({ cwd, config, configHome, profile, tmp }: ServerOptions) {
  const password = randomBytes(24).toString('hex');

  const child = spawn(
    '/usr/bin/sandbox-exec',
    ['-f', profile, binary, 'serve', '--hostname=127.0.0.1', `--port=${freePort()}`],
    {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...safeEnv(),
        ...isolationEnv,
        TMPDIR: tmp,
        XDG_CONFIG_HOME: configHome,
        OPENCODE_SERVER_PASSWORD: password,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      },
    },
  );

  const stop = () => stopProcessGroup(child);
  let output = '';

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`OpenCode did not start: ${output.slice(-400)}`));
    }, startTimeoutMs);

    const collect = (chunk: Buffer) => {
      output = (output + chunk).slice(-4000);
      const listening = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);

      if (!listening) return;
      clearTimeout(timer);
      resolve(listening[1]);
    };

    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`OpenCode exited with ${code}: ${output.slice(-400)}`));
    });
  });

  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;

  async function request<Result extends z.ZodType>(
    method: string,
    path: string,
    result: Result,
    body?: Json,
  ): Promise<z.infer<Result>> {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: { authorization, ...(body !== undefined && { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();

    if (!response.ok)
      throw new Error(`OpenCode ${method} ${path} failed with ${response.status}: ${text.slice(0, 300)}`);

    return result.parse(text ? JSON.parse(text) : null);
  }

  return { url, authorization, request, pid: child.pid, stop };
}

function listModels(providers: Providers): AgentModel[] {
  const [primary] = providers.connected;

  return providers.all
    .filter(provider => providers.connected.includes(provider.id))
    .flatMap(provider =>
      Object.values(provider.models).map(model => ({
        id: `${provider.id}/${model.id}`,
        name: `${provider.name} · ${model.name}`,
        isDefault: provider.id === primary && providers.default[provider.id] === model.id,
      })),
    );
}

const errorMessage = (error?: OpencodeError) => error?.data?.message ?? error?.name ?? 'OpenCode reported an error';

const describe = (tool: string, input: JsonObject = {}) =>
  `${tool}: ${input.command ?? input.filePath ?? input.path ?? input.pattern ?? ''}`;

async function* parseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<RawEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });

    for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);

      const data = frame
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n');

      const event = data ? rawEventSchema.safeParse(JSON.parse(data)) : null;

      if (event?.success) yield event.data;
    }
  }
}

async function* normalize(
  events: AsyncIterable<RawEvent>,
  sessionID: string,
  state: { prompted: boolean },
): AsyncGenerator<OpencodeEvent> {
  const finishedText = new Set<string>();
  const toolStatus = new Map<string, string>();
  const costs = new Map<string, number>();
  let error: string | null = null;

  for await (const { type, properties = {} } of events) {
    if (properties.sessionID && properties.sessionID !== sessionID) continue;

    if (type === 'message.part.updated' && properties.part) {
      const { part } = properties;
      const text = part.text ?? '';

      if (part.type === 'text' && part.time?.end && !part.synthetic && !finishedText.has(part.id)) {
        finishedText.add(part.id);

        if (text.trim()) yield { type: 'message', text };
      } else if (part.type === 'text' && !part.time?.end && !part.synthetic && text) {
        yield { type: 'draft', key: part.id, text };
      }

      if (part.type === 'tool' && part.state && toolStatus.get(part.callID ?? '') !== part.state.status) {
        toolStatus.set(part.callID ?? '', part.state.status);
        const tool = { toolId: part.callID, tool: part.tool ?? '' };

        if (part.state.status === 'running')
          yield { type: 'tool_started', ...tool, text: describe(tool.tool, part.state.input) };

        if (part.state.status === 'completed')
          yield { type: 'tool_result', ...tool, error: false, output: part.state.output };

        if (part.state.status === 'error')
          yield { type: 'tool_result', ...tool, error: true, output: part.state.error };
      }
    } else if (type === 'message.updated' && properties.info?.role === 'assistant') {
      costs.set(properties.info.id, properties.info.cost ?? 0);

      if (properties.info.error) error = errorMessage(properties.info.error);
    } else if (type === 'permission.asked') {
      yield {
        type: 'permission',
        id: properties.id ?? '',
        permission: properties.permission ?? '',
        patterns: properties.patterns ?? [],
        metadata: properties.metadata,
      };
    } else if (type === 'question.asked') {
      yield { type: 'question', id: properties.id ?? '', questions: properties.questions ?? [] };
    } else if (type === 'session.error') {
      error = errorMessage(properties.error);
    } else if (type === 'session.idle' && state.prompted) {
      yield {
        type: 'idle',
        error,
        costUsd: [...costs.values()].reduce((sum, cost) => sum + cost, 0),
        turns: costs.size,
      };

      return;
    }
  }
}

function policyProblem(effective: EffectiveConfig, directory: string, sandbox: Sandbox) {
  if (directory !== sandbox.worktree) return 'working directory';

  if (effective.shell !== sandbox.shell) return 'shell sandbox';

  if ((effective.plugin ?? []).length || Object.keys(effective.mcp ?? {}).length) return 'plugins or MCP servers';

  for (const [key, value] of Object.entries(opencodePermissions)) {
    if (effective.permission?.[key] !== value) return `${key} permission`;
  }

  return null;
}

export const openOpencode: OpenOpencode = async ({ root, runId, cwd, model, instructions }) => {
  const version = await opencodeVersion();
  const sandbox = await prepareSandbox(root, runId, cwd);

  const server = await startServer({
    cwd: sandbox.worktree,
    config: { ...(await sessionConfig()), shell: sandbox.shell, permission: opencodePermissions },
    configHome: sandbox.configHome,
    profile: sandbox.serverProfile,
    tmp: sandbox.tmp,
  });

  const abort = new AbortController();
  const state = { prompted: false };

  try {
    const [effective, paths, providers, session] = await Promise.all([
      server.request('GET', '/config', effectiveConfigSchema),
      server.request('GET', '/path', z.object({ directory: z.string() })),
      server.request('GET', '/provider', providersSchema),
      server.request('POST', '/session', z.object({ id: z.string() }), {}),
    ]);

    const directory = await realpath(paths.directory);
    const problem = policyProblem(effective, directory, sandbox);

    if (problem) throw new Error(`OpenCode did not apply the requested run policy: ${problem}`);

    const stream = await fetch(`${server.url}/event`, {
      headers: { authorization: server.authorization, accept: 'text/event-stream' },
      signal: abort.signal,
    });

    if (!stream.body) throw new Error('OpenCode did not open its event stream');
    const [providerID, ...modelID] = model.split('/');

    return {
      pid: server.pid,
      policy: {
        version,
        directory,
        shell: effective.shell ?? '',
        permission: effective.permission,
        writable: sandbox.writable,
      },
      models: listModels(providers),
      events: normalize(parseEvents(stream.body), session.id, state),
      async send(prompt, images = []) {
        state.prompted = true;

        const parts = [
          ...images.map(image => ({
            type: 'file',
            mime: image.mediaType,
            filename: image.name,
            url: `data:${image.mediaType};base64,${image.base64}`,
          })),
          { type: 'text', text: prompt },
        ];

        await server.request('POST', `/session/${session.id}/prompt_async`, acknowledged, {
          model: { providerID, modelID: modelID.join('/') },
          system: instructions,
          parts,
        });
      },
      replyPermission: (id, reply) => server.request('POST', `/permission/${id}/reply`, acknowledged, { reply }),
      replyQuestion: (id, answers) => server.request('POST', `/question/${id}/reply`, acknowledged, { answers }),
      interrupt: () => server.request('POST', `/session/${session.id}/abort`, acknowledged).catch(() => undefined),
      close() {
        abort.abort();
        server.stop();
      },
    };
  } catch (error) {
    abort.abort();
    server.stop();
    throw error;
  }
};

export async function probeOpencode(root: string): Promise<AgentProbe> {
  const version = await opencodeVersion();
  const directory = join(root, '.factory/sandbox/probe');
  await Promise.all(['config', 'tmp'].map(name => mkdir(join(directory, name), { recursive: true })));
  const [configHome, tmp] = await Promise.all([realpath(join(directory, 'config')), realpath(join(directory, 'tmp'))]);
  const profile = await writeServerProfile(join(directory, 'server.sb'), [configHome, tmp]);
  const server = await startServer({ cwd: root, config: await sessionConfig(), configHome, profile, tmp });

  try {
    const providers = await server.request('GET', '/provider', providersSchema);

    return {
      harness: 'opencode',
      version,
      authenticated: providers.connected.length > 0,
      account: providers.connected.join(', '),
      models: listModels(providers),
    };
  } finally {
    server.stop();
  }
}
