import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface, type Interface } from 'node:readline';
import { MissingCommandError, run, safeEnv, stopProcessGroup } from '../process';

export const supportedVersion = '0.154.0';

const defaultArgs = ['app-server', '--stdio', '--disable', 'hooks', '--disable', 'apps', '--disable', 'plugins', '-c', 'mcp_servers={}'];
const clientInfo = { name: 'local_factory', title: 'Local Factory', version: '0.3.0' };
const disabledFeatures = {
  'features.hooks': false,
  'features.apps': false,
  'features.plugins': false,
  web_search: 'disabled',
  'shell_environment_policy.inherit': 'core',
  'shell_environment_policy.ignore_default_excludes': false,
  'sandbox_workspace_write.network_access': false,
  'sandbox_workspace_write.exclude_tmpdir_env_var': true,
  'sandbox_workspace_write.exclude_slash_tmp': true,
};

export type CodexMessage = {
  id?: string | number;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: { code?: number; message: string };
};

type Call = { resolve: (result: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type CodexOptions = { command?: string; args?: string[]; cwd?: string };

export const sandbox = (cwd: string, { roots = [] as string[], network = false } = {}) => ({
  type: 'workspaceWrite',
  writableRoots: [cwd, ...roots],
  networkAccess: network,
  excludeSlashTmp: true,
  excludeTmpdirEnvVar: true,
});

export function isolatedConfig(config: { mcp_servers?: Record<string, unknown> }) {
  const overrides: Record<string, unknown> = { ...disabledFeatures };
  for (const name of Object.keys(config.mcp_servers ?? {})) {
    if (!/^[\w-]+$/.test(name)) throw new Error('Unsupported MCP server name in the existing profile. Use a dedicated Codex profile for this runner.');
    overrides[`mcp_servers.${name}.enabled`] = false;
  }
  return overrides;
}

export class Codex extends EventEmitter {
  child?: ChildProcessWithoutNullStreams;
  private closed = false;
  private reader?: Interface;
  private sequence = 0;
  private readonly calls = new Map<string | number, Call>();
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd?: string;

  constructor({ command = 'codex', args = defaultArgs, cwd }: CodexOptions = {}) {
    super();
    this.command = command;
    this.args = args;
    this.cwd = cwd;
  }

  static async version() {
    let output: string;
    try {
      output = await run(['codex', '--version'], { timeoutMs: 10_000 });
    } catch (error) {
      if (error instanceof MissingCommandError) throw new Error(`Codex CLI was not found. Install codex-cli ${supportedVersion}: setup and checks use it for every agent.`);
      throw new Error(`Could not run codex --version: ${(error as Error).message}`);
    }
    const version = output.trim().replace('codex-cli ', '');
    if (version !== supportedVersion) throw new Error(`Codex ${version} is installed; this adapter supports ${supportedVersion}. Regenerate and verify the protocol before upgrading.`);
    return version;
  }

  async connect() {
    const child = spawn(this.command, this.args, { cwd: this.cwd, env: safeEnv(), detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    this.emit('spawned', child.pid);
    child.on('error', error => this.fail(error));
    child.on('exit', () => this.fail(new Error('Codex connection closed')));
    child.stdin.on('error', error => this.fail(error));
    child.stderr.resume();
    this.reader = createInterface({ input: child.stdout });
    this.reader.on('line', line => this.receive(line));
    await this.request('initialize', { clientInfo, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized', params: {} });
  }

  send(message: CodexMessage) {
    if (!this.child?.stdin.writable) throw new Error('Codex is disconnected');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request<T = any>(method: string, params?: unknown, timeoutMs = 30_000) {
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);
      this.calls.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params: params as Record<string, unknown> });
      } catch (error) {
        clearTimeout(timer);
        this.calls.delete(id);
        reject(error);
      }
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.child?.stdin.end();
    stopProcessGroup(this.child);
    this.reader?.close();
    this.fail(new Error('Codex closed'));
  }

  private receive(line: string) {
    let message: CodexMessage;
    try {
      message = JSON.parse(line);
    } catch {
      this.fail(new Error('Invalid Codex protocol message'));
      return;
    }
    if (message.method) {
      this.emit(message.id === undefined ? 'notification' : 'request', message);
      return;
    }
    const call = message.id === undefined ? undefined : this.calls.get(message.id);
    if (!call || message.id === undefined) return;
    this.calls.delete(message.id);
    clearTimeout(call.timer);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  }

  private fail(error: Error) {
    for (const call of this.calls.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    this.calls.clear();
    if (!this.closed) this.emit('disconnected', error);
  }
}
