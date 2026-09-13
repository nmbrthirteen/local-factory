import { commandLine, deliveryCommands, type DeliveryCommand } from '../shared/commands';
import { isActive } from '../shared/domain';
import type { Commit, PullRequest, PullRequestState, Task } from '../shared/types';
import { baseTree, candidateTree, commitWorktree, deleteWorktree, mergeBranch, pathExists, restoreTree, revertMerge, undoLastCommit } from './git';
import { createPullRequest, gh, pullRequestState } from './github';
import type { LiveApps } from './live';
import { run } from './process';
import type { Store } from './store';

const now = () => new Date().toISOString();
const shortSha = (sha: string) => sha.slice(0, 12);

const pullRequestNotes: Record<PullRequestState, string> = {
  OPEN: 'Pull request still open',
  MERGED: 'Pull request merged',
  CLOSED: 'Pull request closed',
};

export class Delivery {
  private readonly store: Store;
  private readonly isRunning: (id: string) => boolean;
  private readonly live?: Pick<LiveApps, 'release'>;

  constructor(store: Store, isRunning: (id: string) => boolean, live?: Pick<LiveApps, 'release'>) {
    this.store = store;
    this.isRunning = isRunning;
    this.live = live;
  }

  async commit(id: string) {
    const task = this.store.require(id);
    if (this.isRunning(id) || task.status !== 'handoff') throw new Error('Only a task whose check passed can be committed');
    if (task.commit) throw new Error('These changes are already committed');
    const worktree = await this.existingWorktree(task, 'The worktree no longer exists');
    if ((await candidateTree(worktree.path)) !== task.candidate) throw new Error('The worktree changed after the check passed. Run another attempt so the check runs again.');
    const sha = await commitWorktree(worktree.path, `${task.title}\n\nCreated by Local Factory task ${id}.`);
    const commit = { sha, branch: worktree.branch, at: now() };
    this.store.event(id, 'committed', `Committed ${shortSha(sha)}`, { sha, branch: worktree.branch });
    return this.store.update(id, { commit });
  }

  async merge(id: string) {
    if (this.isRunning(id)) throw new Error('Wait for the run to finish before merging');
    let task = this.store.require(id);
    if (task.merge) throw new Error('These changes are already merged');
    if (!task.commit) task = await this.commit(id);
    const commit = task.commit as Commit;
    const merged = await mergeBranch(task.repo.path, commit.branch, `Merge ${commit.branch}: ${task.title}`);
    this.store.update(id, { merge: { ...merged, at: now() } });
    this.store.event(id, 'merged', `Merged into ${merged.branch}`, merged);
    await this.live?.release(id);
    return task.worktreeRemoved ? this.store.require(id) : this.removeWorktree(id);
  }

  async openPullRequest(id: string) {
    if (this.isRunning(id)) throw new Error('Wait for the run to finish before opening a pull request');
    let task = this.store.require(id);
    if (task.pullRequest) throw new Error('This task already has a pull request');
    if (task.merge) throw new Error('These changes are already merged');
    if (!task.commit) task = await this.commit(id);
    const commit = task.commit as Commit;
    const check = (task.check.length ? task.check : task.resolvedCheck ?? []).join(' ') || 'none ran';
    const body = `${task.criteria}\n\n---\nCreated by Local Factory with ${task.harness ?? 'codex'} (${task.model}). Check: \`${check}\`.`;
    const pullRequest = await createPullRequest(task.repo.path, commit.branch, { title: task.title, body });
    this.store.event(id, 'pull_request', `Opened a pull request into ${pullRequest.base}`, pullRequest);
    return this.store.update(id, { pullRequest: { ...pullRequest, at: now() } });
  }

  async syncPullRequest(id: string) {
    const task = this.store.require(id);
    if (task.pullRequest?.state !== 'OPEN') return task;
    const state = await pullRequestState(task.repo.path, task.pullRequest.url);
    return state === task.pullRequest.state ? task : this.recordPullRequestState(task, task.pullRequest, state);
  }

  async runCommand(id: string, commandId: unknown) {
    if (this.isRunning(id)) throw new Error('Wait for the run to finish first');
    const task = this.store.require(id);
    const command = deliveryCommands(task).find(candidate => candidate.id === commandId);
    if (!command) throw new Error('That command is not available for this task');
    if (task.merge && command.id === 'revert') return this.revert(task, task.merge, command);
    if (task.pullRequest) {
      await gh(task.repo.path, command.argv.slice(1));
      const state = await pullRequestState(task.repo.path, task.pullRequest.url);
      return this.recordPullRequestState(task, task.pullRequest, state, command);
    }
    throw new Error('That command is not available for this task');
  }

  async rollback(id: string, target: string) {
    const task = this.store.require(id);
    if (this.isRunning(id) || isActive(task.status)) throw new Error('Stop the run before rolling back');
    if (task.commit) throw new Error('Undo the commit before rolling back');
    const worktree = await this.existingWorktree(task, 'This task has no worktree to roll back');
    await this.live?.release(id);
    if (target === 'base') {
      await restoreTree(worktree.path, await baseTree(worktree.path, task.repo.base));
      this.store.event(id, 'rolled_back', 'Rolled back to the original code');
      return this.store.update(id, { status: 'canceled', error: 'Rolled back to the original code. Run another attempt or remove the worktree.', candidate: null, patch: null, checkResult: null, unchecked: false });
    }
    const snapshot = task.history?.find(entry => entry.candidate === target);
    if (!snapshot) throw new Error('That snapshot is not part of this task');
    await restoreTree(worktree.path, snapshot.candidate);
    const unchecked = snapshot.exitCode === null;
    const passed = unchecked || snapshot.exitCode === 0;
    this.store.event(id, 'rolled_back', `Rolled back to attempt ${snapshot.attempt}`);
    return this.store.update(id, {
      status: passed ? 'handoff' : 'failed',
      error: passed ? null : `Rolled back to attempt ${snapshot.attempt}, whose check failed.`,
      candidate: snapshot.candidate,
      patch: snapshot.patch,
      unchecked,
      checkResult: unchecked ? null : { command: snapshot.command, exitCode: snapshot.exitCode, candidate: snapshot.candidate },
    });
  }

  async uncommit(id: string) {
    const task = this.store.require(id);
    if (task.merge) throw new Error('These changes are merged. Revert the merge instead.');
    if (!task.commit) throw new Error('This task has no commit to undo');
    const worktree = await this.existingWorktree(task, 'The worktree was removed, so the commit stays on its branch');
    await undoLastCommit(worktree.path, task.commit.sha);
    this.store.event(id, 'uncommitted', `Undid commit ${shortSha(task.commit.sha)}`);
    return this.store.update(id, { commit: null });
  }

  async removeWorktree(id: string) {
    const task = this.store.require(id);
    if (this.isRunning(id) || isActive(task.status)) throw new Error('Stop the run before removing its worktree');
    if (!task.worktree || task.worktreeRemoved) throw new Error('This task has no worktree');
    await this.live?.release(id);
    await deleteWorktree(task.repo.path, task.worktree, Boolean(task.commit));
    this.store.event(id, 'worktree_removed', task.commit ? 'Worktree removed, branch kept' : 'Worktree and branch removed');
    return this.store.update(id, { worktreeRemoved: true });
  }

  settle(id: string, settled: unknown) {
    if (typeof settled !== 'boolean') throw new Error('Choose whether the task is settled');
    if (isActive(this.store.require(id).status)) throw new Error('Stop the run before settling this task');
    if (settled) void this.live?.release(id);
    this.store.event(id, 'settled', settled ? 'Settled' : 'Back in review');
    return this.store.update(id, { settled, settledAt: settled ? now() : null });
  }

  async reveal(id: string) {
    const { worktree, worktreeRemoved } = this.store.require(id);
    if (!worktree || worktreeRemoved) throw new Error('This task has no worktree to open');
    await run(['open', worktree.path]).catch(() => {
      throw new Error('Could not open the worktree folder');
    });
  }

  private async revert(task: Task, merge: Commit, command: DeliveryCommand) {
    const revert = await revertMerge(task.repo.path, merge, command.argv);
    this.store.event(task.id, 'reverted', `Reverted the merge on ${revert.branch}`, { ...revert, command: commandLine(command.argv) });
    return this.store.update(task.id, { revert: { ...revert, at: now() } });
  }

  private recordPullRequestState(task: Task, pullRequest: PullRequest, state: PullRequestState, command?: DeliveryCommand) {
    this.store.event(task.id, 'pull_request', pullRequestNotes[state], { state, ...(command && { command: commandLine(command.argv) }) });
    return this.store.update(task.id, { pullRequest: { ...pullRequest, state } });
  }

  private async existingWorktree(task: Task, message: string) {
    if (!task.worktree || task.worktreeRemoved || !(await pathExists(task.worktree.path))) throw new Error(message);
    return task.worktree;
  }
}
