import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Delivery } from '../backend/delivery';
import { LiveApps } from '../backend/live';
import { Store } from '../backend/store';
import { cleanupAfterEach, until } from './support';

const onCleanup = cleanupAfterEach();
const serving = "const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('live') }); console.log('Ready at http://127.0.0.1:' + server.port);";
const reachable = (url: string) => fetch(url).then(() => true, () => false);

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'factory-live-'));
  const store = new Store(':memory:');
  const agent = { running: null as string | null };
  const live = new LiveApps(store, id => id === agent.running, { root });
  onCleanup(async () => {
    await live.stopAll();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const task = async (name: string, source = serving) => {
    const path = join(root, name);
    await mkdir(path);
    await writeFile(join(path, 'app.js'), source);
    const created = store.create({ title: name, criteria: name, model: 'test', setup: [], check: [], repo: { path: root, base: 'abc' }, worktree: { path, branch: `factory/${name}` } });
    store.update(created.id, { status: 'handoff', preview: { status: 'captured', candidate: 'tree', command: [process.execPath, 'app.js'], source: 'agent', shots: [], errors: [], at: new Date().toISOString(), durationMs: 1 } });
    return created;
  };
  return { root, store, live, agent, task };
}

test('a task app keeps running for review, one at a time, and stops when the task settles', async () => {
  const { store, live, task } = await setup();
  const first = await task('first');
  const second = await task('second');

  const url = (await live.start(first.id)).liveApp!.url;
  expect(await (await fetch(url)).text()).toBe('live');
  await live.start(second.id);
  expect(store.require(first.id).liveApp).toBeNull();
  await until(async () => !(await reachable(url)), { attempts: 80, delayMs: 50 });

  new Delivery(store, () => false, live).settle(second.id, true);
  await until(() => store.require(second.id).liveApp === null, { attempts: 80, delayMs: 50 });
  expect(store.events(second.id).map(event => event.text)).toEqual(expect.arrayContaining(['App running', 'App stopped']));
  await expect(live.stop(second.id)).rejects.toThrow(/not running/);
});

test('an app that exits clears its state, apps wait for the run, and a restart clears stale state', async () => {
  const { root, store, live, agent, task } = await setup();
  const crash = await task('crash', `${serving} setTimeout(() => process.exit(3), 400);`);

  await live.start(crash.id);
  await until(() => store.require(crash.id).liveApp === null, { attempts: 80, delayMs: 50 });
  expect(store.events(crash.id).some(event => event.text === 'App exited: 3')).toBe(true);

  agent.running = crash.id;
  await expect(live.start(crash.id)).rejects.toThrow(/Wait for the run/);
  agent.running = null;

  store.update(crash.id, { liveApp: { url: 'http://127.0.0.1:1', command: ['app'], startedAt: new Date().toISOString() } });
  new LiveApps(store, () => false, { root });
  expect(store.require(crash.id).liveApp).toBeNull();
});
