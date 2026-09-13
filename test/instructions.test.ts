import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadInstructions } from '../backend/instructions';
import { cleanupAfterEach } from './support';

const onCleanup = cleanupAfterEach();
const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

test('global and repository instruction files reach every agent exactly once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-instructions-'));
  onCleanup(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const worktree = join(root, 'worktree');
  await mkdir(join(home, '.claude'), { recursive: true });
  await mkdir(join(home, '.codex'), { recursive: true });
  await mkdir(worktree);
  await writeFile(join(home, '.claude', 'CLAUDE.md'), 'Global Claude rules\n');
  await writeFile(join(home, '.codex', 'AGENTS.md'), 'Global agent rules');
  await writeFile(join(worktree, 'CLAUDE.md'), 'Repository Claude rules');
  await writeFile(join(worktree, 'AGENTS.md'), 'Repository agent rules');

  for (const harness of ['claude', 'opencode'] as const) {
    const { text, files } = await loadInstructions({ harness, worktree, home, env: {} });
    for (const rule of ['Global Claude rules', 'Global agent rules', 'Repository Claude rules', 'Repository agent rules']) expect(occurrences(text, rule)).toBe(1);
    expect(text).toMatch(/## Owner instructions from ~\/\.claude\/CLAUDE\.md\n\nGlobal Claude rules/);
    expect(text).toMatch(/## Repository instructions from AGENTS\.md\n\nRepository agent rules/);
    expect(files.map(file => [file.scope, file.label, file.native])).toEqual([['global', '~/.claude/CLAUDE.md', false], ['global', '~/.codex/AGENTS.md', false], ['repository', 'CLAUDE.md', false], ['repository', 'AGENTS.md', false]]);
  }

  const codex = await loadInstructions({ harness: 'codex', worktree, home, env: {} });
  expect(codex.text).toMatch(/Global Claude rules/);
  expect(codex.text).toMatch(/Repository Claude rules/);
  expect(codex.text).not.toMatch(/Global agent rules|Repository agent rules/);
  expect(codex.files.map(file => [file.label, file.native])).toEqual([['~/.claude/CLAUDE.md', false], ['~/.codex/AGENTS.md', true], ['CLAUDE.md', false], ['AGENTS.md', true]]);

  await writeFile(join(worktree, 'CLAUDE.md'), 'Repository agent rules');
  const copied = await loadInstructions({ harness: 'codex', worktree, home, env: {} });
  expect(copied.files.map(file => file.label)).toEqual(['~/.claude/CLAUDE.md', '~/.codex/AGENTS.md', 'AGENTS.md']);
  const claude = await loadInstructions({ harness: 'claude', worktree, home, env: {} });
  expect(occurrences(claude.text, 'Repository agent rules')).toBe(1);

  const codexHome = join(root, 'codex-home');
  await mkdir(codexHome);
  await writeFile(join(codexHome, 'AGENTS.md'), 'Relocated agent rules');
  const relocated = await loadInstructions({ harness: 'opencode', worktree, home, env: { CODEX_HOME: codexHome } });
  expect(relocated.files.some(file => file.label === join(codexHome, 'AGENTS.md'))).toBe(true);
  expect(relocated.text).toMatch(/Relocated agent rules/);
  expect((await loadInstructions({ harness: 'claude', worktree: join(root, 'empty'), home: join(root, 'nobody'), env: {} })).text).toBe('');

  await writeFile(join(worktree, 'CLAUDE.md'), 'x'.repeat(70 * 1024));
  const large = await loadInstructions({ harness: 'claude', worktree, home, env: {} });
  expect(large.text).toContain('[Truncated by Local Factory]');
  expect(large.files.find(file => file.label === 'CLAUDE.md')?.bytes).toBe(70 * 1024);
});

test('identical owner files are delivered once, and native Codex files suppress their copies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-instructions-'));
  onCleanup(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const worktree = join(root, 'worktree');
  for (const directory of ['.claude', '.codex', '.config/opencode']) await mkdir(join(home, directory), { recursive: true });
  await mkdir(worktree);
  for (const file of ['.claude/CLAUDE.md', '.codex/AGENTS.md', '.config/opencode/AGENTS.md']) await writeFile(join(home, file), 'Same owner rules');
  const claude = await loadInstructions({ harness: 'claude', worktree, home, env: {} });
  expect(occurrences(claude.text, 'Same owner rules')).toBe(1);
  expect(claude.files.map(file => file.label)).toEqual(['~/.claude/CLAUDE.md']);
  const codex = await loadInstructions({ harness: 'codex', worktree, home, env: {} });
  expect(codex.text).toBe('');
  expect(codex.files.map(file => file.label)).toEqual(['~/.codex/AGENTS.md']);
});
