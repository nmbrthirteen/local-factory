import { access, mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Commit, Recipe, Repository, Worktree } from '../shared/types';
import { run, safeEnv } from './process';

const recipes: Recipe[] = [
  { lockfile: 'package-lock.json', setup: ['npm', 'ci'], check: ['npm', 'test'] },
  { lockfile: 'pnpm-lock.yaml', setup: ['pnpm', 'install', '--frozen-lockfile'], check: ['pnpm', 'test'] },
  { lockfile: 'yarn.lock', setup: ['yarn', 'install', '--frozen-lockfile'], check: ['yarn', 'test'] },
  { lockfile: 'bun.lock', setup: ['bun', 'install', '--frozen-lockfile'], check: ['bun', 'run', 'test'] },
];

export const pathExists = (path: string) => access(path).then(() => true, () => false);

export async function git(cwd: string, args: string[]) {
  const output = await run(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd, env: { ...safeEnv(), GIT_TERMINAL_PROMPT: '0' } });
  return output.trim();
}

export const optionalGit = (cwd: string, args: string[]) => git(cwd, args).catch(() => '');
export const currentBranch = (path: string) => optionalGit(path, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
export const hasOrigin = async (path: string) => Boolean(await optionalGit(path, ['remote', 'get-url', 'origin']));
export const baseTree = (path: string, base: string) => git(path, ['rev-parse', `${base}^{tree}`]);
const stageAll = (path: string) => git(path, ['add', '--all']);

async function requireIdentity(path: string, action: string) {
  if (!(await optionalGit(path, ['config', 'user.email']))) throw new Error(`Git has no user.email for this repository. Set one with git config --global user.email, then ${action} again.`);
}

async function requireCleanBranch(path: string, action: string) {
  const branch = await currentBranch(path);
  if (!branch) throw new Error(`The repository is not on a branch. Check out a branch, then ${action} again.`);
  if (await git(path, ['status', '--porcelain', '--untracked-files=no'])) throw new Error(`The repository has uncommitted changes on ${branch}. Commit or stash them, then ${action} again.`);
  await requireIdentity(path, action);
  return branch;
}

export async function detectRecipe(root: string) {
  for (const recipe of recipes) {
    if (await pathExists(join(root, recipe.lockfile))) return recipe;
  }
  return null;
}

export async function inspectRepo(path: unknown): Promise<Repository> {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('Choose an absolute repository path');
  const root = await realpath(path);
  if ((await realpath(await git(root, ['rev-parse', '--show-toplevel']))) !== root) throw new Error('Choose the repository root, not a subfolder');
  const [base, status, remote, recipe] = await Promise.all([git(root, ['rev-parse', '--verify', 'HEAD']), git(root, ['status', '--porcelain']), hasOrigin(root), detectRecipe(root)]);
  return { path: root, base, dirty: Boolean(status), remote, recipe };
}

const repoQueues = new Map<string, Promise<unknown>>();

// Parallel runs share one repository, and Git writes its worktree list and refs without locking them against each other.
function onRepo<T>(repoPath: string, work: () => Promise<T>): Promise<T> {
  const next = (repoQueues.get(repoPath) ?? Promise.resolve()).then(work, work);
  repoQueues.set(repoPath, next.catch(() => undefined));
  return next;
}

export async function createWorktree(repo: Repository, directory: string, id: string): Promise<Worktree> {
  const parent = join(directory, basename(repo.path));
  await mkdir(parent, { recursive: true });
  const worktree = { path: join(parent, id), branch: `factory/${id}` };
  await onRepo(repo.path, () => git(repo.path, ['worktree', 'add', '-b', worktree.branch, worktree.path, repo.base]));
  return worktree;
}

export async function candidateTree(path: string) {
  await stageAll(path);
  return git(path, ['write-tree']);
}

export async function commitWorktree(path: string, message: string) {
  await requireIdentity(path, 'commit');
  await stageAll(path);
  await git(path, ['commit', '-m', message]);
  return git(path, ['rev-parse', 'HEAD']);
}

export async function mergeBranch(repoPath: string, branch: string, message: string): Promise<Commit> {
  const target = await requireCleanBranch(repoPath, 'merge');
  try {
    await git(repoPath, ['merge', '--no-ff', '-m', message, branch]);
  } catch (error) {
    await optionalGit(repoPath, ['merge', '--abort']);
    throw new Error(`Could not merge into ${target}, so nothing changed: ${(error as Error).message}`);
  }
  return { branch: target, sha: await git(repoPath, ['rev-parse', 'HEAD']) };
}

export async function revertMerge(repoPath: string, merge: Commit, [, ...args]: string[]): Promise<Commit> {
  const branch = await requireCleanBranch(repoPath, 'revert');
  if (branch !== merge.branch) throw new Error(`The merge landed on ${merge.branch}, but the repository is on ${branch}. Check out ${merge.branch}, then revert again.`);
  const onBranch = await git(repoPath, ['merge-base', '--is-ancestor', merge.sha, 'HEAD']).then(() => true, () => false);
  if (!onBranch) throw new Error(`The merge commit is no longer on ${branch}`);
  try {
    await git(repoPath, args);
  } catch (error) {
    await optionalGit(repoPath, ['revert', '--abort']);
    throw new Error(`Could not revert on ${branch}, so nothing changed: ${(error as Error).message}`);
  }
  return { branch, sha: await git(repoPath, ['rev-parse', 'HEAD']) };
}

export async function restoreTree(path: string, tree: string) {
  await stageAll(path);
  await git(path, ['read-tree', '-u', '--reset', tree]);
}

export async function undoLastCommit(path: string, sha: string) {
  if ((await git(path, ['rev-parse', 'HEAD'])) !== sha) throw new Error('The task branch moved after the commit, so it cannot be undone here');
  await git(path, ['reset', '--soft', 'HEAD~1']);
}

export function deleteWorktree(repoPath: string, worktree: Worktree, keepBranch: boolean) {
  return onRepo(repoPath, async () => {
    await git(repoPath, ['worktree', 'remove', '--force', worktree.path]);
    if (!keepBranch) await git(repoPath, ['branch', '-D', worktree.branch]);
  });
}

export async function exportPatch(path: string, base: string, file: string) {
  await mkdir(dirname(file), { recursive: true });
  await git(path, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--binary', `--output=${file}`, base]);
  return { path: file, bytes: Bun.file(file).size, files: await git(path, ['diff', '--cached', '--stat', base]) };
}
