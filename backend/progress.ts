import { EventEmitter } from 'node:events';
import type { ProgressEvent, ProgressKind, ProgressUpdate } from '@shared/types';

const tailChars = 4000;
const flushMs = 100;

export class Progress extends EventEmitter {
  private readonly entries = new Map<string, ProgressUpdate>();
  private readonly dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.setMaxListeners(0);
  }

  set(taskId: string, key: string, kind: ProgressKind, text: string, label = '') {
    this.entries.set(taskId, { taskId, key, kind, label, text: text.slice(-tailChars) });
    this.touch(taskId);
  }

  append(taskId: string, key: string, kind: ProgressKind, delta: string) {
    const current = this.entries.get(taskId);
    const same = current?.key === key;
    this.set(taskId, key, kind, same ? current.text + delta : delta, same ? current.label : '');
  }

  end(taskId: string, key?: string) {
    const current = this.entries.get(taskId);
    if (!current || (key !== undefined && current.key !== key)) return;
    this.entries.delete(taskId);
    this.touch(taskId);
  }

  current() {
    return [...this.entries.values()];
  }

  // Deltas arrive per token or per output chunk, so listeners get at most one update per task per flush.
  private touch(taskId: string) {
    this.dirty.add(taskId);
    this.timer ??= setTimeout(() => this.flush(), flushMs);
  }

  private flush() {
    this.timer = null;
    for (const taskId of this.dirty) {
      const event: ProgressEvent = this.entries.get(taskId) ?? { taskId, cleared: true };
      this.emit('update', event);
    }
    this.dirty.clear();
  }
}
