import { expect, test } from 'bun:test';
import type { TaskStatus } from '../shared/domain';
import { arrivals, faviconHref, unseenAfter, without } from '../web/src/lib/notifications';

const task = (id: string, status: TaskStatus, settled?: boolean) => ({ id, status, settled });

test('only status changes into waiting, finished, or failed states notify', () => {
  const previous = new Map<string, TaskStatus>([['a', 'running'], ['b', 'running'], ['c', 'handoff'], ['d', 'checking']]);
  const next = [task('a', 'awaiting_approval'), task('b', 'checking'), task('c', 'handoff'), task('d', 'failed'), task('new', 'handoff')];
  expect(arrivals(previous, next).map(item => item.id)).toEqual(['a', 'd']);
  expect(arrivals(new Map(), next)).toEqual([]);
});

test('unseen tasks keep finished work until it is viewed, restarted, or settled', () => {
  const start = unseenAfter(new Set(), [], [task('a', 'handoff'), task('b', 'awaiting_approval')]);
  expect([...start]).toEqual(['a']);
  expect(unseenAfter(start, [task('a', 'handoff')], [])).toBe(start);
  expect(unseenAfter(start, [], [])).toBe(start);
  expect([...unseenAfter(start, [task('a', 'running')], [])]).toEqual([]);
  expect([...unseenAfter(start, [task('a', 'handoff', true)], [])]).toEqual([]);
  expect([...without(start, 'a')]).toEqual([]);
  expect(without(start, 'missing')).toBe(start);
});

test('the tab icon shows a capped count only when something needs you', () => {
  expect(faviconHref(0)).toBe('/favicon.svg');
  expect(decodeURIComponent(faviconHref(3))).toContain('>3</text>');
  expect(decodeURIComponent(faviconHref(12))).toContain('>9+</text>');
});
