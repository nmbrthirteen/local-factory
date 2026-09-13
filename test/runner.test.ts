import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git, inspectRepo } from '../backend/git';
import type { Run } from '../backend/runner';
import { Store } from '../backend/store';
import { fakeClaude } from './fake-claude';
import { fakeOpencode } from './fake-opencode';
import { createFixture, exitCheck, fileCheck, outputCheck } from './fixture';
import { cleanupAfterEach, until } from './support';

const onCleanup = cleanupAfterEach();
const fixture = (agents?: Parameters<typeof createFixture>[1]) => createFixture(onCleanup, agents);

test('real worktree and real check evidence survive reopening the database', async () => {
  const f = await fixture();
  await writeFile(join(f.repoPath, 'personal.txt'), 'preserve me');
  const task = f.task();
  const result = await f.run(task.id);
  expect(result.status).toBe('handoff');
  expect(result.checkResult?.exitCode).toBe(0);
  expect(await readFile(result.patch!.path, 'utf8')).toMatch(/implemented/);
  expect(result.checkResult?.candidate).toBe(result.candidate!);
  expect(result.checkResult?.durationMs).toBeGreaterThanOrEqual(0);
  expect(await readFile(join(f.repoPath, 'personal.txt'), 'utf8')).toBe('preserve me');
  expect(existsSync(join(f.root, '.factory/cache/tmp', task.id))).toBe(false);
  expect(await readFile(join(f.repoPath, 'README.md'), 'utf8')).toBe('fixture');
  const reopened = new Store(f.db);
  expect(reopened.get(task.id)?.status).toBe('handoff');
  expect(reopened.events(task.id).some(event => event.type === 'check_result')).toBe(true);
  reopened.close();
});

test('failed check cannot produce a successful handoff', async () => {
  const f = await fixture();
  const result = await f.run(f.task('Write output', exitCheck(7)).id);
  expect(result.status).toBe('failed');
  expect(result.checkResult?.exitCode).toBe(7);
});

test('cancel and duplicate start preserve a single attempt', async () => {
  const f = await fixture();
  const task = f.task('WAIT_FOREVER');
  f.runner.start(task.id);
  expect(() => f.runner.start(task.id)).toThrow(/active/);
  await until(() => f.store.require(task.id).turnId);
  const done = f.runner.active?.done;
  f.runner.cancel(task.id);
  await done;
  expect(f.store.require(task.id).status).toBe('canceled');
  expect(f.runner.active).toBeNull();
});

test('approval remains bound to its request and rejects replay', async () => {
  const f = await fixture();
  const task = f.task('REQUEST_APPROVAL');
  f.runner.start(task.id);
  await until(() => f.store.require(task.id).status === 'awaiting_approval');
  expect(() => f.runner.answer('wrong-task', '001', { decision: 'accept' })).toThrow(/no longer active/);
  expect(f.store.require(task.id).requests?.[0].id).toBe('001');
  f.runner.answer(task.id, '001', { decision: 'decline' });
  expect(() => f.runner.answer(task.id, '001', { decision: 'accept' })).toThrow(/no longer active/);
  await f.runner.active?.done;
  expect(f.store.require(task.id).status).toBe('handoff');
});

test('diff larger than the process output buffer is exported as a patch', async () => {
  const f = await fixture();
  const result = await f.run(f.task('LARGE_DIFF').id);
  expect(result.status).toBe('handoff');
  expect(result.patch!.bytes).toBeGreaterThan(3 * 1024 * 1024);
});

test('setup runs before the agent with caches in a writable root', async () => {
  const f = await fixture();
  const task = f.task(undefined, undefined, [process.execPath, '-e', 'process.stdout.write(process.env.npm_config_cache)']);
  const result = await f.run(task.id);
  expect(result.status).toBe('handoff');
  expect(result.setupResult?.stdout).toBe(join(f.root, '.factory/cache/npm'));
  expect(result.setupResult?.network).toBe(true);
  expect(result.checkResult?.network).toBe(false);
  const types = f.store.events(task.id).map(event => event.type);
  expect(types.indexOf('setup_result')).toBeLessThan(types.indexOf('running'));
});

test('failed or file-changing setup stops before the agent starts', async () => {
  const f = await fixture();
  const cases: [string[], RegExp][] = [
    [exitCheck(3), /Setup failed/],
    [[process.execPath, '-e', "require('node:fs').writeFileSync('README.md','changed')"], /Setup changed repository files/],
  ];
  for (const [setup, error] of cases) {
    const result = await f.run(f.task(undefined, undefined, setup).id);
    expect(result.status).toBe('failed');
    expect(result.error ?? '').toMatch(error);
    expect(result.threadId).toBeUndefined();
  }
});

test('repository inspection suggests a recipe from its lockfile', async () => {
  const f = await fixture();
  expect((await inspectRepo(f.repoPath)).recipe).toBeNull();
  await writeFile(join(f.repoPath, 'package-lock.json'), '{}');
  expect((await inspectRepo(f.repoPath)).recipe).toEqual({ lockfile: 'package-lock.json', setup: ['npm', 'ci'], check: ['npm', 'test'] });
});

test('claude run uses isolated options and ends in a checked handoff', async () => {
  process.env.FACTORY_TEST_SECRET = 'do-not-forward';
  onCleanup(() => delete process.env.FACTORY_TEST_SECRET);
  const claude = fakeClaude();
  const f = await fixture({ claude: claude.query });
  const task = f.claudeTask();
  const result = await f.run(task.id);
  expect(result.status).toBe('handoff');
  expect(result.checkResult?.exitCode).toBe(0);
  expect(result.usage?.costUsd).toBe(0.0123);
  expect(result.agentPolicy).toMatchObject({ permissionMode: 'acceptEdits' });
  expect(claude.calls.options).toMatchObject({ settingSources: [], strictMcpConfig: true, sandbox: { allowUnsandboxedCommands: false, network: { allowedDomains: [] } } });
  expect(claude.calls.options.env.FACTORY_TEST_SECRET).toBeUndefined();
  expect(claude.calls.prompt).toMatch(/What done looks like/);
  expect(claude.calls.options.systemPrompt.append).toMatch(/^Implement the task\.\n\n## Owner instructions from ~\/\.claude\/CLAUDE\.md\n\nOwner fixture rules[\s\S]*## Repository instructions from AGENTS\.md\n\nRepository fixture rules[\s\S]*Do not push/);
  expect(result.instructionFiles?.map(file => [file.scope, file.label, file.native])).toEqual([['global', '~/.claude/CLAUDE.md', false], ['repository', 'AGENTS.md', false]]);
  expect(f.store.events(task.id).some(event => event.text === 'Implemented with Claude')).toBe(true);
  expect(claude.calls.closed).toBeGreaterThan(0);
});

test('codex gets the preview tools, and the factory answers their calls', async () => {
  const f = await fixture();
  const task = f.task('PREVIEW_TOOL');
  const result = await f.run(task.id);
  expect(result.status).toBe('handoff');
  const tools = JSON.parse(await readFile(`${result.worktree!.path}.tools`, 'utf8'));
  expect(tools.map((tool: { name: string }) => tool.name)).toEqual(['preview_open', 'preview_screenshot', 'preview_logs', 'preview_interact']);
  expect(JSON.parse(await readFile(`${result.worktree!.path}.tool`, 'utf8'))).toEqual({ success: false, contentItems: [{ type: 'inputText', text: 'The app is not running. Call preview_open first.' }] });
  expect(f.store.events(task.id).some(event => event.type === 'tool_result' && event.text === 'Tool returned an error')).toBe(true);
});

test('claude gets the factory preview server, and its tools run without asking the owner', async () => {
  const claude = fakeClaude({ factoryTool: true });
  const f = await fixture({ claude: claude.query });
  const task = f.claudeTask();
  const result = await f.run(task.id);
  expect(result.status).toBe('handoff');
  expect(claude.calls.options.mcpServers.factory).toMatchObject({ name: 'factory' });
  expect(claude.calls.factoryDecision).toMatchObject({ behavior: 'allow' });
  expect(f.store.events(task.id).some(event => event.type === 'request')).toBe(false);
});

test('claude approvals and questions go to the owner and reject replay', async () => {
  const claude = fakeClaude({ approval: true, question: true });
  const f = await fixture({ claude: claude.query });
  const task = f.claudeTask();
  f.runner.start(task.id);
  await until(() => f.store.require(task.id).requests?.[0]?.key === 'tool-1');
  expect(f.store.require(task.id).requests?.[0].params.command).toBe('curl https://example.invalid');
  f.runner.answer(task.id, 'tool-1', { decision: 'decline' });
  expect(() => f.runner.answer(task.id, 'tool-1', { decision: 'accept' })).toThrow(/no longer active/);
  await until(() => f.store.require(task.id).requests?.[0]?.kind === 'question');
  expect(() => f.runner.answer(task.id, 'tool-2', { answers: {} })).toThrow(/Answer each question/);
  f.runner.answer(task.id, 'tool-2', { answers: { 0: 'implemented' } });
  await f.runner.active?.done;
  expect(claude.calls.decision.behavior).toBe('deny');
  expect(claude.calls.answer.updatedInput.answers).toEqual({ 'Which output?': 'implemented' });
  expect(f.store.require(task.id).status).toBe('handoff');
});

test('claude run fails closed on a policy mismatch or unavailable model', async () => {
  const plugin = fakeClaude({ plugins: [{ name: 'personal-plugin', path: '/tmp/plugin' }] });
  const f = await fixture({ claude: plugin.query });
  const mismatched = await f.run(f.claudeTask().id);
  expect(mismatched.status).toBe('failed');
  expect(mismatched.error ?? '').toMatch(/did not apply the requested run policy/);
  const missing = await f.run(f.claudeTask('opus').id);
  expect(missing.error ?? '').toMatch(/Selected model is unavailable/);
});

test('cancel stops a claude session', async () => {
  const claude = fakeClaude({ wait: true });
  const f = await fixture({ claude: claude.query });
  const task = f.claudeTask();
  f.runner.start(task.id);
  await until(() => f.store.require(task.id).agentPolicy);
  const done = f.runner.active?.done;
  f.runner.cancel(task.id);
  await done;
  expect(f.store.require(task.id).status).toBe('canceled');
  expect(claude.calls.interrupted).toBeGreaterThan(0);
  expect(claude.calls.closed).toBeGreaterThan(0);
});

test('another attempt reuses the worktree with the last check output and owner feedback', async () => {
  const f = await fixture();
  const check = [process.execPath, '-e', "process.stdout.write('needs fixed.txt'); process.exit(require('node:fs').existsSync('fixed.txt') ? 0 : 3)"];
  const task = f.task('RECORD_PROMPT', check, [process.execPath, '-e', '0']);
  const first = await f.run(task.id);
  expect(first.status).toBe('failed');
  const second = await f.run(task.id, 'Create fixed.txt please');
  expect(second.status).toBe('handoff');
  expect(second.attempt).toBe(2);
  expect(second.worktree?.path).toBe(first.worktree!.path);
  const types = f.store.events(task.id).map(event => event.type);
  expect(types.filter(type => type === 'setup_result')).toHaveLength(1);
  expect(types).toContain('retry');
  const prompts = await readFile(`${first.worktree!.path}.prompts`, 'utf8');
  expect(prompts).toMatch(/This is attempt 2/);
  expect(prompts).toMatch(/exited with 3\. Its output ended with:\nneeds fixed\.txt/);
  expect(prompts).toMatch(/Owner feedback:\nCreate fixed\.txt please/);
});

test('the run limit counts working time and pauses while a request waits for the owner', async () => {
  const f = await fixture();
  const canceled: string[] = [];
  f.runner.cancel = (_id, reason = '') => void canceled.push(reason);
  const run = { id: 'clock', pending: new Map(), limitMs: 80, remainingMs: 80, deadline: 0, timer: null, canceled: false } as unknown as Run;
  f.runner.syncClock(run);
  await Bun.sleep(30);
  run.pending.set('request', {} as never);
  f.runner.syncClock(run);
  await Bun.sleep(150);
  expect(canceled).toEqual([]);
  run.pending.clear();
  f.runner.syncClock(run);
  await Bun.sleep(150);
  expect(canceled).toHaveLength(1);
  expect(canceled[0]).toMatch(/limit of working time/);
});

test('opencode run ends in a checked handoff with usage', async () => {
  const opencode = fakeOpencode();
  const f = await fixture({ opencode: opencode.open });
  const task = f.opencodeTask();
  const result = await f.run(task.id);
  expect(result.status).toBe('handoff');
  expect(result.checkResult?.exitCode).toBe(0);
  expect(result.usage?.costUsd).toBe(0.01);
  expect(opencode.calls.options.cwd).toBe(result.worktree!.path);
  expect(opencode.calls.prompt).toMatch(/What done looks like/);
  expect(f.store.events(task.id).some(event => event.text === 'Implemented with OpenCode')).toBe(true);
  expect(opencode.calls.closed).toBeGreaterThan(0);
});

test('opencode permissions and questions go to the owner', async () => {
  const opencode = fakeOpencode({ permission: true, question: true });
  const f = await fixture({ opencode: opencode.open });
  const task = f.opencodeTask();
  f.runner.start(task.id);
  await until(() => f.store.require(task.id).requests?.[0]?.key === 'per_1');
  expect(f.store.require(task.id).requests?.[0].params.command).toBe('/etc/hosts');
  f.runner.answer(task.id, 'per_1', { decision: 'decline' });
  expect(() => f.runner.answer(task.id, 'per_1', { decision: 'accept' })).toThrow(/no longer active/);
  await until(() => f.store.require(task.id).requests?.[0]?.key === 'que_1');
  f.runner.answer(task.id, 'que_1', { answers: { 0: 'implemented' } });
  await f.runner.active?.done;
  expect(opencode.calls.permissionReply).toBe('reject');
  expect(opencode.calls.questionReply).toEqual([['implemented']]);
  expect(f.store.require(task.id).status).toBe('handoff');
});

test('opencode fails on an unavailable model and stops on cancel', async () => {
  const missing = fakeOpencode();
  const f = await fixture({ opencode: missing.open });
  const unavailable = await f.run(f.opencodeTask('openai/not-a-model').id);
  expect(unavailable.error ?? '').toMatch(/Selected model is unavailable/);
  expect(missing.calls.closed).toBeGreaterThan(0);
  const waiting = fakeOpencode({ wait: true });
  f.runner.opencode = waiting.open as unknown as typeof f.runner.opencode;
  const task = f.opencodeTask();
  f.runner.start(task.id);
  await until(() => f.store.require(task.id).status === 'running');
  const done = f.runner.active?.done;
  f.runner.cancel(task.id);
  await done;
  expect(f.store.require(task.id).status).toBe('canceled');
  expect(waiting.calls.interrupted).toBeGreaterThan(0);
  expect(waiting.calls.closed).toBeGreaterThan(0);
});

test('without a check command the factory runs the check the agent names', async () => {
  const f = await fixture();
  const result = await f.run(f.task('NAME_CHECK RECORD_PROMPT', []).id);
  expect(result.status).toBe('handoff');
  expect(result.checkSource).toBe('agent');
  expect(result.resolvedCheck?.slice(0, 2)).toEqual(['node', '-e']);
  expect(result.checkResult?.exitCode).toBe(0);
  expect(await readFile(`${result.worktree!.path}.prompts`, 'utf8')).toMatch(/end your final message with one line naming the single offline command/);
});

test('without a named check the factory uses tests it finds, or marks the task unchecked', async () => {
  const f = await fixture();
  await f.identity();
  const unchecked = await f.run(f.task('TRIVIAL_CHECK', []).id);
  expect(unchecked.status).toBe('handoff');
  expect(unchecked.unchecked).toBe(true);
  expect(unchecked.checkResult).toBeNull();
  expect(f.store.events(unchecked.id).some(event => event.type === 'unchecked')).toBe(true);
  expect((await f.delivery.commit(unchecked.id)).commit?.sha).toBeTruthy();
  await mkdir(join(f.repoPath, 'test'));
  await writeFile(join(f.repoPath, 'test/sample.test.js'), "require('node:test')('works', () => {});\n");
  await git(f.repoPath, ['add', '.']);
  await git(f.repoPath, ['commit', '-m', 'Add a test']);
  const detected = f.store.create({ title: 'Detected', criteria: 'Write output', setup: [], check: [], repo: await inspectRepo(f.repoPath), model: 'test-model' });
  const result = await f.run(detected.id);
  expect(result.checkSource).toBe('detected');
  expect(result.resolvedCheck).toEqual(['node', '--test']);
  expect(result.checkResult?.exitCode).toBe(0);
  expect(result.unchecked).toBe(false);
});

test('independent tasks decide permission requests without the owner', async () => {
  const f = await fixture();
  for (const [autonomy, decision] of [['sandboxed', 'Declined'], ['full', 'Allowed']] as const) {
    const task = f.create({ title: 'Independent', criteria: 'REQUEST_APPROVAL', autonomy });
    f.runner.start(task.id);
    const result = await f.settled(task.id);
    expect(result.status).toBe('handoff');
    const events = f.store.events(task.id);
    expect(events.some(event => event.type === 'request_answered' && event.text.startsWith(decision))).toBe(true);
    expect(events.some(event => event.type === 'request')).toBe(false);
  }
});

test('permissions change on a waiting task, and switching to automatic answers what is pending', async () => {
  const f = await fixture();
  const task = f.create({ title: 'Ask first', criteria: 'REQUEST_APPROVAL', autonomy: 'ask' });
  f.runner.start(task.id);
  await until(() => f.store.require(task.id).status === 'awaiting_approval');
  expect(() => f.runner.setAutonomy(task.id, 'reckless')).toThrow(/Choose how independently/);
  f.runner.setAutonomy(task.id, 'full');
  const result = await f.settled(task.id);
  expect(result.status).toBe('handoff');
  expect(result.autonomy).toBe('full');
  const events = f.store.events(task.id);
  expect(events.some(event => event.type === 'autonomy' && event.text === 'Permissions: automatic, full access')).toBe(true);
  expect(events.some(event => event.type === 'request_answered' && event.text.startsWith('Allowed'))).toBe(true);
});

test('independent tasks retry a failed check on their own, up to three attempts', async () => {
  const f = await fixture();
  const fixable = f.create({ title: 'Fixable', check: fileCheck('fixed.txt'), autonomy: 'sandboxed' });
  f.runner.start(fixable.id);
  const fixed = await f.settled(fixable.id);
  expect(fixed.status).toBe('handoff');
  expect(fixed.attempt).toBe(2);
  expect(fixed.feedbackSource).toBe('factory');
  const stuck = f.create({ title: 'Stuck', check: exitCheck(4), autonomy: 'sandboxed' });
  f.runner.start(stuck.id);
  const gaveUp = await f.settled(stuck.id);
  expect(gaveUp.status).toBe('failed');
  expect(gaveUp.attempt).toBe(3);
  const asking = f.task('Write output', exitCheck(4));
  f.runner.start(asking.id);
  expect((await f.settled(asking.id)).attempt).toBeUndefined();
});

test('agent checks are cached per agent, and signed-out results are not', async () => {
  const f = await fixture();
  let calls = 0;
  f.runner.opencodeProbe = async () => ({ harness: 'opencode', version: '1.18.30', authenticated: ++calls > 1, models: [] });
  expect((await f.runner.probe('opencode')).authenticated).toBe(false);
  expect((await f.runner.probe('opencode')).authenticated).toBe(true);
  expect((await f.runner.probe('opencode')).authenticated).toBe(true);
  expect(calls).toBe(2);
});

test('check that changes the candidate invalidates the result', async () => {
  const f = await fixture();
  const result = await f.run(f.task('Write output', [process.execPath, '-e', "require('node:fs').writeFileSync('output.txt','changed')"]).id);
  expect(result.status).toBe('failed');
  expect(result.error ?? '').toMatch(/modified the candidate/);
});
