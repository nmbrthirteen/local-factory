import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '../backend/git';
import { deliveryCommands } from '../shared/commands';
import { createFixture, exitCheck, fileCheck } from './fixture';
import { cleanupAfterEach } from './support';

const onCleanup = cleanupAfterEach();
const fixture = () => createFixture(onCleanup);

const fakeGitHubCli = (root: string) => `#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const state = ${JSON.stringify(join(root, 'gh-state'))};
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(root, 'gh-calls'))}, args.join(' ') + '\\n');
const [command, action] = args;
if (command === 'pr' && action === 'create') { writeFileSync(state, 'OPEN'); console.log('https://github.com/example/ledger/pull/7'); }
if (command === 'pr' && action === 'view') console.log(JSON.stringify({ state: existsSync(state) ? readFileSync(state, 'utf8') : 'OPEN' }));
if (command === 'pr' && action === 'merge') writeFileSync(state, 'MERGED');
if (command === 'pr' && action === 'close') writeFileSync(state, 'CLOSED');
`;

test('commit lands on the task branch and refuses a worktree changed after the check', async () => {
  const f = await fixture();
  await f.identity();
  const done = await f.run(f.task().id);
  const worktree = done.worktree!;
  await writeFile(join(worktree.path, 'late.txt'), 'late');
  await expect(f.delivery.commit(done.id)).rejects.toThrow(/changed after the check passed/);
  await rm(join(worktree.path, 'late.txt'));
  const committed = await f.delivery.commit(done.id);
  expect(await git(f.repoPath, ['rev-parse', worktree.branch])).toBe(committed.commit!.sha);
  expect(await git(f.repoPath, ['rev-parse', 'HEAD'])).toBe(done.repo.base);
  await expect(f.delivery.commit(done.id)).rejects.toThrow(/already committed/);
  expect(() => f.runner.start(done.id)).toThrow(/already committed/);
  await f.delivery.removeWorktree(done.id);
  expect(existsSync(worktree.path)).toBe(false);
  expect(await git(f.repoPath, ['rev-parse', worktree.branch])).toBe(committed.commit!.sha);
});

test('merge brings the work into the current branch, and the revert command undoes it inline', async () => {
  const f = await fixture();
  await f.identity();
  const task = await f.run(f.task().id);
  await writeFile(join(f.repoPath, 'README.md'), 'local edit');
  await expect(f.delivery.merge(task.id)).rejects.toThrow(/uncommitted changes/);
  await git(f.repoPath, ['checkout', '--', 'README.md']);

  const merged = await f.delivery.merge(task.id);
  const merge = merged.merge!;
  expect(await readFile(join(f.repoPath, 'output.txt'), 'utf8')).toBe('implemented\n');
  expect(merge.sha).toBe(await git(f.repoPath, ['rev-parse', 'HEAD']));
  expect(merged.worktreeRemoved).toBe(true);
  await expect(f.delivery.merge(task.id)).rejects.toThrow(/already merged/);
  await expect(f.delivery.uncommit(task.id)).rejects.toThrow(/merged/);

  expect(deliveryCommands(merged).map(command => command.argv)).toEqual([['git', 'revert', '-m', '1', '--no-edit', merge.sha]]);
  await expect(f.delivery.runCommand(task.id, 'close-pull-request')).rejects.toThrow(/not available/);
  await git(f.repoPath, ['checkout', '-b', 'elsewhere']);
  await expect(f.delivery.runCommand(task.id, 'revert')).rejects.toThrow(/Check out/);
  await git(f.repoPath, ['checkout', merge.branch]);

  const reverted = await f.delivery.runCommand(task.id, 'revert');
  expect(existsSync(join(f.repoPath, 'output.txt'))).toBe(false);
  expect(reverted.revert?.sha).toBe(await git(f.repoPath, ['rev-parse', 'HEAD']));
  expect(deliveryCommands(reverted)).toEqual([]);
  await expect(f.delivery.runCommand(task.id, 'revert')).rejects.toThrow(/not available/);
  expect(f.store.events(task.id).some(event => event.type === 'reverted' && event.details.command.startsWith('git revert -m 1'))).toBe(true);
});

test('a pull request pushes the task branch, and gh commands merge or close it inline', async () => {
  const f = await fixture();
  await f.identity();
  const task = await f.run(f.task().id);
  await expect(f.delivery.openPullRequest(task.id)).rejects.toThrow(/no origin remote/);
  const origin = join(f.root, 'origin.git');
  await git(f.root, ['init', '--bare', origin]);
  await git(f.repoPath, ['remote', 'add', 'origin', origin]);
  const gh = join(f.root, 'gh');
  await writeFile(gh, fakeGitHubCli(f.root), { mode: 0o755 });
  process.env.FACTORY_GH = gh;
  onCleanup(() => delete process.env.FACTORY_GH);

  const opened = await f.delivery.openPullRequest(task.id);
  expect([opened.pullRequest?.url, opened.pullRequest?.state]).toEqual(['https://github.com/example/ledger/pull/7', 'OPEN']);
  expect(await git(origin, ['rev-parse', opened.commit!.branch])).toBe(opened.commit!.sha);
  await expect(f.delivery.openPullRequest(task.id)).rejects.toThrow(/already has a pull request/);
  expect(deliveryCommands(opened).map(command => command.id)).toEqual(['merge-pull-request', 'close-pull-request']);

  const mergedOnGitHub = await f.delivery.runCommand(task.id, 'merge-pull-request');
  expect(mergedOnGitHub.pullRequest?.state).toBe('MERGED');
  expect(deliveryCommands(mergedOnGitHub)).toEqual([]);

  f.store.update(task.id, { pullRequest: { ...mergedOnGitHub.pullRequest!, state: 'OPEN' } });
  await writeFile(join(f.root, 'gh-state'), 'OPEN');
  expect((await f.delivery.runCommand(task.id, 'close-pull-request')).pullRequest?.state).toBe('CLOSED');

  const calls = await readFile(join(f.root, 'gh-calls'), 'utf8');
  expect(calls).toContain('pr merge https://github.com/example/ledger/pull/7 --merge');
  expect(calls).toContain('pr close https://github.com/example/ledger/pull/7');
  expect(f.store.events(task.id).filter(event => event.type === 'pull_request').map(event => event.text)).toContain('Pull request merged');
});

test('removing an uncommitted worktree deletes its branch and ends the task', async () => {
  const f = await fixture();
  const failed = await f.run(f.task(undefined, exitCheck(5)).id);
  await f.delivery.removeWorktree(failed.id);
  expect(existsSync(failed.worktree!.path)).toBe(false);
  await expect(git(f.repoPath, ['rev-parse', '--verify', failed.worktree!.branch])).rejects.toThrow();
  expect(() => f.runner.start(failed.id)).toThrow(/worktree was removed/);
});

test('rollback restores an earlier attempt or the original code, after undoing a commit', async () => {
  const f = await fixture();
  await f.identity();
  const task = f.task('Write output', fileCheck('fixed.txt'));
  await f.run(task.id);
  const done = await f.run(task.id, 'Create fixed.txt');
  expect(done.status).toBe('handoff');
  const [first, second] = done.history!;
  expect([first.attempt, first.exitCode, second.attempt, second.exitCode]).toEqual([1, 3, 2, 0]);
  const files = (...names: string[]) => names.map(name => existsSync(join(done.worktree!.path, name)));

  const committed = await f.delivery.commit(task.id);
  await expect(f.delivery.rollback(task.id, first.candidate)).rejects.toThrow(/Undo the commit/);
  await f.delivery.uncommit(task.id);
  expect(f.store.require(task.id).commit).toBeNull();
  expect(await git(f.repoPath, ['rev-parse', done.worktree!.branch])).toBe(done.repo.base);
  expect(committed.commit?.sha).toBeTruthy();

  expect((await f.delivery.rollback(task.id, first.candidate)).status).toBe('failed');
  expect(files('output.txt', 'fixed.txt')).toEqual([true, false]);

  expect((await f.delivery.rollback(task.id, second.candidate)).status).toBe('handoff');
  expect(files('output.txt', 'fixed.txt')).toEqual([true, true]);
  expect((await f.delivery.commit(task.id)).commit?.sha).toBeTruthy();
  await f.delivery.uncommit(task.id);

  expect((await f.delivery.rollback(task.id, 'base')).status).toBe('canceled');
  expect(files('output.txt', 'fixed.txt', 'README.md')).toEqual([false, false, true]);
  await expect(f.delivery.rollback(task.id, 'not-a-snapshot')).rejects.toThrow(/not part of this task/);
});

test('settling moves a finished task and refuses a running one', async () => {
  const f = await fixture();
  const task = f.task();
  expect(() => f.delivery.settle(task.id, 'yes')).toThrow(/Choose whether/);
  expect(f.delivery.settle(task.id, true).settled).toBe(true);
  expect(f.delivery.settle(task.id, false).settled).toBe(false);
  f.store.update(task.id, { status: 'running' });
  expect(() => f.delivery.settle(task.id, true)).toThrow(/Stop the run/);
});
