import { deliveryCommands, parseCommand, type DeliveryCommand } from '@shared/commands';
import { isActive, isWorking, type Autonomy, type Harness } from '@shared/domain';
import type { CheckSource, Commit, PreviewShot, Snapshot, TaskEvent, TaskLike } from '@shared/types';

export { parseCommand };

export type StatusKind = 'committed' | 'attention' | 'working' | 'running' | 'queued' | 'unchecked' | 'passed' | 'failed' | 'stopped' | 'soft' | 'info' | 'done';
export type TaskState = { kind: StatusKind; label: string };
export type GroupId = 'attention' | 'working' | 'review' | 'queued' | 'done';

export const agents: Record<Harness, { name: string; signIn: string }> = {
  codex: { name: 'Codex', signIn: 'codex login' },
  claude: { name: 'Claude', signIn: 'claude auth login' },
  opencode: { name: 'OpenCode', signIn: 'bunx opencode auth login' },
};

export const autonomyModes: { value: Autonomy; name: string; description: string }[] = [
  { value: 'ask', name: 'Ask me', description: 'You answer questions and approve restricted operations.' },
  { value: 'sandboxed', name: 'Automatic, sandboxed', description: 'Answers on its own and declines anything outside the sandbox. Up to 3 attempts, 45 minutes each.' },
  { value: 'full', name: 'Automatic, full access', description: 'Approves network and file access outside the worktree. Up to 3 attempts, 45 minutes each.' },
];

export const taskGroups: [GroupId, string][] = [['attention', 'Needs you'], ['working', 'Working'], ['review', 'Ready for review'], ['queued', 'Not started'], ['done', 'Settled']];

export const agentName = (harness?: Harness | null) => agents[harness ?? 'codex'].name;
export const repoName = (path?: string | null) => (path ?? '').split('/').filter(Boolean).at(-1) ?? '';

const workingLabels = { preparing: 'Preparing', running: 'Working', checking: 'Running check', canceling: 'Stopping' };
const pullRequestState = (task: TaskLike) => task.pullRequest?.state ?? task.pullRequestState ?? null;

export function taskState(task: TaskLike): TaskState {
  if (task.revert || task.reverted) return { kind: 'stopped', label: 'Reverted' };
  if (task.merge || task.merged) return { kind: 'committed', label: 'Merged' };
  const review = pullRequestState(task);
  if (review === 'CLOSED') return { kind: 'stopped', label: 'Pull request closed' };
  if (review) return { kind: 'committed', label: review === 'MERGED' ? 'Merged' : 'Pull request open' };
  if (task.commit || task.committed) return { kind: 'committed', label: 'Committed' };
  if (task.status === 'awaiting_approval') return { kind: 'attention', label: 'Needs you' };
  if (isWorking(task.status)) return { kind: 'working', label: workingLabels[task.status] };
  if (task.status === 'queued') return { kind: 'queued', label: 'Not started' };
  if (task.status === 'handoff') return task.unchecked ? { kind: 'unchecked', label: 'Unchecked' } : { kind: 'passed', label: 'Check passed' };
  if (task.status === 'failed') return { kind: 'failed', label: task.checkResult?.exitCode ? 'Check failed' : 'Failed' };
  return { kind: 'stopped', label: task.status === 'interrupted' ? 'Interrupted' : 'Stopped' };
}

export function taskGroup(task: TaskLike): GroupId {
  if (task.status === 'awaiting_approval') return 'attention';
  if (isWorking(task.status)) return 'working';
  if (task.settled === true) return 'done';
  if (task.status === 'queued') return 'queued';
  if (task.settled === false) return 'review';
  const finished = task.commit || task.committed || task.worktreeRemoved;
  return finished ? 'done' : 'review';
}

export const groupTasks = <T extends TaskLike>(tasks: T[]) =>
  taskGroups
    .map(([id, label]) => ({ id, label, tasks: tasks.filter(task => taskGroup(task) === id) }))
    .filter(group => group.tasks.length);

export function taskActions(task: TaskLike, locked: boolean) {
  const live = isActive(task.status);
  const worktree = Boolean(task.worktree) && !task.worktreeRemoved;
  const settled = taskGroup(task) === 'done';
  const deliverable = worktree && !task.merge && !pullRequestState(task) && !live && (Boolean(task.commit) || task.status === 'handoff');
  return {
    settle: !live && !settled,
    unsettle: !live && settled,
    start: task.status === 'queued' && !locked,
    stop: task.status === 'queued' || live,
    commit: task.status === 'handoff' && worktree && !task.commit,
    merge: deliverable,
    pullRequest: deliverable && Boolean(task.repo?.remote),
    uncommit: Boolean(task.commit) && worktree && !task.merge && !pullRequestState(task),
    retry: worktree && !task.commit && ['handoff', 'failed', 'canceled', 'interrupted'].includes(task.status),
    rollback: worktree && !task.commit && !live && task.status !== 'queued' && Boolean(task.candidate),
    remove: worktree && !live && task.status !== 'queued',
  };
}

export function ago(iso: string, now = Date.now(), short = false) {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  const suffix = short ? '' : ' ago';
  if (minutes < 1) return short ? 'now' : 'just now';
  if (minutes < 60) return `${minutes}m${suffix}`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h${suffix}`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export type CheckSummary = {
  kind: StatusKind;
  title: string;
  command?: string;
  source?: string;
  meta?: string;
  note?: string;
  output?: string;
  link?: string;
  commit?: Commit | null;
  copy?: [label: string, command: string];
  commands?: DeliveryCommand[];
};

const checkSources: Partial<Record<CheckSource, string>> = { agent: 'chosen by the agent', detected: 'found in the repository' };
const pullRequestTitles = { OPEN: 'Pull request open', MERGED: 'Pull request merged', CLOSED: 'Pull request closed' };

export function checkSummary(task: TaskLike): CheckSummary | null {
  if (task.revert) return { kind: 'stopped', title: 'Merge reverted', commit: task.revert, note: 'The task branch still has the work.' };
  if (task.merge) return { kind: 'committed', title: 'Merged', commit: task.merge, commands: deliveryCommands(task) };
  if (task.pullRequest) {
    const { state, url, base } = task.pullRequest;
    return { kind: state === 'CLOSED' ? 'stopped' : 'committed', title: pullRequestTitles[state] ?? 'Pull request', commit: task.commit, link: url, note: state === 'OPEN' ? `Review and merge it on GitHub into ${base}.` : '', commands: deliveryCommands(task) };
  }
  if (task.commit) return { kind: 'committed', title: 'Committed', commit: task.commit, note: 'Choose Merge to bring it into your repository.', copy: ['Or merge by hand', `git merge ${task.commit.branch}`] };

  const command = task.check?.length ? task.check.join(' ') : task.resolvedCheck?.join(' ') ?? '';
  const source = !task.check?.length && task.resolvedCheck && task.checkSource ? checkSources[task.checkSource] ?? '' : '';
  if (task.status === 'checking') return { kind: 'working', title: 'Running check', command, source };
  if (isActive(task.status) || task.worktreeRemoved) return null;
  if (task.status === 'handoff' && task.unchecked) return { kind: 'unchecked', title: 'No check ran', note: 'The agent named no test command and the repository has none. Review the changes before committing.' };
  const result = task.checkResult;
  if (!result || !command) return null;
  const meta = `exit ${result.exitCode}${result.durationMs ? ` · ${(result.durationMs / 1000).toFixed(1)}s` : ''}`;
  if (result.exitCode === 0 && task.status === 'handoff') return { kind: 'passed', title: 'Check passed', command, source, meta };
  if (task.status !== 'failed' || !result.exitCode) return null;
  return { kind: 'failed', title: 'Check failed', command, source, meta, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(-4000) };
}

export type RollbackTarget = { key: string; target: string; title: string; kind: StatusKind; result: string; description: string; current: boolean };

function attemptResult({ exitCode }: Snapshot): [StatusKind, string] {
  if (exitCode === null || exitCode === undefined) return ['unchecked', 'No check'];
  return exitCode === 0 ? ['passed', 'Check passed'] : ['failed', 'Check failed'];
}

export function rollbackTargets(task: TaskLike): RollbackTarget[] {
  const attempts = [...(task.history ?? [])].reverse().map(entry => {
    const [kind, result] = attemptResult(entry);
    return { key: `${entry.attempt}-${entry.candidate}`, target: entry.candidate, title: `Attempt ${entry.attempt}`, kind, result, description: `the result of attempt ${entry.attempt}`, current: entry.candidate === task.candidate };
  });
  return [...attempts, { key: 'base', target: 'base', title: 'Original code', kind: 'info', result: 'Before the agent', description: 'the original code', current: false }];
}

export type ToolIcon = 'run' | 'read' | 'write' | 'search' | 'think';
type StepState = Extract<StatusKind, 'running' | 'info' | 'failed' | 'soft' | 'stopped' | 'done'>;
type EntryBase = { id: number; at: string; type: string; raw: string; toolId?: string; state: StepState; output: string; exitCode?: number; finished?: boolean };
export type ToolEntry = EntryBase & { kind: 'tool'; verb: string; icon: ToolIcon; target: string };
export type MessageEntry = EntryBase & { kind: 'message'; text: string };
export type EventImage = Pick<PreviewShot, 'name' | 'width' | 'height'>;
export type EventEntry = EntryBase & { kind: 'event'; label: string; text: string; images: EventImage[] };
export type ToolGroupStep = { kind: 'tools'; id: number; at: string; items: ToolEntry[] };
export type ActivityStep = MessageEntry | EventEntry | ToolGroupStep;
type ActivityOptions = { worktree?: string; live?: boolean; verbosity?: string };

const eventLabels: Record<string, string> = {
  queued: 'Saved', prepared: 'Worktree ready', setup: 'Setup started', setup_result: 'Setup finished', running: 'Agent started', unchecked: 'No check ran',
  request: 'Needs you', request_answered: 'Answered', request_denied: 'Blocked', checking: 'Check started', check_result: 'Check finished', handoff: 'Check passed',
  failed: 'Failed', canceled: 'Stopped', interrupted: 'Interrupted', retry: 'Another attempt', committed: 'Committed', uncommitted: 'Commit undone',
  rolled_back: 'Rolled back', worktree_removed: 'Cleaned up', autonomy: 'Permissions', settled: 'Settled', merged: 'Merged', reverted: 'Reverted',
  pull_request: 'Pull request', owner_command_started: 'Command started', owner_command: 'Command finished', usage: 'Usage', error: 'Error',
  preview: 'Screenshots', screenshot: 'Agent screenshot',
};
const toolVerbs: Record<string, [string, ToolIcon]> = {
  bash: ['Ran', 'run'], read: ['Read', 'read'], write: ['Wrote', 'write'], edit: ['Edited', 'write'], multiedit: ['Edited', 'write'], glob: ['Searched', 'search'],
  grep: ['Searched', 'search'], list: ['Listed', 'read'], webfetch: ['Fetched', 'read'], websearch: ['Searched the web', 'search'], todowrite: ['Updated the plan', 'think'],
  task: ['Delegated', 'think'], askuserquestion: ['Asked', 'think'], preview_open: ['Opened the app', 'read'], preview_screenshot: ['Took a screenshot', 'read'],
  preview_logs: ['Read the logs', 'read'], preview_interact: ['Used the page', 'run'],
};
const toolNouns: Record<ToolIcon, [string, string]> = { run: ['command', 'commands'], write: ['edit', 'edits'], read: ['read', 'reads'], search: ['search', 'searches'], think: ['step', 'steps'] };
const toolTypes = ['tool_started', 'tool_result', 'command', 'files'];
const failedTypes = ['failed', 'interrupted', 'error', 'request_denied'];
const exitCodeTypes = ['check_result', 'setup_result', 'command', 'owner_command'];
const quietInSummary = ['queued', 'prepared', 'running', 'usage', 'setup', 'setup_result', 'request'];

const unwrapShell = (text: string) => text.replace(/^\/bin\/(?:ba|z)?sh -lc (["'])([\s\S]*)\1$/, '$2');
const captured = (details: TaskEvent['details']) => [details.output, details.stdout, details.stderr].filter(Boolean).join('\n');

function stepState({ type, details }: TaskEvent, live: boolean): StepState {
  if (type === 'tool_started') return live ? 'running' : 'info';
  if (failedTypes.includes(type) || (exitCodeTypes.includes(type) && details.exitCode)) return 'failed';
  if (type === 'unchecked' || (type === 'tool_result' && details.error)) return 'soft';
  if (type === 'canceled') return 'stopped';
  return 'done';
}

function describeTool(event: TaskEvent, trim: (text: string) => string) {
  if (event.type === 'files') return { verb: 'Edited', icon: 'write' as const, target: trim((event.details.paths ?? []).join(', ') || event.text) };
  const text = trim(unwrapShell(event.text));
  const named = text.match(/^([\w-]+): ([\s\S]*)$/);
  const known = named && toolVerbs[named[1].toLowerCase()];
  if (named && (event.details.tool || known)) {
    const [verb, icon] = known || [named[1], 'run' as const];
    return { verb, icon, target: named[2] };
  }
  if (event.type === 'tool_result') return { verb: event.details.error ? 'Tool failed' : 'Tool finished', icon: 'run' as const, target: text };
  return { verb: 'Ran', icon: 'run' as const, target: text };
}

export function buildActivity(events: TaskEvent[], { worktree = '', live = false, verbosity = 'summary' }: ActivityOptions = {}): ActivityStep[] {
  const trim = (text: string) => (worktree ? text.replaceAll(`${worktree}/`, '').replaceAll(worktree, '.') : text);
  const entries: (ToolEntry | MessageEntry | EventEntry)[] = [];

  for (const event of events) {
    const { details } = event;
    const previous = entries.at(-1);
    const isResult = event.type === 'tool_result' || event.type === 'command';
    // A screenshot event can land between a tool call and its result, so results find their call by id rather than position.
    const started = !isResult ? undefined : details.toolId
      ? entries.findLast(entry => entry.type === 'tool_started' && entry.toolId === details.toolId)
      : event.type === 'command' && previous?.type === 'tool_started' && unwrapShell(event.text) === unwrapShell(previous.raw) ? previous : undefined;
    if (started && !started.finished) {
      started.finished = true;
      started.output = trim(captured(details));
      started.exitCode = details.exitCode;
      started.state = details.exitCode ? 'failed' : details.error ? 'soft' : 'done';
      continue;
    }
    const base = { id: event.id, at: event.at, type: event.type, raw: event.text, toolId: details.toolId, state: stepState(event, live), output: trim(captured(details)), exitCode: details.exitCode };
    if (event.type === 'message') entries.push({ ...base, kind: 'message', text: event.text.replace(/\n*^CHECK: .*$/gm, '').trim() });
    else if (toolTypes.includes(event.type)) entries.push({ ...base, kind: 'tool', ...describeTool(event, trim) });
    else entries.push({ ...base, kind: 'event', label: eventLabels[event.type] ?? event.type.replaceAll('_', ' '), text: trim(event.text), images: details.images ?? [] });
  }

  const steps: ActivityStep[] = [];
  for (const entry of entries) {
    const hidden = verbosity === 'summary' && entry.state === 'done' && ((entry.kind === 'event' && quietInSummary.includes(entry.type)) || entry.type === 'tool_result');
    if (hidden) continue;
    const group = steps.at(-1);
    if (entry.kind !== 'tool') steps.push(entry);
    else if (group?.kind === 'tools') group.items.push(entry);
    else steps.push({ kind: 'tools', id: entry.id, at: entry.at, items: [entry] });
  }
  return steps;
}

export function toolSummary(items: ToolEntry[]) {
  const counts = new Map<ToolIcon, number>();
  for (const item of items) counts.set(item.icon, (counts.get(item.icon) ?? 0) + 1);
  return [...counts].map(([icon, count]) => `${count} ${toolNouns[icon][count === 1 ? 0 : 1]}`).join(', ');
}
