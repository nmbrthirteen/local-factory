import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface, type Interface } from 'node:readline';
import { z } from 'zod';
import packageJson from '../../package.json';
import { type Json, type JsonArguments, jsonObjectSchema, jsonSchema } from '../../shared/json';
import { thrownSchema } from '../failure';
import { MissingCommandError, run, safeEnv, stopProcessGroup } from '../process';

const supportedVersion = '0.154.0';

const defaultArgs = [
  'app-server',
  '--stdio',
  '--disable',
  'hooks',
  '--disable',
  'apps',
  '--disable',
  'plugins',
  '-c',
  'mcp_servers={}',
];

const clientInfo = { name: 'local_factory', title: 'Local Factory', version: packageJson.version };

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

const questionSchema = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })).optional(),
});

const codexItemSchema = z.looseObject({
  id: z.string(),
  type: z.string(),
  text: z.string().optional(),
  command: z.string().optional(),
  tool: z.string().optional(),
  arguments: jsonObjectSchema.optional(),
  status: z.string().optional(),
  exitCode: z.number().nullable().optional(),
  aggregatedOutput: z.string().optional(),
  success: z.boolean().optional(),
  contentItems: jsonSchema.optional(),
  changes: z.array(z.object({ path: z.string() })).optional(),
});

export type CodexItem = z.infer<typeof codexItemSchema>;

// Only the fields the runner reads. Each method sends its own subset.
const codexParamsSchema = z.looseObject({
  threadId: z.string().optional(),
  turn: z
    .object({ id: z.string(), status: z.string(), error: z.object({ message: z.string() }).optional() })
    .optional(),
  item: codexItemSchema.optional(),
  itemId: z.string().optional(),
  delta: z.string().optional(),
  processId: z.string().optional(),
  stream: z.string().optional(),
  deltaBase64: z.string().optional(),
  requestId: z.union([z.string(), z.number()]).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  tool: z.string().optional(),
  arguments: jsonObjectSchema.optional(),
  questions: z.array(questionSchema).optional(),
  reason: z.string().optional(),
  command: z.string().optional(),
  blockedPath: z.string().optional(),
});

export type CodexParams = z.infer<typeof codexParamsSchema>;

const codexMessageSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: codexParamsSchema.optional(),
  result: jsonSchema.optional(),
  error: z.object({ code: z.number().optional(), message: z.string() }).optional(),
});

export type CodexMessage = z.infer<typeof codexMessageSchema>;

export type CodexOutgoing = {
  id?: string | number;
  method?: string;
  params?: JsonArguments;
  result?: Json;
  error?: { code?: number; message: string };
};

const sandboxPolicySchema = z.object({ type: z.string(), networkAccess: z.boolean().optional() });

export const codexResults = {
  ack: z.unknown(),
  account: z.object({ account: z.unknown() }),
  models: z.object({
    data: z.array(z.object({ model: z.string(), displayName: z.string(), isDefault: z.boolean() })),
  }),
  config: z.object({
    config: z.object({
      mcp_servers: z.record(z.string(), z.looseObject({ enabled: z.boolean().optional() })).optional(),
      features: z
        .looseObject({
          hooks: z.boolean().optional(),
          apps: z.boolean().optional(),
          plugins: z.boolean().optional(),
        })
        .optional(),
    }),
  }),
  thread: z.object({
    thread: z.object({ id: z.string() }),
    sandbox: sandboxPolicySchema.optional(),
    approvalPolicy: z.string(),
    approvalsReviewer: z.string(),
    cwd: z.string(),
    model: z.string(),
    instructionSources: z.array(z.string()).optional(),
  }),
  turn: z.object({ turn: z.object({ id: z.string() }) }),
  exec: z.object({ exitCode: z.number(), stdout: z.string().optional(), stderr: z.string().optional() }),
};

type Call = {
  resolve: (result: Json | undefined) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type CodexOptions = { command?: string; args?: string[]; cwd?: string };

export const sandbox = (
  cwd: string,
  { roots = [], network = false }: { roots?: string[]; network?: boolean } = {},
) => ({
  type: 'workspaceWrite',
  writableRoots: [cwd, ...roots],
  networkAccess: network,
  excludeSlashTmp: true,
  excludeTmpdirEnvVar: true,
});

export type CodexOverrides = Record<string, string | boolean>;

export function isolatedConfig(config: { mcp_servers?: Record<string, { enabled?: boolean }> }) {
  const overrides = new Map<string, string | boolean>(Object.entries(disabledFeatures));

  for (const name of Object.keys(config.mcp_servers ?? {})) {
    if (!/^[\w-]+$/.test(name))
      throw new Error(
        'Unsupported MCP server name in the existing profile. Use a dedicated Codex profile for this runner.',
      );
    overrides.set(`mcp_servers.${name}.enabled`, false);
  }

  return Object.fromEntries(overrides);
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
      if (error instanceof MissingCommandError)
        throw new Error(
          `Codex CLI was not found. Install codex-cli ${supportedVersion}: setup and checks use it for every agent.`,
        );
      throw new Error(`Could not run codex --version: ${thrownSchema.parse(error).message}`);
    }

    const version = output.trim().replace('codex-cli ', '');

    if (version !== supportedVersion)
      throw new Error(
        `Codex ${version} is installed; this adapter supports ${supportedVersion}. Regenerate and verify the protocol before upgrading.`,
      );

    return version;
  }

  async connect() {
    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: safeEnv(),
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child = child;
    this.emit('spawned', child.pid);
    child.on('error', error => this.fail(error));
    child.on('exit', () => this.fail(new Error('Codex connection closed')));
    child.stdin.on('error', error => this.fail(error));
    child.stderr.resume();
    this.reader = createInterface({ input: child.stdout });
    this.reader.on('line', line => this.receive(line));
    await this.request('initialize', { clientInfo, capabilities: { experimentalApi: true } }, codexResults.ack);
    this.send({ method: 'initialized', params: {} });
  }

  send(message: CodexOutgoing) {
    if (!this.child?.stdin.writable) throw new Error('Codex is disconnected');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request<Result extends z.ZodType>(
    method: string,
    params: JsonArguments,
    result: Result,
    timeoutMs = 30_000,
  ): Promise<z.infer<Result>> {
    const id = ++this.sequence;

    return new Promise<z.infer<Result>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);

      this.calls.set(id, {
        resolve: value => {
          const parsed = result.safeParse(value);

          if (parsed.success) resolve(parsed.data);
          else reject(new Error(`Codex returned an unexpected ${method} result`));
        },
        reject,
        timer,
      });

      try {
        this.send({ id, method, params });
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
      message = codexMessageSchema.parse(JSON.parse(line));
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
