import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentModel, AgentProbe, QuestionOption } from '../../shared/types';
import { run, safeEnv, stopProcessGroup } from '../process';

const supportedOpencodeVersion = '1.18.30';
const opencodePermissions = { edit: 'allow', bash: 'allow', webfetch: 'deny', websearch: 'deny', external_directory: 'ask', doom_loop: 'ask' };

const binary = join(import.meta.dir, '../../node_modules/.bin/opencode');
const startTimeoutMs = 20_000;
const baseConfig = { autoupdate: false, share: 'disabled', snapshot: false, mcp: {}, plugin: [], lsp: false, formatter: false };
const isolationEnv = {
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_DISABLE_SHARE: '1',
  OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
  OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
  OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
};

export type OpencodeEvent =
  | { type: 'message'; text: string }
  | { type: 'tool_started'; toolId?: string; tool: string; text: string }
  | { type: 'tool_result'; toolId?: string; tool: string; error: boolean; output: unknown }
  | { type: 'permission'; id: string; permission: string; patterns: string[]; metadata: unknown }
  | { type: 'question'; id: string; questions: { question: string; options?: QuestionOption[] }[] }
  | { type: 'idle'; error: string | null; costUsd: number; turns: number };

type OpencodePolicy = { version: string; directory: string; shell: string; permission?: unknown; writable?: string[] };

export type OpencodeSession = {
  pid?: number;
  policy: OpencodePolicy;
  models: AgentModel[];
  events: AsyncIterable<OpencodeEvent>;
  send: (prompt: string) => Promise<void>;
  replyPermission: (id: string, reply: 'once' | 'reject') => Promise<unknown>;
  replyQuestion: (id: string, answers: string[][]) => Promise<unknown>;
  interrupt: () => Promise<unknown>;
  close: () => void;
};

export type OpenOpencode = (options: { root: string; runId: string; cwd: string; model: string; instructions: string }) => Promise<OpencodeSession>;

type Providers = { connected: string[]; default: Record<string, string>; all: { id: string; name: string; models: Record<string, { id: string; name: string }> }[] };
type Sandbox = { shell: string; configHome: string; worktree: string; writable: string[] };
type RawEvent = { type: string; properties?: Record<string, any> };

async function opencodeVersion() {
  const version = (await run([binary, '--version'], { timeoutMs: 10_000 })).trim();
  if (version !== supportedOpencodeVersion) throw new Error(`OpenCode ${version} is installed; this adapter supports ${supportedOpencodeVersion}. Run bun install to restore the pinned version.`);
  return version;
}

function quoted(path: string, forbidden: RegExp, quote: string) {
  if (forbidden.test(path)) throw new Error(`Unsupported character in sandbox path: ${path}`);
  return `${quote}${path}${quote}`;
}

export const sandboxProfile = (writable: string[], { loopback = false, blockedPorts = [] as number[] } = {}) => [
  '(version 1)',
  '(allow default)',
  '(deny network*)',
  ...(loopback ? ['(allow network* (local ip "localhost:*"))', '(allow network* (remote ip "localhost:*"))'] : []),
  ...blockedPorts.map(port => `(deny network-outbound (remote ip "localhost:${port}"))`),
  '(deny file-write*)',
  `(allow file-write* ${writable.map(path => `(subpath ${quoted(path, /["\\]/, '"')})`).join(' ')} (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/fd/") (regex #"^/dev/ttys"))`,
].join('\n');

// OpenCode has no OS sandbox of its own, so every shell command it runs goes through sandbox-exec.
async function prepareSandbox(root: string, runId: string, cwd: string): Promise<Sandbox> {
  const directory = join(root, '.factory/sandbox', runId);
  const configHome = join(directory, 'config');
  await Promise.all([mkdir(join(directory, 'tmp'), { recursive: true }), mkdir(join(root, '.factory/cache'), { recursive: true }), mkdir(configHome, { recursive: true })]);
  const [worktree, tmp, cache] = await Promise.all([realpath(cwd), realpath(join(directory, 'tmp')), realpath(join(root, '.factory/cache'))]);
  const profile = join(directory, 'profile.sb');
  const shell = join(directory, 'zsh');
  const shellPath = (path: string) => quoted(path, /'/, "'");
  await writeFile(profile, sandboxProfile([worktree, tmp, cache]));
  await writeFile(shell, `#!/bin/sh\nexport TMPDIR=${shellPath(tmp)} XDG_CACHE_HOME=${shellPath(cache)} npm_config_cache=${shellPath(join(cache, 'npm'))}\nexec /usr/bin/sandbox-exec -f ${shellPath(profile)} /bin/zsh "$@"\n`, { mode: 0o700 });
  return { shell, configHome, worktree, writable: [worktree, tmp, cache] };
}

export function freePort() {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const { port } = probe;
  probe.stop(true);
  return port;
}

async function startServer({ cwd, config, configHome }: { cwd: string; config: object; configHome: string }) {
  const password = randomBytes(24).toString('hex');
  const child = spawn(binary, ['serve', '--hostname=127.0.0.1', `--port=${freePort()}`], {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...safeEnv(), ...isolationEnv, XDG_CONFIG_HOME: configHome, OPENCODE_SERVER_PASSWORD: password, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
  });
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
  async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${url}${path}`, { method, headers: { authorization, ...(body !== undefined && { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    if (!response.ok) throw new Error(`OpenCode ${method} ${path} failed with ${response.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }
  return { url, authorization, request, pid: child.pid, stop };
}

function listModels(providers: Providers): AgentModel[] {
  const [primary] = providers.connected;
  return providers.all
    .filter(provider => providers.connected.includes(provider.id))
    .flatMap(provider => Object.values(provider.models).map(model => ({
      id: `${provider.id}/${model.id}`,
      name: `${provider.name} · ${model.name}`,
      isDefault: provider.id === primary && providers.default[provider.id] === model.id,
    })));
}

const errorMessage = (error: any) => error?.data?.message ?? error?.name ?? 'OpenCode reported an error';
const describe = (tool: string, input: Record<string, unknown> = {}) => `${tool}: ${input.command ?? input.filePath ?? input.path ?? input.pattern ?? ''}`;

async function* parseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<RawEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    for (let end = buffer.indexOf('\n\n'); end !== -1; end = buffer.indexOf('\n\n')) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data) yield JSON.parse(data);
    }
  }
}

async function* normalize(events: AsyncIterable<RawEvent>, sessionID: string, state: { prompted: boolean }): AsyncGenerator<OpencodeEvent> {
  const finishedText = new Set<string>();
  const toolStatus = new Map<string, string>();
  const costs = new Map<string, number>();
  let error: string | null = null;
  for await (const { type, properties = {} } of events) {
    if (properties.sessionID && properties.sessionID !== sessionID) continue;
    if (type === 'message.part.updated') {
      const { part } = properties;
      if (part.type === 'text' && part.time?.end && !part.synthetic && !finishedText.has(part.id)) {
        finishedText.add(part.id);
        if (part.text.trim()) yield { type: 'message', text: part.text };
      }
      if (part.type === 'tool' && toolStatus.get(part.callID) !== part.state.status) {
        toolStatus.set(part.callID, part.state.status);
        const tool = { toolId: part.callID, tool: part.tool };
        if (part.state.status === 'running') yield { type: 'tool_started', ...tool, text: describe(part.tool, part.state.input) };
        if (part.state.status === 'completed') yield { type: 'tool_result', ...tool, error: false, output: part.state.output };
        if (part.state.status === 'error') yield { type: 'tool_result', ...tool, error: true, output: part.state.error };
      }
    } else if (type === 'message.updated' && properties.info.role === 'assistant') {
      costs.set(properties.info.id, properties.info.cost ?? 0);
      if (properties.info.error) error = errorMessage(properties.info.error);
    } else if (type === 'permission.asked') {
      yield { type: 'permission', id: properties.id, permission: properties.permission, patterns: properties.patterns, metadata: properties.metadata };
    } else if (type === 'question.asked') {
      yield { type: 'question', id: properties.id, questions: properties.questions };
    } else if (type === 'session.error') {
      error = errorMessage(properties.error);
    } else if (type === 'session.idle' && state.prompted) {
      yield { type: 'idle', error, costUsd: [...costs.values()].reduce((sum, cost) => sum + cost, 0), turns: costs.size };
      return;
    }
  }
}

function policyProblem(effective: Record<string, any>, directory: string, sandbox: Sandbox) {
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
  const server = await startServer({ cwd: sandbox.worktree, config: { ...baseConfig, shell: sandbox.shell, permission: opencodePermissions }, configHome: sandbox.configHome });
  const abort = new AbortController();
  const state = { prompted: false };
  try {
    const [effective, paths, providers, session] = await Promise.all([
      server.request('GET', '/config'),
      server.request<{ directory: string }>('GET', '/path'),
      server.request<Providers>('GET', '/provider'),
      server.request<{ id: string }>('POST', '/session', {}),
    ]);
    const directory = await realpath(paths.directory);
    const problem = policyProblem(effective, directory, sandbox);
    if (problem) throw new Error(`OpenCode did not apply the requested run policy: ${problem}`);
    const stream = await fetch(`${server.url}/event`, { headers: { authorization: server.authorization, accept: 'text/event-stream' }, signal: abort.signal });
    if (!stream.body) throw new Error('OpenCode did not open its event stream');
    const [providerID, ...modelID] = model.split('/');
    return {
      pid: server.pid,
      policy: { version, directory, shell: effective.shell, permission: effective.permission, writable: sandbox.writable },
      models: listModels(providers),
      events: normalize(parseEvents(stream.body), session.id, state),
      async send(prompt) {
        state.prompted = true;
        await server.request('POST', `/session/${session.id}/prompt_async`, { model: { providerID, modelID: modelID.join('/') }, system: instructions, parts: [{ type: 'text', text: prompt }] });
      },
      replyPermission: (id, reply) => server.request('POST', `/permission/${id}/reply`, { reply }),
      replyQuestion: (id, answers) => server.request('POST', `/question/${id}/reply`, { answers }),
      interrupt: () => server.request('POST', `/session/${session.id}/abort`).catch(() => undefined),
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
  const configHome = join(root, '.factory/sandbox/probe-config');
  await mkdir(configHome, { recursive: true });
  const server = await startServer({ cwd: root, config: baseConfig, configHome });
  try {
    const providers = await server.request<Providers>('GET', '/provider');
    return { harness: 'opencode', version, authenticated: providers.connected.length > 0, account: providers.connected.join(', '), models: listModels(providers) };
  } finally {
    server.stop();
  }
}
