import { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { activeStates } from '../shared/domain';
import type { NewTask, Task, TaskEvent } from '../shared/types';
import { statusIn, taskPage, type TaskPageOptions } from './task-list';

export const eventPageSize = 200;

type Row = { data: string };
type EventRow = Row & { id: number };

const now = () => new Date().toISOString();
const parse = <T>(row: Row | null): T | null => (row ? JSON.parse(row.data) : null);
const toEvent = (row: EventRow): TaskEvent => ({ ...JSON.parse(row.data), id: row.id });

export class Store extends EventEmitter {
  readonly db: Database;
  private notifying = false;

  constructor(path: string) {
    super();
    this.setMaxListeners(0);
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true, strict: true });
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL)');
    this.db.run('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, data TEXT NOT NULL)');
    this.db.run('CREATE INDEX IF NOT EXISTS events_task ON events(task_id, id)');
    this.db.run('CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  }

  list() {
    return this.db.query<Row, []>('SELECT data FROM tasks ORDER BY rowid DESC').all().map(row => JSON.parse(row.data) as Task);
  }

  activeTasks() {
    return this.db.query<Row, []>(`SELECT data FROM tasks WHERE ${statusIn(activeStates)} ORDER BY rowid DESC`).all().map(row => JSON.parse(row.data) as Task);
  }

  attentionCount() {
    return this.db.query<{ count: number }, []>("SELECT count(*) AS count FROM tasks WHERE status = 'awaiting_approval'").get()?.count ?? 0;
  }

  taskPage(options: TaskPageOptions) {
    return taskPage(this.db, options);
  }

  get(id: string) {
    return parse<Task>(this.db.query<Row, [string]>('SELECT data FROM tasks WHERE id = ?').get(id));
  }

  require(id: string) {
    const task = this.get(id);
    if (!task) throw new Error('Task not found');
    return task;
  }

  create(input: NewTask) {
    const task: Task = { ...input, id: randomUUID(), status: 'queued', createdAt: now() };
    this.db.query('INSERT INTO tasks VALUES (?, ?, ?)').run(task.id, task.status, JSON.stringify(task));
    this.event(task.id, 'queued', 'Saved');
    return task;
  }

  update(id: string, patch: Partial<Task>) {
    const task: Task = { ...this.require(id), ...patch, updatedAt: now() };
    this.db.query('UPDATE tasks SET status = ?, data = ? WHERE id = ?').run(task.status, JSON.stringify(task), id);
    this.changed();
    return task;
  }

  claim(id: string, allowed: readonly string[]) {
    this.db.transaction(() => {
      if (this.db.query(`SELECT 1 FROM tasks WHERE ${statusIn(activeStates)} LIMIT 1`).get()) throw new Error('Another task is active. Finish or cancel it first.');
      const task = this.get(id);
      if (!task || !allowed.includes(task.status)) throw new Error('This task cannot start from its current state');
      this.update(id, { status: 'preparing', startedAt: now() });
    }).immediate();
  }

  event(id: string, type: string, text: string, details: Record<string, unknown> = {}): TaskEvent {
    const data = { type, text: String(text).slice(0, 12_000), details, at: now() };
    const result = this.db.query('INSERT INTO events (task_id, data) VALUES (?, ?)').run(id, JSON.stringify(data));
    this.changed();
    return { ...data, id: Number(result.lastInsertRowid) };
  }

  events(id: string, after = 0) {
    return this.db.query<EventRow, [string, number]>(`SELECT id, data FROM events WHERE task_id = ? AND id > ? ORDER BY id LIMIT ${eventPageSize}`).all(id, after).map(toEvent);
  }

  latestEvents(id: string) {
    return this.db.query<EventRow, [string]>(`SELECT id, data FROM events WHERE task_id = ? ORDER BY id DESC LIMIT ${eventPageSize}`).all(id).reverse().map(toEvent);
  }

  hasEventsAfter(id: string, after: number) {
    return Boolean(this.db.query('SELECT 1 FROM events WHERE task_id = ? AND id > ? LIMIT 1').get(id, after));
  }

  *eventLog(id: string) {
    // A fresh statement per download, so two concurrent downloads never share one cursor.
    const statement = this.db.prepare<EventRow, [string]>('SELECT id, data FROM events WHERE task_id = ? ORDER BY id');
    try {
      for (const row of statement.iterate(id)) yield `${JSON.stringify(toEvent(row))}\n`;
    } finally {
      statement.finalize();
    }
  }

  setting<T>(id: string, value?: T): T | null {
    if (value !== undefined) {
      this.db.query('INSERT INTO settings VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(id, JSON.stringify(value));
      this.changed();
    }
    return parse<T>(this.db.query<Row, [string]>('SELECT data FROM settings WHERE id = ?').get(id));
  }

  close() {
    this.db.close();
  }

  private changed() {
    if (this.notifying) return;
    this.notifying = true;
    queueMicrotask(() => {
      this.notifying = false;
      this.emit('change');
    });
  }
}
