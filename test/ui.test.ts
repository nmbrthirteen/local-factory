import { expect, test } from 'bun:test';
import { commandLine } from '../shared/commands';
import type { TaskEvent, TaskLike } from '../shared/types';
import { parsePatch } from '../web/src/lib/patch';
import { ago, buildActivity, checkSummary, groupTasks, parseCommand, rollbackTargets, taskActions, taskState, toolSummary, type EventEntry, type MessageEntry, type ToolGroupStep } from '../web/src/lib/tasks';

const at = '2026-09-13T10:00:00.000Z';
const worktree = { path: '/w', branch: 'factory/x' };
const task = (overrides: Partial<TaskLike> & Pick<TaskLike, 'status'>): TaskLike => ({ id: 't1', title: 'Fix it', criteria: 'Make it work', harness: 'codex', model: 'gpt', setup: [], check: [], createdAt: at, ...overrides });
const event = (id: number, type: string, text: string, details: TaskEvent['details'] = {}): TaskEvent => ({ id, type, text, details, at });

test('tasks group by what they need from the owner', () => {
  const tasks = [
    task({ id: 'a', status: 'awaiting_approval' }),
    task({ id: 'b', status: 'running' }),
    task({ id: 'c', status: 'failed' }),
    task({ id: 'd', status: 'handoff', committed: true }),
    task({ id: 'e', status: 'queued' }),
    task({ id: 'f', status: 'handoff', worktreeRemoved: true }),
    task({ id: 'g', status: 'handoff' }),
    task({ id: 'h', status: 'handoff', unchecked: true }),
    task({ id: 'i', status: 'failed', settled: true }),
    task({ id: 'j', status: 'handoff', settled: false }),
    task({ id: 'k', status: 'running', settled: true }),
  ];
  expect(groupTasks(tasks).map(group => [group.id, group.tasks.map(item => item.id)])).toEqual([['attention', ['a']], ['working', ['b', 'k']], ['review', ['c', 'g', 'h', 'j']], ['queued', ['e']], ['done', ['d', 'f', 'i']]]);
  expect(taskState(task({ status: 'handoff', unchecked: true }))).toEqual({ kind: 'unchecked', label: 'Unchecked' });
  expect(taskState(task({ status: 'failed', checkResult: { command: [], exitCode: 1 } })).label).toBe('Check failed');
  expect(taskState(task({ status: 'handoff', merged: true, reverted: true })).label).toBe('Reverted');
});

test('activity folds tool results into their call, names tools, trims worktree paths, and hides setup noise in summary', () => {
  const events = [
    event(1, 'prepared', 'Worktree created: /w'),
    event(2, 'message', 'Reading the spec\n\nCHECK: npm test'),
    event(3, 'tool_started', 'Read: /w/PRODUCT.md', { tool: 'Read', toolId: 'a' }),
    event(4, 'tool_result', 'Tool completed', { toolId: 'a', output: '# Spec' }),
    event(5, 'tool_started', '/bin/zsh -lc "npm test"', { toolId: 'b' }),
    event(6, 'command', '/bin/zsh -lc "npm test"', { toolId: 'b', exitCode: 1, output: 'boom' }),
    event(7, 'tool_result', 'Tool returned an error', { error: true, output: 'no matches found' }),
    event(8, 'check_result', 'Check exited with 1', { exitCode: 1, stdout: 'not ok' }),
    event(9, 'tool_result', 'Tool completed', { output: 'Wrote /w/notes.md' }),
  ];
  const summary = buildActivity(events, { worktree: '/w', verbosity: 'summary' });
  expect(summary.map(step => step.kind)).toEqual(['message', 'tools', 'event']);
  expect((summary[0] as MessageEntry).text).toBe('Reading the spec');
  const tools = summary[1] as ToolGroupStep;
  const [read, run, orphan] = tools.items;
  expect([read.verb, read.icon, read.target, read.output, read.state]).toEqual(['Read', 'read', 'PRODUCT.md', '# Spec', 'done']);
  expect([run.verb, run.target, run.state, run.exitCode, run.output]).toEqual(['Ran', 'npm test', 'failed', 1, 'boom']);
  expect(orphan.state).toBe('soft');
  expect(toolSummary(tools.items)).toBe('1 read, 2 commands');
  const check = summary[2] as EventEntry;
  expect([check.label, check.state, check.output]).toEqual(['Check finished', 'failed', 'not ok']);

  const everything = buildActivity(events, { worktree: '/w', verbosity: 'all' });
  expect((everything[0] as EventEntry).label).toBe('Worktree ready');
  const lastTool = (everything.at(-1) as ToolGroupStep).items[0];
  expect([lastTool.verb, lastTool.output]).toEqual(['Tool finished', 'Wrote notes.md']);

  const unfinished = buildActivity([event(1, 'tool_started', 'Write: out.txt'), event(2, 'canceled', 'Run exceeded its 15-minute limit')], { live: true });
  expect([(unfinished[0] as ToolGroupStep).items[0].verb, (unfinished[0] as ToolGroupStep).items[0].state, (unfinished[1] as EventEntry).state]).toEqual(['Wrote', 'running', 'stopped']);
});

test('screenshots show in activity, and a tool result still finds its call across them', () => {
  const shot = { name: 'desktop' as const, width: 1280, height: 800, path: '/a/1.png' };
  const steps = buildActivity([
    event(1, 'tool_started', 'preview_open: /settings', { tool: 'mcp__factory__preview_open', toolId: 'call-1' }),
    event(2, 'screenshot', 'Desktop screenshot', { images: [shot] }),
    event(3, 'tool_result', 'Tool completed', { toolId: 'call-1', output: 'Opened /settings' }),
    event(4, 'preview', '1 screenshots', { images: [shot] }),
  ], { verbosity: 'summary' });
  expect(steps.map(step => step.kind)).toEqual(['tools', 'event', 'event']);
  const opened = (steps[0] as ToolGroupStep).items[0];
  expect([opened.verb, opened.target, opened.output, opened.state]).toEqual(['Opened the app', '/settings', 'Opened /settings', 'done']);
  expect((steps[1] as EventEntry).label).toBe('Agent screenshot');
  expect((steps[2] as EventEntry).images).toEqual([shot]);
});

test('check summaries explain the outcome and offer runnable delivery commands', () => {
  expect(checkSummary(task({ status: 'handoff', resolvedCheck: ['npm', 'test'], checkSource: 'agent', checkResult: { command: [], exitCode: 0, durationMs: 1200 } }))).toEqual({ kind: 'passed', title: 'Check passed', command: 'npm test', source: 'chosen by the agent', meta: 'exit 0 · 1.2s' });
  const failed = checkSummary(task({ status: 'failed', check: ['npm', 'test'], checkResult: { command: [], exitCode: 1, stdout: 'not ok 1', stderr: '' } }));
  expect([failed?.kind, failed?.output]).toEqual(['failed', 'not ok 1']);
  expect(checkSummary(task({ status: 'handoff', unchecked: true }))?.title).toBe('No check ran');
  expect(checkSummary(task({ status: 'running', check: ['npm', 'test'], checkResult: { command: [], exitCode: 1 } }))).toBeNull();
  expect(checkSummary(task({ status: 'handoff', commit: { sha: 'abcdef1234567890', branch: 'factory/x' } }))?.copy).toEqual(['Or merge by hand', 'git merge factory/x']);

  const merged = checkSummary(task({ status: 'handoff', commit: { sha: 'abc', branch: 'factory/x' }, merge: { sha: 'fedcba9876543210', branch: 'main' } }));
  expect(merged?.title).toBe('Merged');
  expect(merged?.commands?.map(command => [command.id, command.label, commandLine(command.argv)])).toEqual([['revert', 'To undo', 'git revert -m 1 --no-edit fedcba9876543210']]);
  expect(taskState(task({ status: 'handoff', merged: true })).label).toBe('Merged');
  const reverted = checkSummary(task({ status: 'handoff', merge: { sha: 'fedcba9876543210', branch: 'main' }, revert: { sha: '1234', branch: 'main' } }));
  expect([reverted?.title, reverted?.commands]).toEqual(['Merge reverted', undefined]);

  const pullRequest = { url: 'https://github.com/o/r/pull/1', state: 'OPEN' as const, base: 'main', branch: 'factory/x' };
  const inReview = task({ status: 'handoff', worktree, candidate: 'tree', repo: { path: '/r', base: 'abc', remote: true }, commit: { sha: 'abc', branch: 'factory/x' }, pullRequest });
  const review = checkSummary(inReview);
  expect([review?.title, review?.link]).toEqual(['Pull request open', 'https://github.com/o/r/pull/1']);
  expect(review?.commands?.map(command => commandLine(command.argv))).toEqual(['gh pr merge https://github.com/o/r/pull/1 --merge', 'gh pr close https://github.com/o/r/pull/1']);
  expect(taskState(task({ status: 'handoff', pullRequestState: 'OPEN' })).label).toBe('Pull request open');
});

test('actions follow the task state', () => {
  expect(taskActions(task({ status: 'handoff', worktree, candidate: 'tree' }), false)).toEqual({ settle: true, unsettle: false, start: false, stop: false, commit: true, merge: true, pullRequest: false, uncommit: false, retry: true, rollback: true, remove: true });
  expect(taskActions(task({ status: 'handoff', worktree, candidate: 'tree', commit: { sha: 'abc', branch: 'factory/x' } }), false)).toEqual({ settle: false, unsettle: true, start: false, stop: false, commit: false, merge: true, pullRequest: false, uncommit: true, retry: false, rollback: false, remove: true });
  expect(taskActions(task({ status: 'failed', worktree, candidate: 'tree' }), false)).toEqual({ settle: true, unsettle: false, start: false, stop: false, commit: false, merge: false, pullRequest: false, uncommit: false, retry: true, rollback: true, remove: true });
  expect(taskActions(task({ status: 'queued' }), true).start).toBe(false);
  const running = taskActions(task({ status: 'running' }), false);
  expect([running.settle, running.unsettle]).toEqual([false, false]);
  const reviewable = task({ status: 'handoff', worktree, candidate: 'tree', repo: { path: '/r', base: 'abc', remote: true } });
  expect([taskActions(reviewable, false).pullRequest, taskActions(reviewable, false).merge]).toEqual([true, true]);
  const opened = { ...reviewable, commit: { sha: 'abc', branch: 'factory/x' }, pullRequest: { url: 'https://github.com/o/r/pull/1', state: 'OPEN' as const, base: 'main', branch: 'factory/x' } };
  expect([taskActions(opened, false).pullRequest, taskActions(opened, false).merge, taskActions(opened, false).uncommit]).toEqual([false, false, false]);
});

test('rollback targets list attempts newest first, then the original code', () => {
  const patch = { path: '/p', bytes: 1 };
  const history = [{ attempt: 1, candidate: 'one', exitCode: 3, command: [], patch, at }, { attempt: 2, candidate: 'two', exitCode: 0, command: [], patch, at }];
  expect(rollbackTargets(task({ status: 'handoff', history, candidate: 'two' })).map(target => [target.target, target.kind, target.result, target.current])).toEqual([
    ['two', 'passed', 'Check passed', true],
    ['one', 'failed', 'Check failed', false],
    ['base', 'info', 'Before the agent', false],
  ]);
});

test('patches parse per file with counts and line numbers', () => {
  const patch = [
    'diff --git a/src/cli.js b/src/cli.js', 'new file mode 100644', 'index 0000000..3b18e51', '--- /dev/null', '+++ b/src/cli.js',
    '@@ -0,0 +1,2 @@', '+const tag = "<b>";', '+export default tag;',
    'diff --git a/package.json b/package.json', 'index 1111111..2222222 100644', '--- a/package.json', '+++ b/package.json',
    '@@ -1,3 +1,3 @@ {', ' {', '-  "version": "0.0.0"', '+  "version": "0.1.0"', ' }', '',
  ].join('\n');
  const [added, changed] = parsePatch(patch);
  expect([added.path, added.state, added.additions, added.deletions]).toEqual(['src/cli.js', 'added', 2, 0]);
  expect([changed.path, changed.state, changed.additions, changed.deletions]).toEqual(['package.json', 'modified', 1, 1]);
  expect(changed.lines.map(line => [line.kind, line.oldLine, line.newLine])).toEqual([['hunk', undefined, undefined], ['context', 1, 1], ['del', 2, undefined], ['add', undefined, 2], ['context', 3, 3]]);
  expect(parsePatch('')).toEqual([]);
});

test('commands parse like a shell and times read naturally', () => {
  expect(parseCommand('node -e "console.log(1)" \'a b\'')).toEqual(['node', '-e', 'console.log(1)', 'a b']);
  expect(commandLine(['git', 'commit', '-m', "it's done"])).toBe("git commit -m 'it'\\''s done'");
  const start = Date.parse(at);
  expect(ago(at, start + 20_000)).toBe('just now');
  expect(ago(at, start + 20_000, true)).toBe('now');
  expect(ago(at, start + 3 * 3_600_000)).toBe('3h ago');
});
