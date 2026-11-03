import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sandboxProfile } from '../backend/agents/opencode';
import { baseTree, candidateTree, checkout, createWorktree, git } from '../backend/git';
import { run } from '../backend/process';
import { createFixture } from './fixture';
import { cleanupAfterEach } from './support';

const onCleanup = cleanupAfterEach();

test('the sandbox cannot write the worktree .git file or the real gitdir', async () => {
  const f = await createFixture(onCleanup);
  const tree = await checkout(f.repoPath, await createWorktree(f.repo, join(f.root, 'worktrees'), 'sealed'));
  const profile = join(f.root, 'profile.sb');
  await writeFile(profile, sandboxProfile([tree.path]));

  const append = (path: string) =>
    run(['/usr/bin/sandbox-exec', '-f', profile, '/bin/sh', '-c', 'echo x >> "$0"', path]).then(
      () => 'written',
      () => 'blocked',
    );

  expect(await append(join(tree.path, 'notes.txt'))).toBe('written');
  expect(await append(join(tree.path, '.git'))).toBe('blocked');
  expect(await append(join(tree.gitDir, 'config'))).toBe('blocked');
  expect(await append(join(f.repoPath, '.git/config'))).toBe('blocked');
});

test('factory Git calls use the recorded gitdir, so a planted gitdir and filter driver never run', async () => {
  const f = await createFixture(onCleanup);
  const worktree = await createWorktree(f.repo, join(f.root, 'worktrees'), 'planted');
  const tree = await checkout(f.repoPath, worktree);
  const marker = join(f.root, 'filter-ran');
  const planted = join(tree.path, 'planted-git');
  await git(f.root, ['init', '--bare', planted]);
  await git(f.root, ['config', '-f', join(planted, 'config'), 'core.bare', 'false']);
  await git(f.root, ['config', '-f', join(planted, 'config'), 'filter.evil.clean', `touch ${marker}; cat`]);
  await writeFile(join(tree.path, '.git'), `gitdir: ${planted}\n`);
  await writeFile(join(tree.path, '.gitattributes'), '* filter=evil\n');

  expect(await checkout(f.repoPath, worktree)).toEqual(tree);
  expect(await baseTree(tree, f.repo.base)).toBe(await git(f.repoPath, ['rev-parse', `${f.repo.base}^{tree}`]));
  await candidateTree(tree);
  expect(existsSync(marker)).toBe(false);

  await git(tree.path, ['add', '--all']);
  expect(existsSync(marker)).toBe(true);
});
