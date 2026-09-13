import { expect, test } from 'bun:test';
import type { ProgressKind } from '../shared/types';
import { createFixture } from './fixture';
import { cleanupAfterEach } from './support';

const onCleanup = cleanupAfterEach();
const loudCheck = [process.execPath, '-e', "console.log('checked'); console.error('warned')"];

test('agent text and check output stream as live progress, and the check still records its output', async () => {
  const f = await createFixture(onCleanup);
  const appended: [string, ProgressKind, string][] = [];
  const append = f.store.progress.append.bind(f.store.progress);
  f.store.progress.append = (taskId, key, kind, delta) => {
    appended.push([key, kind, delta]);
    append(taskId, key, kind, delta);
  };
  const task = f.task('Write output LIVE_PROGRESS', loudCheck);
  const result = await f.run(task.id);

  expect(result.status).toBe('handoff');
  expect(result.checkResult?.stdout).toBe('checked\n');
  expect(result.checkResult?.stderr).toBe('warned\n');
  expect(appended).toContainEqual(['msg-1', 'message', 'Streaming ']);
  expect(appended).toContainEqual([`check-${task.id}`, 'output', 'checked\n']);
  expect(f.store.progress.current()).toEqual([]);
  expect(f.store.events(task.id).some(event => event.text.includes('Streaming'))).toBe(false);
});
