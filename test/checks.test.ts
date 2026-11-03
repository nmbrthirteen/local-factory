import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { namedCheck, resolveCheck } from '../backend/checks';
import type { Task } from '../shared/types';
import { cleanupAfterEach } from './support';

const onCleanup = cleanupAfterEach();
const named = (command: string) => namedCheck(`Done.\nCHECK: ${command}`);

test('an agent check that cannot fail is ignored, however it is wrapped', () => {
  for (const command of [
    'true',
    '/usr/bin/true',
    'exit 0',
    'echo ok',
    'node -e 0',
    "node -e 'process.exit(0)'",
    'bun --eval "1"',
    "python3 -c 'pass'",
    'sh -c true',
    "bash -c 'npm test || true'",
    "sh -c 'npm test; true'",
    "sh -c 'npm test | tee log'",
    'env CI=1 true',
    'env',
  ]) {
    expect([command, named(command)]).toEqual([command, []]);
  }

  for (const command of [
    'npm test',
    'node --test',
    'bun run test',
    "sh -c 'npm run lint && npm test'",
    'env CI=1 npm test',
    "node -e \"require('node:assert').ok(require('node:fs').existsSync('out.txt'))\"",
  ]) {
    expect(named(command).length).toBeGreaterThan(0);
  }
});

test('a detected check runs the test script with the package manager the lockfile names', async () => {
  const path = await mkdtemp(join(tmpdir(), 'factory-checks-'));
  onCleanup(() => rm(path, { recursive: true, force: true }));
  const task: Pick<Task, 'check'> = { check: [] };
  await writeFile(join(path, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
  expect(await resolveCheck(task, '', path)).toEqual({ check: ['npm', 'test'], source: 'detected' });
  await writeFile(join(path, 'pnpm-lock.yaml'), '');
  expect(await resolveCheck(task, '', path)).toEqual({ check: ['pnpm', 'test'], source: 'detected' });
  expect(await resolveCheck(task, 'CHECK: sh -c true', path)).toEqual({ check: ['pnpm', 'test'], source: 'detected' });
});
