import type { PullRequest, PullRequestState } from '../shared/types';
import { currentBranch, hasOrigin, optionalGit } from './git';
import { MissingCommandError, pickEnv, run, safeEnv } from './process';

const deliveryTimeoutMs = 120_000;

// Pushing and GitHub CLI calls need the owner's SSH agent and GitHub credentials, which repository commands never get.
const networkEnv = () => ({ ...safeEnv(), ...pickEnv(['SSH_AUTH_SOCK', 'GH_TOKEN', 'GITHUB_TOKEN', 'XDG_CONFIG_HOME']) });

export async function gh(repoPath: string, args: string[]) {
  try {
    return await run([Bun.env.FACTORY_GH || 'gh', ...args], { cwd: repoPath, env: networkEnv(), timeoutMs: deliveryTimeoutMs });
  } catch (error) {
    if (error instanceof MissingCommandError) throw new Error('GitHub CLI is not installed. Install gh and run gh auth login, then try again.');
    throw error;
  }
}

export async function createPullRequest(repoPath: string, branch: string, { title, body }: { title: string; body: string }): Promise<PullRequest> {
  if (!(await hasOrigin(repoPath))) throw new Error('This repository has no origin remote. Use Merge to finish locally.');
  const originHead = await optionalGit(repoPath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const base = originHead ? originHead.replace(/^origin\//, '') : await currentBranch(repoPath);
  try {
    await run(['git', '-c', 'core.hooksPath=/dev/null', 'push', '--set-upstream', 'origin', branch], { cwd: repoPath, env: { ...networkEnv(), GIT_TERMINAL_PROMPT: '0' }, timeoutMs: deliveryTimeoutMs });
  } catch (error) {
    throw new Error(`Could not push ${branch}: ${(error as Error).message}`);
  }
  try {
    const output = await gh(repoPath, ['pr', 'create', '--head', branch, '--base', base, '--title', title, '--body', body]);
    const url = output.trim().split('\n').filter(Boolean).at(-1) ?? '';
    return { url, base, branch, state: 'OPEN' };
  } catch (error) {
    throw new Error(`The branch was pushed, but the pull request could not be opened: ${(error as Error).message}`);
  }
}

export async function pullRequestState(repoPath: string, url: string): Promise<PullRequestState> {
  const output = await gh(repoPath, ['pr', 'view', url, '--json', 'state']);
  return JSON.parse(output).state;
}
