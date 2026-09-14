import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isFinished, type Autonomy } from '../shared/domain';
import type { AgentProbe, AgentRequest, CommandResult, PromptImage, Question, QuestionOption, Task, Worktree } from '../shared/types';
import { claudeSandbox, claudeTools, factoryServer, factoryServerName, isFactoryTool, openClaude, probeClaude, supportedClaudeVersion, type ClaudeQuery, type McpServerConfig, type ModelInfo, type PermissionResult, type SDKMessage, type ToolRequestOptions } from './agents/claude';
import { Codex, isolatedConfig, sandbox, type CodexMessage } from './agents/codex';
import { openOpencode, probeOpencode, type OpencodeEvent, type OpencodeSession, type OpenOpencode } from './agents/opencode';
import { PreviewSession, previewToolSpecs, runPreviewTool } from './browser';
import { combineInstructions, developerInstructions, resolveCheck, taskPrompt, withAttachments } from './checks';
import { baseTree, candidateTree, createWorktree, detectRecipe, exportPatch, inspectRepo, pathExists } from './git';
import { loadInstructions } from './instructions';
import type { LiveApps } from './live';
import { capturePreview, previewSummary, type Browser, type Capture } from './preview';
import type { Store } from './store';
import { dataUrl, isImage, Uploads } from './uploads';
import { validAutonomy } from './validation';

const maxAttempts = 3;
const probeTtlMs = 60_000;
const outputLimit = 12_000;
const execOutputBytes = 24_000;
const setupTimeoutMs = 1_200_000;
const timedOutExit = 124;
const missingCommandExit = 71;
const checkTimeoutMs = 120_000;
const retryNote = 'The check failed. Read its output, fix the cause, and keep every test passing.';
const standingAnswer = 'Use your best judgment from the task description and keep going.';
const codexRequestMethods = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput'];
const autonomyLabels: Record<Autonomy, string> = { ask: 'ask me', sandboxed: 'automatic, sandboxed', full: 'automatic, full access' };

type Decision = 'accept' | 'decline' | 'cancel';
type Reply = { answers: Record<string, string> } | { decision: Decision };
type PendingRequest = AgentRequest & { reply: (reply: Reply) => unknown; cancel?: (reason: string) => void };
type AgentSession = { interrupt: () => unknown; close: () => void };
type ExecOptions = { cwd: string; network: boolean; timeoutMs: number };

export type TurnResult = { status: string; error?: { message: string } };

export type Run = {
  id: string;
  client: Codex;
  agent?: AgentSession;
  autonomy: Autonomy;
  pending: Map<string, PendingRequest>;
  turn: Promise<TurnResult>;
  finishTurn: (result: TurnResult) => void;
  execOutput?: { stdout: string; stderr: string; decoders: Record<'stdout' | 'stderr', TextDecoder> };
  done?: Promise<void>;
  canceled: boolean;
  cancelReason?: string;
  limitMs: number;
  remainingMs: number;
  deadline: number;
  timer: ReturnType<typeof setTimeout> | null;
  threadId?: string;
  turnId?: string;
  processId?: string | null;
  lastMessage?: string;
  checkFailed?: boolean;
  preview?: PreviewSession;
};

type RunnerOptions = {
  adapter?: () => Codex;
  version?: () => Promise<string>;
  claudeQuery?: ClaudeQuery;
  opencode?: OpenOpencode;
  opencodeProbe?: (root: string) => Promise<AgentProbe>;
  home?: string;
  capture?: Capture;
  browser?: Browser;
  servicePort?: number;
  live?: Pick<LiveApps, 'start' | 'release'>;
};

// The sandbox blocks writes under HOME, so package managers need caches inside a writable root.
const toolEnv = (cache: string, tmp: string) => ({
  TMPDIR: tmp,
  XDG_CACHE_HOME: cache,
  XDG_DATA_HOME: cache,
  npm_config_cache: join(cache, 'npm'),
  YARN_CACHE_FOLDER: join(cache, 'yarn'),
  COREPACK_HOME: join(cache, 'corepack'),
  BUN_INSTALL_CACHE_DIR: join(cache, 'bun'),
  PIP_CACHE_DIR: join(cache, 'pip'),
});

const now = () => new Date().toISOString();
const failure = (message: string): TurnResult => ({ status: 'failed', error: { message } });
const excerpt = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value ?? '')).slice(-outputLimit);
const withoutImages = (value: unknown) => Array.isArray(value) ? value.map(item => ['image', 'inputImage'].includes(item?.type) ? { type: 'image' } : item) : value;
const toolLabel = (name: string, input: Record<string, any> = {}) => `${name.replace(`mcp__${factoryServerName}__`, '')}: ${input.command ?? input.file_path ?? input.pattern ?? input.path ?? input.action ?? ''}`;
const publicRequests = (run: Run): AgentRequest[] => [...run.pending.values()].map(({ reply, cancel, ...request }) => request);

const toQuestions = (questions: { question: string; options?: QuestionOption[] }[] = []): Question[] =>
  questions.map((question, index) => ({ id: String(index), question: question.question, options: question.options }));

function ensureActive(run: Run) {
  if (run.canceled) throw new Error('Run canceled');
}

function setupFailure({ exitCode, stderr = '' }: CommandResult, command: string[], timeoutMs: number) {
  if (exitCode === timedOutExit) return `Setup ran past its ${Math.round(timeoutMs / 60_000)}-minute limit. Run ${command.join(' ')} in the repository first, then start the task again.`;
  const missing = exitCode === missingCommandExit ? stderr.match(/execvp\(\) of '([^']+)' failed/)?.[1] : undefined;
  if (missing) return `${missing} is not installed, so setup could not run. Install it, or set a different setup command on the task.`;
  return 'Setup failed. Inspect its output and the preserved worktree.';
}

function collectAnswers(questions: Question[] = [], input: Record<string, any>) {
  return Object.fromEntries(questions.map(question => {
    const answer = input.answers?.[question.id];
    if (typeof answer !== 'string' || !answer.trim() || answer.length > 4000) throw new Error('Answer each question');
    return [question.id, answer];
  }));
}

function validDecision(value: unknown): Decision {
  if (value !== 'accept' && value !== 'decline' && value !== 'cancel') throw new Error('Invalid decision');
  return value;
}

const ownerDecisions: Record<Decision, string> = { accept: 'You allowed it', decline: 'You declined it', cancel: 'You stopped the turn' };

function answerSummary(request: PendingRequest, reply: Reply, automatic: boolean) {
  if (!('decision' in reply)) return automatic ? 'Answered: use your best judgment' : 'You answered';
  if (!automatic) return ownerDecisions[reply.decision];
  return `${reply.decision === 'accept' ? 'Allowed' : 'Declined'} ${request.params.tool ?? 'the request'} automatically`;
}

function claudePermission(reply: Reply, input: Record<string, unknown>): PermissionResult {
  if ('decision' in reply && reply.decision === 'accept') return { behavior: 'allow', updatedInput: input };
  const canceled = 'decision' in reply && reply.decision === 'cancel';
  return { behavior: 'deny', message: canceled ? 'The owner canceled this request and the turn.' : 'The owner declined this request.', interrupt: canceled };
}

type ClaudePolicy = { version: string; cwd: string; model: string; permissionMode: string; tools: string[]; mcpServers: { name: string }[]; plugins: unknown[] };

async function claudePolicyMatches(policy: ClaudePolicy, worktree: Worktree, model: ModelInfo) {
  const sameCwd = (await realpath(policy.cwd)) === (await realpath(worktree.path));
  return policy.version === supportedClaudeVersion
    && sameCwd
    && policy.permissionMode === 'acceptEdits'
    && policy.mcpServers.every(server => server.name === factoryServerName)
    && !policy.plugins.length
    && policy.tools.every(tool => claudeTools.includes(tool) || isFactoryTool(tool))
    && (!model.resolvedModel || policy.model === model.resolvedModel);
}

export class Runner {
  readonly runs = new Map<string, Run>();
  recovery: Task[];
  adapter: () => Codex;
  version: () => Promise<string>;
  claudeQuery?: ClaudeQuery;
  opencode: OpenOpencode;
  opencodeProbe: (root: string) => Promise<AgentProbe>;
  private readonly store: Store;
  private readonly root: string;
  private readonly home: string;
  private readonly capture?: Capture;
  private readonly browser?: Browser;
  private readonly servicePort?: number;
  private readonly live?: Pick<LiveApps, 'start' | 'release'>;
  private readonly probes = new Map<string, { at: number; result: AgentProbe }>();
  private readonly uploads: Uploads;

  constructor(store: Store, root: string, options: RunnerOptions = {}) {
    this.store = store;
    this.root = root;
    this.home = options.home ?? homedir();
    this.capture = options.capture;
    this.browser = options.browser;
    this.servicePort = options.servicePort;
    this.live = options.live;
    this.adapter = options.adapter ?? (() => new Codex({ cwd: root }));
    this.version = options.version ?? Codex.version;
    this.claudeQuery = options.claudeQuery;
    this.opencode = options.opencode ?? openOpencode;
    this.opencodeProbe = options.opencodeProbe ?? probeOpencode;
    this.recovery = store.activeTasks();
    this.uploads = new Uploads(root);
  }

  async probe(harness: string) {
    const recovery = this.recovery.map(task => task.id);
    const cached = this.probes.get(harness);
    if (cached && Date.now() - cached.at < probeTtlMs) return { ...cached.result, recovery };
    const result = await this.probeHarness(harness);
    if (result.authenticated) this.probes.set(harness, { at: Date.now(), result });
    return { ...result, recovery };
  }

  start(id: string, feedback = '', automatic = false) {
    if (this.recovery.length) throw new Error('A previous run was interrupted by a service restart. Restart the machine to stop orphaned tools, then acknowledge recovery.');
    if (this.runs.has(id)) throw new Error('This task is already running');
    const task = this.store.require(id);
    if (task.commit) throw new Error('These changes are already committed. Create a new task for further changes.');
    if (task.worktreeRemoved) throw new Error("This task's worktree was removed. Create a new task instead.");
    this.store.claim(id, task.worktree ? ['handoff', 'failed', 'canceled', 'interrupted'] : ['queued']);
    void this.live?.release(id);
    if (task.worktree) {
      const attempt = (task.attempt ?? 1) + 1;
      this.store.update(id, { attempt, feedback, feedbackSource: automatic ? 'factory' : 'owner', error: null, settled: null });
      this.store.event(id, 'retry', automatic ? `Attempt ${attempt}: retrying the failed check` : feedback ? `Attempt ${attempt}: ${feedback}` : `Attempt ${attempt}`);
    }
    const autonomy = task.autonomy ?? 'ask';
    const limitMs = (autonomy === 'ask' ? 15 : 45) * 60_000;
    const { promise: turn, resolve: finishTurn } = Promise.withResolvers<TurnResult>();
    const run: Run = { id, client: this.adapter(), autonomy, pending: new Map(), turn, finishTurn, canceled: false, limitMs, remainingMs: limitMs, deadline: 0, timer: null };
    this.runs.set(id, run);
    run.done = this.execute(run);
    return this.store.require(id);
  }

  setAutonomy(id: string, autonomy: unknown) {
    const level = validAutonomy(autonomy);
    const task = this.store.require(id);
    if (task.commit || task.worktreeRemoved) throw new Error('This task is finished. Create a new task instead.');
    this.store.update(id, { autonomy: level });
    this.store.event(id, 'autonomy', `Permissions: ${autonomyLabels[level]}`);
    const run = this.runs.get(id);
    if (run && !run.canceled) {
      run.autonomy = level;
      for (const key of [...run.pending.keys()]) this.autoAnswer(run, key);
    }
    return this.store.require(id);
  }

  answer(id: string, key: string, input: Record<string, any>, automatic = false) {
    const run = this.runs.get(id);
    const request = run?.pending.get(key);
    if (!run || !request || run.canceled) throw new Error('This request is no longer active');
    const reply: Reply = request.kind === 'question' ? { answers: collectAnswers(request.params.questions, input) } : { decision: validDecision(input.decision) };
    request.reply(reply);
    run.pending.delete(key);
    this.showRequests(run);
    const details = automatic && 'decision' in reply ? { tool: request.params.tool, command: request.params.command } : {};
    this.store.event(id, 'request_answered', answerSummary(request, reply, automatic), details);
  }

  cancel(id: string, reason = 'Stopped by you') {
    const run = this.runs.get(id);
    if (!run) {
      if (this.store.get(id)?.status !== 'queued') throw new Error('Task is not active');
      this.store.update(id, { status: 'canceled' });
      this.store.event(id, 'canceled', reason);
      return;
    }
    run.canceled = true;
    run.cancelReason = reason;
    for (const request of run.pending.values()) request.cancel?.(reason);
    run.pending.clear();
    this.store.update(id, { status: 'canceling', requests: [] });
    run.finishTurn({ status: 'interrupted' });
    if (run.threadId && run.turnId) run.client.request('turn/interrupt', { threadId: run.threadId, turnId: run.turnId }, 1000).catch(() => undefined);
    if (run.processId) run.client.request('command/exec/terminate', { processId: run.processId }, 1000).catch(() => undefined);
    run.agent?.interrupt();
    run.agent?.close();
    run.client.close();
  }

  syncClock(run: Run) {
    if (run.canceled || !run.limitMs) return;
    if (run.pending.size && run.timer) {
      clearTimeout(run.timer);
      run.timer = null;
      run.remainingMs = Math.max(0, run.deadline - Date.now());
    } else if (!run.pending.size && !run.timer) {
      run.deadline = Date.now() + run.remainingMs;
      run.timer = setTimeout(() => this.cancel(run.id, `Run exceeded its ${run.limitMs / 60_000}-minute limit of working time`), run.remainingMs);
    }
  }

  async shutdown() {
    const running = [...this.runs.values()];
    for (const run of running) this.cancel(run.id, 'Local service stopped');
    await Promise.all(running.map(run => run.done));
  }

  recover() {
    for (const task of this.recovery) {
      for (const pid of [task.harnessPid, task.agentPid]) {
        if (pid && processExists(pid)) throw new Error(`Recorded process ${pid} still exists. Stop its process tree or restart the machine before recovery.`);
      }
      this.store.update(task.id, { status: 'interrupted', requests: [], error: 'Service stopped unexpectedly. Worktree preserved; inspect it before creating another task.' });
      this.store.event(task.id, 'interrupted', 'Recovery acknowledged');
    }
    this.recovery = [];
  }

  private async probeHarness(harness: string): Promise<AgentProbe> {
    if (harness === 'claude') return probeClaude(this.claudeQuery);
    if (harness === 'opencode') return this.opencodeProbe(this.root);
    const client = this.adapter();
    try {
      const version = await this.version();
      await client.connect();
      const account = await client.request('account/read', { refreshToken: false });
      const models = await client.request('model/list', { limit: 100 });
      return {
        harness: 'codex',
        version,
        authenticated: Boolean(account.account),
        models: models.data.map((model: { model: string; displayName: string; isDefault: boolean }) => ({ id: model.model, name: model.displayName, isDefault: model.isDefault })),
      };
    } finally {
      client.close();
    }
  }

  private async execute(run: Run) {
    const { id } = run;
    this.syncClock(run);
    this.listenToCodex(run);
    try {
      const task = this.store.require(id);
      const followUp = Boolean(task.worktree);
      const overrides = await this.connect(run, task, followUp);
      const worktree = await this.prepareWorktree(run, task);
      ensureActive(run);
      const setupRan = followUp ? task.setupResult?.command ?? [] : await this.runSetup(run, task, worktree);
      const instructions = await this.loadInstructions(task, worktree);
      const attachments = await this.uploads.load(task.attachments);
      await this.startAgent(run, task, worktree, instructions, withAttachments(taskPrompt(task, setupRan, followUp), attachments), attachments.filter(isImage), overrides);
      const turn = await run.turn;
      await run.preview?.close();
      ensureActive(run);
      if (turn.status !== 'completed') throw new Error(turn.error?.message || `Agent turn ${turn.status}`);
      if (run.pending.size) throw new Error('Agent finished with unresolved requests');
      await this.verify(run, task, worktree);
    } catch (error) {
      const reason = run.canceled ? run.cancelReason ?? 'Run canceled' : (error as Error).message;
      this.store.update(id, { status: run.canceled ? 'canceled' : 'failed', error: reason, requests: [] });
      this.store.event(id, run.canceled ? 'canceled' : 'failed', reason);
    } finally {
      await this.finish(run);
    }
  }

  private async connect(run: Run, task: Task, followUp: boolean) {
    await this.version();
    if (!followUp) {
      const repo = await inspectRepo(task.repo.path);
      if (repo.base !== task.repo.base) throw new Error('Repository HEAD changed since setup. Save a new task against the current revision.');
    }
    ensureActive(run);
    await run.client.connect();
    ensureActive(run);
    if ((task.harness ?? 'codex') !== 'codex') return undefined;
    const account = await run.client.request('account/read', { refreshToken: false });
    if (!account.account) throw new Error('Codex is not signed in. Run codex login in your terminal, then create a new task.');
    const { config } = await run.client.request('config/read', { includeLayers: false });
    const overrides = isolatedConfig(config);
    const models = await run.client.request('model/list', { limit: 100 });
    if (!models.data.some((model: { model: string }) => model.model === task.model)) throw new Error('Selected model is unavailable');
    return overrides;
  }

  private async prepareWorktree(run: Run, task: Task) {
    ensureActive(run);
    const harnessPid = run.client.child?.pid;
    if (task.worktree) {
      if (!(await pathExists(task.worktree.path))) throw new Error('The worktree no longer exists. Create a new task.');
      this.store.update(run.id, { harnessPid });
      this.store.event(run.id, 'prepared', 'Reusing the worktree', { path: task.worktree.path });
      return task.worktree;
    }
    const worktree = await createWorktree(task.repo, join(this.root, '.factory/worktrees'), run.id);
    this.store.update(run.id, { worktree, harnessPid });
    this.store.event(run.id, 'prepared', 'Worktree created', { path: worktree.path });
    return worktree;
  }

  private async runSetup(run: Run, task: Task, worktree: Worktree) {
    const setup = task.setup.length ? task.setup : (await detectRecipe(worktree.path))?.setup ?? [];
    if (!setup.length) return setup;
    this.store.event(run.id, 'setup', `Setup with network: ${setup.join(' ')}`, { source: task.setup.length ? 'owner' : 'lockfile' });
    const result = await this.exec(run, 'setup', setup, { cwd: worktree.path, network: true, timeoutMs: setupTimeoutMs });
    ensureActive(run);
    this.store.update(run.id, { setupResult: result });
    this.store.event(run.id, 'setup_result', result.exitCode === 0 ? 'Setup done' : `Setup failed: exit ${result.exitCode}`, { exitCode: result.exitCode, durationMs: result.durationMs, stdout: result.stdout, stderr: result.stderr });
    if (result.exitCode !== 0) throw new Error(setupFailure(result, setup, setupTimeoutMs));
    if ((await candidateTree(worktree.path)) !== (await baseTree(worktree.path, task.repo.base))) throw new Error('Setup changed repository files. Ignore generated paths in .gitignore or use a command that keeps the lockfile unchanged.');
    return setup;
  }

  private async loadInstructions(task: Task, worktree: Worktree) {
    const role = await readFile(join(this.root, 'agents/implementer.md'), 'utf8');
    const context = await loadInstructions({ harness: task.harness ?? 'codex', worktree: worktree.path, home: this.home, env: process.env });
    const instructions = combineInstructions(role, context.text);
    this.store.update(task.id, { instructions, instructionDigest: createHash('sha256').update(instructions).digest('hex'), instructionFiles: context.files });
    return developerInstructions(instructions);
  }

  private startAgent(run: Run, task: Task, worktree: Worktree, instructions: string, prompt: string, images: PromptImage[], overrides?: Record<string, unknown>) {
    if (task.harness !== 'opencode') run.preview = new PreviewSession({ task, cwd: worktree.path, root: this.root, servicePort: this.servicePort, browser: this.browser });
    if (task.harness === 'claude') return this.startClaude(run, task, worktree, instructions, prompt, images);
    if (task.harness === 'opencode') return this.startOpencode(run, task, worktree, instructions, prompt, images);
    return this.startCodex(run, task, worktree, instructions, prompt, images, overrides);
  }

  private async startCodex(run: Run, task: Task, worktree: Worktree, instructions: string, prompt: string, images: PromptImage[], overrides?: Record<string, unknown>) {
    const { id, client } = run;
    const thread = await client.request('thread/start', { cwd: worktree.path, model: task.model, allowProviderModelFallback: false, sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user', developerInstructions: instructions, config: overrides, dynamicTools: previewToolSpecs() });
    const policyApplied = thread.sandbox?.type === 'workspaceWrite' && !thread.sandbox.networkAccess && thread.approvalPolicy === 'on-request' && thread.approvalsReviewer === 'user' && thread.cwd === worktree.path && thread.model === task.model;
    if (!policyApplied) throw new Error('Harness did not apply the requested run policy');
    run.threadId = thread.thread.id;
    this.store.update(id, { threadId: run.threadId, status: 'running', instructionSources: thread.instructionSources ?? [], sandbox: sandbox(worktree.path) });
    ensureActive(run);
    this.store.event(id, 'running', 'Codex started', { harness: 'codex', model: task.model });
    const input = [...images.map(image => ({ type: 'inputImage', imageUrl: dataUrl(image) })), { type: 'text', text: prompt }];
    const response = await client.request('turn/start', { threadId: run.threadId, sandboxPolicy: sandbox(worktree.path), input });
    run.turnId = response.turn.id;
    this.store.update(id, { turnId: run.turnId });
  }

  private listenToCodex(run: Run) {
    const { id, client } = run;
    client.on('spawned', (pid: number) => this.store.update(id, { harnessPid: pid }));
    client.on('disconnected', (error: Error) => run.finishTurn(failure(error.message)));
    client.on('request', (message: CodexMessage) => this.codexRequest(run, message));
    client.on('notification', (message: CodexMessage) => this.codexNotification(run, message));
  }

  private async previewTool(run: Run, preview: PreviewSession, name: string, input: unknown) {
    const result = await runPreviewTool(preview, name, input);
    for (const item of result.content) {
      if (item.type === 'image' && !run.canceled) this.store.event(run.id, 'screenshot', item.shot.name === 'mobile' ? 'Phone screenshot' : 'Desktop screenshot', { images: [item.shot] });
    }
    return result;
  }

  private async codexTool(run: Run, { id, params = {} }: CodexMessage) {
    const result = run.preview && params.threadId === run.threadId
      ? await this.previewTool(run, run.preview, params.tool, params.arguments)
      : { content: [{ type: 'text' as const, text: 'This tool is not available in this thread' }], error: true };
    if (run.canceled) return;
    const contentItems = result.content.map(item => item.type === 'text' ? { type: 'inputText', text: item.text } : { type: 'inputImage', imageUrl: `data:image/png;base64,${item.data}` });
    try {
      run.client.send({ id, result: { success: !result.error, contentItems } });
    } catch (error) {
      this.store.event(run.id, 'error', `Tool result not sent: ${(error as Error).message}`);
    }
  }

  private codexRequest(run: Run, message: CodexMessage) {
    const { client } = run;
    if (message.method === 'item/tool/call' && !run.canceled) {
      void this.codexTool(run, message);
      return;
    }
    if (!message.method || !codexRequestMethods.includes(message.method) || run.canceled) {
      client.send({ id: message.id, error: { code: -32601, message: 'This client does not support this request. No permission granted.' } });
      this.store.event(run.id, 'request_denied', `Blocked ${message.method}`);
      return;
    }
    const params = message.params ?? {};
    if (run.threadId && params.threadId !== run.threadId) {
      client.send({ id: message.id, error: { code: -32602, message: 'Thread mismatch' } });
      return;
    }
    this.hold(run, {
      key: String(message.id),
      id: message.id,
      kind: message.method === 'item/tool/requestUserInput' ? 'question' : 'approval',
      method: message.method,
      params,
      reply: reply => client.send({
        id: message.id,
        result: 'decision' in reply
          ? { decision: reply.decision }
          : { answers: Object.fromEntries(Object.entries(reply.answers).map(([questionId, answer]) => [questionId, { answers: [answer] }])) },
      }),
    });
  }

  private codexNotification(run: Run, { method, params = {} }: CodexMessage) {
    if (run.canceled) return;
    if (params.threadId && run.threadId && params.threadId !== run.threadId) return;
    switch (method) {
      case 'turn/started':
        run.turnId = params.turn.id;
        this.store.update(run.id, { turnId: run.turnId });
        break;
      case 'item/started':
        if (params.item.type === 'commandExecution') {
          this.store.event(run.id, 'tool_started', params.item.command, { toolId: params.item.id });
          this.store.progress.set(run.id, params.item.id, 'output', '', params.item.command);
        }
        if (params.item.type === 'dynamicToolCall') this.store.event(run.id, 'tool_started', toolLabel(params.item.tool, params.item.arguments), { tool: params.item.tool, toolId: params.item.id });
        break;
      case 'item/commandExecution/outputDelta':
        this.store.progress.append(run.id, params.itemId, 'output', params.delta);
        break;
      case 'item/agentMessage/delta':
        this.store.progress.append(run.id, params.itemId, 'message', params.delta);
        break;
      case 'command/exec/outputDelta': {
        const output = run.execOutput;
        if (!output || params.processId !== run.processId) break;
        const stream: 'stdout' | 'stderr' = params.stream === 'stderr' ? 'stderr' : 'stdout';
        const text = output.decoders[stream].decode(Buffer.from(params.deltaBase64, 'base64'), { stream: true });
        output[stream] = (output[stream] + text).slice(-execOutputBytes);
        this.store.progress.append(run.id, params.processId, 'output', text);
        break;
      }
      case 'item/completed':
        this.store.progress.end(run.id, params.item.id);
        this.recordCodexItem(run, params.item);
        break;
      case 'serverRequest/resolved':
        run.pending.delete(String(params.requestId));
        this.showRequests(run);
        break;
      case 'error':
        this.store.event(run.id, 'error', params.error?.message || 'Harness error');
        break;
      case 'turn/completed':
        run.finishTurn(params.turn);
        break;
    }
  }

  private recordCodexItem(run: Run, item: Record<string, any>) {
    if (item.type === 'agentMessage') this.recordMessage(run, item.text);
    else if (item.type === 'commandExecution') this.store.event(run.id, 'command', item.command, { toolId: item.id, status: item.status, exitCode: item.exitCode, output: String(item.aggregatedOutput || '').slice(-outputLimit) });
    else if (item.type === 'dynamicToolCall') this.recordToolResult(run, item.id, item.success === false, item.contentItems);
    else if (item.type === 'fileChange') this.store.event(run.id, 'files', 'Changed files', { status: item.status, paths: (item.changes ?? []).map((change: { path: string }) => change.path) });
  }

  private async startClaude(run: Run, task: Task, worktree: Worktree, instructions: string, prompt: string, images: PromptImage[]) {
    const preview = run.preview;
    const mcpServers: Record<string, McpServerConfig> = preview ? { [factoryServerName]: factoryServer((name, input) => this.previewTool(run, preview, name, input)) } : {};
    const session = openClaude({ query: this.claudeQuery, cwd: worktree.path, model: task.model, instructions, mcpServers, canUseTool: (toolName, input, options) => this.claudeRequest(run, toolName, input, options) });
    run.agent = session;
    const { models, pid } = await session.info();
    ensureActive(run);
    const model = models.find(candidate => candidate.value === task.model);
    if (!model) throw new Error('Selected model is unavailable');
    this.store.update(run.id, { status: 'running', agentPid: pid, sandbox: claudeSandbox });
    this.store.event(run.id, 'running', 'Claude started', { harness: 'claude', model: task.model });
    void this.pump(run, session.messages, message => this.handleClaudeMessage(run, message, worktree, model), 'Claude session ended without a result');
    session.send(prompt, images);
  }

  private async handleClaudeMessage(run: Run, message: SDKMessage, worktree: Worktree, model: ModelInfo) {
    if (message.type === 'system' && message.subtype === 'init') {
      const policy = { version: message.claude_code_version, cwd: message.cwd, model: message.model, permissionMode: message.permissionMode, tools: message.tools, mcpServers: message.mcp_servers, plugins: message.plugins };
      this.store.update(run.id, { agentPolicy: policy });
      if (!(await claudePolicyMatches(policy, worktree, model))) {
        run.finishTurn(failure('Claude did not apply the requested run policy'));
        return true;
      }
    } else if (message.type === 'stream_event') {
      const { event } = message;
      if (!message.parent_tool_use_id && event.type === 'content_block_delta' && event.delta.type === 'text_delta') this.store.progress.append(run.id, `text-${event.index}`, 'message', event.delta.text);
    } else if (message.type === 'assistant') {
      this.store.progress.end(run.id);
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text.trim()) this.recordMessage(run, block.text);
        if (block.type === 'tool_use') {
          const input = block.input as Record<string, unknown>;
          this.store.event(run.id, 'tool_started', toolLabel(block.name, input), { tool: block.name, toolId: block.id });
        }
      }
    } else if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type === 'tool_result') this.recordToolResult(run, block.tool_use_id, block.is_error, block.content);
      }
    } else if (message.type === 'system' && message.subtype === 'api_retry') {
      this.store.event(run.id, 'retry', `Claude API retry ${message.attempt} of ${message.max_retries}: ${message.error}`, { status: message.error_status, delayMs: message.retry_delay_ms });
    } else if (message.type === 'system' && message.subtype === 'permission_denied') {
      this.store.event(run.id, 'request_denied', `${message.tool_name}: ${message.message}`);
    } else if (message.type === 'result') {
      this.recordUsage(run, { costUsd: message.total_cost_usd, turns: message.num_turns, durationMs: message.duration_ms, modelUsage: message.modelUsage, permissionDenials: message.permission_denials }, { modelUsage: message.modelUsage });
      const succeeded = message.subtype === 'success' && !message.is_error;
      const reason = (message.subtype === 'success' ? message.result : message.errors.join('; ')) || message.subtype;
      run.finishTurn(succeeded ? { status: 'completed' } : failure(reason));
      return true;
    }
    return false;
  }

  private claudeRequest(run: Run, toolName: string, input: Record<string, any>, options: ToolRequestOptions) {
    return new Promise<PermissionResult>(resolve => {
      if (run.canceled) return resolve({ behavior: 'deny', message: 'Run canceled', interrupt: true });
      if (isFactoryTool(toolName)) return resolve({ behavior: 'allow', updatedInput: input });
      const key = options.toolUseID || randomUUID();
      const cancel = (reason: string) => resolve({ behavior: 'deny', message: reason, interrupt: true });
      options.signal.addEventListener('abort', () => {
        if (!run.pending.delete(key)) return;
        resolve({ behavior: 'deny', message: 'Request aborted' });
        this.showRequests(run);
      }, { once: true });
      if (toolName === 'AskUserQuestion') {
        const questions = toQuestions(input.questions);
        this.hold(run, {
          key,
          kind: 'question',
          params: { questions },
          cancel,
          reply: reply => 'answers' in reply && resolve({ behavior: 'allow', updatedInput: { questions: input.questions, answers: Object.fromEntries(questions.map(question => [question.question, reply.answers[question.id]])) } }),
        }, { tool: toolName });
        return;
      }
      const network = toolName === 'SandboxNetworkAccess';
      const reason = network ? `Claude wants network access to ${input.host}` : options.title || options.decisionReason || `Claude wants to use ${toolName}`;
      const command = network ? String(input.host) : typeof input.command === 'string' ? input.command : JSON.stringify(input, null, 2);
      this.hold(run, { key, kind: 'approval', params: { tool: toolName, reason, command, blockedPath: options.blockedPath }, cancel, reply: reply => resolve(claudePermission(reply, input)) }, { tool: toolName });
    });
  }

  private async startOpencode(run: Run, task: Task, worktree: Worktree, instructions: string, prompt: string, images: PromptImage[]) {
    const session = await this.opencode({ root: this.root, runId: run.id, cwd: worktree.path, model: task.model, instructions });
    run.agent = session;
    ensureActive(run);
    if (!session.models.some(model => model.id === task.model)) throw new Error('Selected model is unavailable');
    this.store.update(run.id, { status: 'running', agentPid: session.pid, agentPolicy: session.policy });
    this.store.event(run.id, 'running', 'OpenCode started', { harness: 'opencode', model: task.model, sandbox: session.policy.writable });
    void this.pump(run, session.events, event => this.handleOpencodeEvent(run, session, event), 'OpenCode stopped sending events before the turn finished');
    await session.send(prompt, images);
  }

  private handleOpencodeEvent(run: Run, session: OpencodeSession, event: OpencodeEvent) {
    switch (event.type) {
      case 'draft':
        this.store.progress.set(run.id, event.key, 'message', event.text);
        return false;
      case 'message':
        this.store.progress.end(run.id);
        this.recordMessage(run, event.text);
        return false;
      case 'tool_started':
        this.store.event(run.id, 'tool_started', event.text, { tool: event.tool, toolId: event.toolId });
        return false;
      case 'tool_result':
        this.recordToolResult(run, event.toolId, event.error, event.output);
        return false;
      case 'permission':
      case 'question':
        this.opencodeRequest(run, session, event);
        return false;
      case 'idle':
        this.recordUsage(run, { costUsd: event.costUsd, turns: event.turns });
        run.finishTurn(event.error ? failure(event.error) : { status: 'completed' });
        return true;
    }
  }

  private opencodeRequest(run: Run, session: OpencodeSession, event: Extract<OpencodeEvent, { type: 'permission' | 'question' }>) {
    const key = event.id;
    const report = (error: Error) => this.store.event(run.id, 'error', `Reply not sent: ${error.message}`);
    if (event.type === 'question') {
      const questions = toQuestions(event.questions);
      this.hold(run, {
        key,
        kind: 'question',
        params: { questions },
        reply: reply => 'answers' in reply && session.replyQuestion(key, questions.map(question => [reply.answers[question.id]])).catch(report),
      }, { tool: 'question' });
      return;
    }
    this.hold(run, {
      key,
      kind: 'approval',
      params: { tool: event.permission, reason: `OpenCode wants ${event.permission.replaceAll('_', ' ')} permission`, command: event.patterns.join('\n') || JSON.stringify(event.metadata, null, 2) },
      reply: reply => session.replyPermission(key, 'decision' in reply && reply.decision === 'accept' ? 'once' : 'reject').catch(report),
    }, { tool: event.permission });
  }

  private async pump<T>(run: Run, stream: AsyncIterable<T>, handle: (item: T) => boolean | Promise<boolean>, endedEarly: string) {
    try {
      for await (const item of stream) {
        if (run.canceled || (await handle(item))) return;
      }
      run.finishTurn(failure(endedEarly));
    } catch (error) {
      run.finishTurn(failure((error as Error).message));
    }
  }

  private hold(run: Run, request: PendingRequest, details: Record<string, unknown> = {}) {
    run.pending.set(request.key, request);
    if (this.autoAnswer(run, request.key)) return;
    this.showRequests(run);
    this.store.event(run.id, 'request', request.kind === 'question' ? 'Needs your answer' : 'Needs your approval', details);
  }

  private autoAnswer(run: Run, key: string) {
    const request = run.pending.get(key);
    if (run.autonomy === 'ask' || !request) return false;
    const input = request.kind === 'question'
      ? { answers: Object.fromEntries((request.params.questions ?? []).map(question => [question.id, standingAnswer])) }
      : { decision: run.autonomy === 'full' ? 'accept' : 'decline' };
    this.answer(run.id, key, input, true);
    return true;
  }

  private showRequests(run: Run) {
    this.store.update(run.id, { requests: publicRequests(run), status: run.pending.size ? 'awaiting_approval' : 'running' });
    this.syncClock(run);
  }

  private recordMessage(run: Run, text: string) {
    run.lastMessage = text;
    this.store.event(run.id, 'message', text);
  }

  private recordToolResult(run: Run, toolId: string | undefined, error: boolean | undefined, output: unknown) {
    this.store.event(run.id, 'tool_result', error ? 'Tool returned an error' : 'Tool completed', { toolId, error: Boolean(error), output: excerpt(withoutImages(output)) });
  }

  private recordUsage(run: Run, { costUsd, turns, ...details }: { costUsd: number; turns: number; [key: string]: unknown }, eventDetails?: Record<string, unknown>) {
    const prior = this.store.require(run.id).usage;
    this.store.update(run.id, { usage: { costUsd: (prior?.costUsd ?? 0) + costUsd, turns: (prior?.turns ?? 0) + turns, ...details } });
    this.store.event(run.id, 'usage', `About $${costUsd.toFixed(4)} over ${turns} turns`, eventDetails);
  }

  private async exec(run: Run, kind: 'setup' | 'check', command: string[], { cwd, network, timeoutMs }: ExecOptions): Promise<CommandResult> {
    const cache = join(this.root, '.factory/cache');
    const tmp = join(cache, 'tmp', run.id);
    await mkdir(tmp, { recursive: true });
    const processId = `${kind}-${run.id}`;
    run.processId = processId;
    const output = { stdout: '', stderr: '', decoders: { stdout: new TextDecoder(), stderr: new TextDecoder() } };
    run.execOutput = output;
    this.store.progress.set(run.id, processId, 'output', '', command.join(' '));
    const startedAt = Date.now();
    try {
      // Streamed output is left out of the final response, so the result is rebuilt from the deltas.
      const result = await run.client.request('command/exec', { command, cwd, sandboxPolicy: sandbox(cwd, { roots: [cache], network }), env: toolEnv(cache, tmp), timeoutMs, outputBytesCap: execOutputBytes, processId, streamStdoutStderr: true }, timeoutMs + 10_000);
      return { command, network, ...result, stdout: `${result.stdout ?? ''}${output.stdout}`, stderr: `${result.stderr ?? ''}${output.stderr}`, startedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt };
    } finally {
      run.processId = null;
      run.execOutput = undefined;
      this.store.progress.end(run.id, processId);
    }
  }

  private async verify(run: Run, task: Task, worktree: Worktree) {
    const { id } = run;
    const { check, source } = await resolveCheck(task, run.lastMessage, worktree.path);
    if (!check.length) {
      const snapshot = await this.snapshot(task, worktree, null, []);
      this.store.update(id, { ...snapshot, status: 'handoff', unchecked: true, checkResult: null, resolvedCheck: null, checkSource: null, completedAt: now(), requests: [] });
      this.store.event(id, 'unchecked', 'No check ran. Review the diff.');
      await this.recordPreview(run, worktree);
      return;
    }
    this.store.update(id, { status: 'checking', unchecked: false, checkSource: source, resolvedCheck: source === 'owner' ? null : check });
    this.store.event(id, 'checking', `Checking: ${check.join(' ')}`, { source });
    const candidate = await candidateTree(worktree.path);
    const result = await this.exec(run, 'check', check, { cwd: worktree.path, network: false, timeoutMs: checkTimeoutMs });
    ensureActive(run);
    const snapshot = await this.snapshot(task, worktree, result.exitCode, check);
    this.store.update(id, { ...snapshot, checkResult: { ...result, candidate }, checkedAt: now() });
    this.store.event(id, 'check_result', result.exitCode === 0 ? 'Check passed' : `Check failed: exit ${result.exitCode}`, { exitCode: result.exitCode, durationMs: result.durationMs, candidate, stdout: result.stdout, stderr: result.stderr });
    run.checkFailed = result.exitCode !== 0 || candidate !== snapshot.candidate;
    if (result.exitCode !== 0) throw new Error('Project check failed. Inspect its output and the preserved worktree.');
    if (candidate !== snapshot.candidate) throw new Error('Check modified the candidate. Review those changes before running another check.');
    this.store.update(id, { status: 'handoff', completedAt: now(), requests: [] });
    this.store.event(id, 'handoff', 'Ready for review');
    await this.recordPreview(run, worktree);
  }

  private async recordPreview(run: Run, worktree: Worktree) {
    const task = this.store.require(run.id);
    if (run.canceled || !task.candidate) return;
    const preview = await capturePreview({ task, cwd: worktree.path, root: this.root, candidate: task.candidate, message: run.lastMessage, capture: this.capture, servicePort: this.servicePort });
    if (!preview) return;
    this.store.event(run.id, 'preview', previewSummary(preview), { url: preview.url, errors: preview.errors, output: preview.log, images: preview.shots });
    this.store.update(run.id, { preview });
  }

  async retakePreview(id: string) {
    if (this.runs.has(id)) throw new Error('Wait for this run to finish before taking new screenshots');
    const task = this.store.require(id);
    if (!task.worktree || task.worktreeRemoved || !task.candidate) throw new Error('This task has no worktree to preview');
    const preview = await capturePreview({ task, cwd: task.worktree.path, root: this.root, candidate: task.candidate, capture: this.capture, servicePort: this.servicePort });
    if (!preview) throw new Error('No app to preview. Ask the agent for a PREVIEW line, or add a preview, dev, start, ui, or serve script.');
    this.store.event(id, 'preview', previewSummary(preview), { url: preview.url, errors: preview.errors, output: preview.log, images: preview.shots });
    return this.store.update(id, { preview });
  }

  private async snapshot(task: Task, worktree: Worktree, exitCode: number | null, command: string[]) {
    const candidate = await candidateTree(worktree.path);
    const { path, bytes, files } = await exportPatch(worktree.path, task.repo.base, join(this.root, '.factory/artifacts', task.id, `${candidate}.patch`));
    const patch = { path, bytes };
    const history = [...(this.store.require(task.id).history ?? []), { attempt: task.attempt ?? 1, candidate, exitCode, command, patch, at: now() }];
    return { candidate, files, patch, history };
  }

  private async finish(run: Run) {
    const { id } = run;
    if (run.timer) clearTimeout(run.timer);
    this.store.progress.end(id);
    await run.preview?.close();
    run.agent?.close();
    run.client.close();
    run.pending.clear();
    await Promise.all(['.factory/cache/tmp', '.factory/sandbox'].map(directory => rm(join(this.root, directory, id), { recursive: true, force: true }))).catch(() => undefined);
    // The automatic retry below starts this same task again, so the run has to be released first.
    this.runs.delete(id);
    const task = this.store.require(id);
    if (!run.canceled && task.status === 'handoff' && task.preview?.status === 'captured') {
      void this.live?.start(id).catch((error: Error) => this.store.event(id, 'error', error.message));
    }
    const { status, attempt = 1 } = task;
    if (run.autonomy === 'ask' || run.canceled || !run.checkFailed || status !== 'failed' || attempt >= maxAttempts || !isFinished(status)) return;
    try {
      this.start(id, retryNote, true);
    } catch (error) {
      this.store.event(id, 'error', `Retry not started: ${(error as Error).message}`);
    }
  }
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}
