import type { Autonomy, Harness, TaskStatus } from './domain';

export type Recipe = { lockfile: string; setup: string[]; check: string[] };
import type { OwnerCommand } from './commands';

export type Repository = { path: string; base: string; dirty?: boolean; remote?: boolean; recipe?: Recipe | null };
export type Worktree = { path: string; branch: string };
export type Commit = { sha: string; branch: string; at?: string };
export type PatchFile = { path: string; bytes: number };
export type PullRequestState = 'OPEN' | 'MERGED' | 'CLOSED';
export type PullRequest = { url: string; base: string; branch: string; state: PullRequestState; at?: string };
export type CheckSource = 'owner' | 'agent' | 'detected';

export type CommandResult = {
  command: string[];
  exitCode: number | null;
  network?: boolean;
  stdout?: string;
  stderr?: string;
  startedAt?: string;
  durationMs?: number;
  candidate?: string;
};

export type Snapshot = { attempt: number; candidate: string; exitCode: number | null; command: string[]; patch: PatchFile; at: string };

export type QuestionOption = { label: string; description?: string };
export type Question = { id: string; question: string; options?: QuestionOption[] };

export type AgentRequest = {
  key: string;
  kind: 'question' | 'approval';
  id?: string | number;
  method?: string;
  params: { questions?: Question[]; tool?: string; reason?: string; command?: string; blockedPath?: string; threadId?: string };
};

export type InstructionFile = { scope: 'global' | 'repository'; path: string; label: string; native: boolean; bytes: number };

export type PreviewShot = { name: 'desktop' | 'mobile'; width: number; height: number; path: string; bytes: number };

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
export type Attachment = { id: string; name: string; kind: 'image' | 'text'; mediaType: string; bytes: number };
export type PromptImage = Attachment & { kind: 'image'; mediaType: ImageMediaType; base64: string };
export type PromptText = Attachment & { kind: 'text'; text: string };
export type PromptAttachment = PromptImage | PromptText;

export type LiveApp = { url: string; command: string[]; startedAt: string };

export type Preview = {
  status: 'captured' | 'failed';
  candidate: string;
  command: string[];
  source: 'agent' | 'detected';
  url?: string;
  shots: PreviewShot[];
  errors: string[];
  note?: string;
  log?: string;
  at: string;
  durationMs: number;
};

export type Usage ={ costUsd: number; turns: number; durationMs?: number; modelUsage?: unknown; permissionDenials?: unknown };

export type Task = {
  id: string;
  title: string;
  criteria: string;
  status: TaskStatus;
  harness?: Harness;
  model: string;
  autonomy?: Autonomy;
  repo: Repository;
  setup: string[];
  check: string[];
  attachments?: Attachment[];
  createdAt: string;
  updatedAt?: string;
  startedAt?: string;
  checkedAt?: string;
  completedAt?: string;
  attempt?: number;
  feedback?: string;
  feedbackSource?: 'owner' | 'factory';
  worktree?: Worktree;
  worktreeRemoved?: boolean;
  setupResult?: CommandResult;
  checkResult?: CommandResult | null;
  checkSource?: CheckSource | null;
  resolvedCheck?: string[] | null;
  unchecked?: boolean;
  candidate?: string | null;
  files?: string;
  patch?: PatchFile | null;
  preview?: Preview | null;
  liveApp?: LiveApp | null;
  history?: Snapshot[];
  commit?: Commit | null;
  merge?: Commit;
  revert?: Commit;
  pullRequest?: PullRequest;
  settled?: boolean | null;
  settledAt?: string | null;
  requests?: AgentRequest[];
  error?: string | null;
  usage?: Usage;
  harnessPid?: number;
  agentPid?: number;
  threadId?: string;
  turnId?: string;
  instructions?: string;
  instructionDigest?: string;
  instructionSources?: unknown[];
  instructionFiles?: InstructionFile[];
  ownerCommand?: OwnerCommand;
  sandbox?: unknown;
  agentPolicy?: unknown;
};

export type NewTask = Pick<Task, 'title' | 'criteria' | 'model' | 'repo' | 'setup' | 'check'> & Partial<Pick<Task, 'harness' | 'autonomy' | 'worktree' | 'patch' | 'attachments'>>;

export type TaskSummary = Pick<Task, 'id' | 'title' | 'status' | 'createdAt' | 'model' | 'harness' | 'settled'> & {
  repository: string;
  committed: boolean;
  merged: boolean;
  reverted: boolean;
  pullRequestState: PullRequestState | null;
  unchecked: boolean;
  worktreeRemoved: boolean;
};

export type TaskLike = Pick<Task, 'id' | 'title' | 'status'> & Partial<Omit<Task, 'id' | 'title' | 'status'>> & Partial<Omit<TaskSummary, 'id' | 'title' | 'status'>>;

export type TaskEvent = { id: number; type: string; text: string; details: Record<string, any>; at: string };

export type TaskPage = { tasks: TaskSummary[]; page: { counts: Record<string, number>; total: number; next: number | null } };

export type AgentModel = { id: string; name: string; isDefault?: boolean; detail?: string };
export type Preferences = { implementer: Harness; models: Record<string, string> };
export type AgentProbe = { harness: Harness; version: string; authenticated: boolean; account?: string; models: AgentModel[]; recovery?: string[] };

export type ProgressKind = 'output' | 'message';
export type ProgressUpdate = { taskId: string; key: string; kind: ProgressKind; label: string; text: string };
export type ProgressEvent = ProgressUpdate | { taskId: string; cleared: true };

export type FactoryState = TaskPage & {
  repository: Repository | null;
  repositories: Repository[];
  preferences: Preferences;
  needsYou: number;
  recovery: string[];
  active: string[];
};
