import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../backend/store';
import { Terminal } from '../backend/terminal';
import { cleanupAfterEach, until } from './support';

const onCleanup = cleanupAfterEach();

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'factory-terminal-'));
  const store = new Store(':memory:');
  const agent = { running: null as string | null };
  const terminal = new Terminal(store, id => id === agent.running);
  onCleanup(async () => {
    await terminal.stopAll();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const task = store.create({ title: 'Run it', criteria: 'Run it', model: 'test', setup: [], check: [], repo: { path: root, base: 'abc' }, worktree: { path: root, branch: 'factory/run' } });
  store.update(task.id, { status: 'handoff' });
  const run = () => store.require(task.id).ownerCommand;
  return { root, store, terminal, agent, task, run };
}

test('a command runs in the worktree, streams its output, and finds the local URL it prints', async () => {
  const { root, store, terminal, task, run } = await setup();
  await terminal.start(task.id, 'echo "ready on http://localhost:4321/app"');
  await until(() => run()?.status === 'exited');
  expect(run()).toMatchObject({ cwd: root, exitCode: 0, url: 'http://localhost:4321/app' });
  expect(run()?.output).toContain('ready on');
  const types = store.events(task.id).map(event => event.type);
  expect(types).toContain('owner_command_started');
  expect(types).toContain('owner_command');
});

test('a long-running command stops on request, and commands wait for the agent run', async () => {
  const { terminal, agent, task, run } = await setup();
  await terminal.start(task.id, 'echo started; sleep 30');
  await until(() => run()?.output.includes('started'));
  await expect(terminal.start(task.id, 'echo again')).rejects.toThrow(/already running/);
  terminal.stop(task.id);
  await until(() => run()?.status === 'stopped');
  expect(() => terminal.stop(task.id)).toThrow(/No command is running/);

  agent.running = task.id;
  await expect(terminal.start(task.id, 'echo nope')).rejects.toThrow(/Wait for the agent run/);
  agent.running = null;
  await expect(terminal.start(task.id, '   ')).rejects.toThrow(/Choose a command/);
});
