import { expect, test } from 'bun:test';
import { mergeEvents, refreshQueue } from '../web/src/lib/sync';

test('refreshes coalesce while a slow request is in flight', async () => {
  const gate = Promise.withResolvers<void>();
  let active = 0;
  let peak = 0;
  let calls = 0;
  const refresh = refreshQueue(async () => {
    calls++;
    peak = Math.max(peak, ++active);
    if (calls === 1) await gate.promise;
    active--;
  });
  const first = refresh();
  for (let index = 0; index < 50; index++) refresh();
  expect(calls).toBe(1);
  gate.resolve();
  await first;
  expect(calls).toBe(2);
  expect(peak).toBe(1);
  await refresh();
  expect(calls).toBe(3);
});

test('replayed events stay ordered, unique, and bounded', () => {
  const history = Array.from({ length: 500 }, (_, index) => ({ id: index + 1, text: String(index) }));
  const events = mergeEvents(history.slice(0, 200), [...history.slice(199), history[499]]);
  expect(events).toHaveLength(200);
  expect(events[0].id).toBe(301);
  expect(events.at(-1)?.id).toBe(500);
  expect(new Set(events.map(event => event.id)).size).toBe(200);
});
