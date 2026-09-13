import { expect, test } from 'bun:test';
import type { ProgressEvent, ProgressUpdate } from '../shared/types';
import { Progress } from '../backend/progress';

const flushed = () => Bun.sleep(150);

test('live progress sends one update per task per flush, keeps a bounded tail, and clears', async () => {
  const progress = new Progress();
  const updates: ProgressEvent[] = [];
  progress.on('update', update => updates.push(update));

  progress.set('a', 'cmd-1', 'output', '', 'npm test');
  for (let line = 0; line < 500; line++) progress.append('a', 'cmd-1', 'output', `line ${line}\n`);
  progress.append('b', 'msg-1', 'message', 'Hel');
  progress.append('b', 'msg-1', 'message', 'lo');
  await flushed();

  expect(updates).toHaveLength(2);
  const output = updates.find(update => update.taskId === 'a') as ProgressUpdate;
  expect(output.label).toBe('npm test');
  expect(output.text).toHaveLength(4000);
  expect(output.text.endsWith('line 499\n')).toBe(true);
  expect((updates.find(update => update.taskId === 'b') as ProgressUpdate).text).toBe('Hello');

  progress.end('a', 'another-item');
  progress.append('b', 'msg-2', 'message', 'Next');
  progress.end('a');
  await flushed();

  expect(updates.slice(2)).toEqual([{ taskId: 'b', key: 'msg-2', kind: 'message', label: '', text: 'Next' }, { taskId: 'a', cleared: true }]);
  expect(progress.current()).toEqual([{ taskId: 'b', key: 'msg-2', kind: 'message', label: '', text: 'Next' }]);
});
