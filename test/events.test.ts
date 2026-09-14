import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import type { ApiServices } from '../backend/api';
import { Store } from '../backend/store';
import type { TaskEvent } from '../shared/types';
import { cleanupAfterEach, openSession, serveApi, until } from './support';

const onCleanup = cleanupAfterEach();
const decoder = new TextDecoder();

type TaskDetail = { events: TaskEvent[]; hasMore: boolean };

test('authenticated event stream wakes clients, replays persisted events, and releases subscriptions', async () => {
  const store = new Store(':memory:');
  const { server, base } = serveApi({ store, root: tmpdir(), runner: { recovery: [], runs: new Map() } as unknown as ApiServices['runner'] });
  onCleanup(() => {
    server.stop(true);
    store.close();
  });

  expect((await fetch(`${base}/api/events`)).status).toBe(401);
  const headers = { Cookie: await openSession(base) };
  const detail = async (query = '') => (await fetch(`${base}/api/tasks/${task.id}${query}`, { headers })).json() as Promise<TaskDetail>;
  expect((await fetch(`${base}/api/events`, { headers: { ...headers, Origin: 'https://invalid.test' } })).status).toBe(403);

  const abort = new AbortController();
  const stream = await fetch(`${base}/api/events`, { headers, signal: abort.signal });
  expect(stream.headers.get('content-type')).toMatch(/text\/event-stream/);
  const reader = stream.body!.getReader();
  expect(decoder.decode((await reader.read()).value)).toMatch(/event: change/);
  const task = store.create({ title: 'Live task', criteria: 'Live', model: 'test', setup: [], check: [], repo: { path: '/tmp/live', base: 'abc' } });
  expect(decoder.decode((await reader.read()).value)).toMatch(/event: change/);
  const cursor = (await detail()).events.at(-1)!.id;

  abort.abort();
  await reader.cancel().catch(() => undefined);
  await until(() => store.listenerCount('change') === 0, { attempts: 40, delayMs: 10 });

  for (let index = 0; index < 420; index++) store.event(task.id, 'message', `Output ${index}`);
  const latest = await detail('?latest=1');
  expect(latest.events).toHaveLength(200);
  expect(latest.events.at(-1)?.text).toBe('Output 419');
  expect(latest.hasMore).toBe(false);

  const missed: TaskEvent[] = [];
  for (let after = cursor, more = true; more;) {
    const page = await detail(`?after=${after}`);
    missed.push(...page.events);
    after = page.events.at(-1)!.id;
    more = page.hasMore;
  }
  expect(missed).toHaveLength(420);
  expect(new Set(missed.map(event => event.id)).size).toBe(420);

  const download = await fetch(`${base}/api/tasks/${task.id}/activity`, { headers });
  const log = (await download.text()).trim().split('\n').map(line => JSON.parse(line));
  expect(log).toHaveLength(421);
  expect(log.at(-1).text).toBe('Output 419');
  expect(download.headers.get('content-disposition')).toMatch(/activity.jsonl/);
  expect((await fetch(`${base}/api/tasks/${task.id}?after=-1`, { headers })).status).toBe(400);
});
