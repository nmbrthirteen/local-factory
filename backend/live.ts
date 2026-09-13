import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isActive } from '../shared/domain';
import { resolvePreview, startApp, type App } from './preview';
import type { Store } from './store';

const now = () => new Date().toISOString();

type Options = { root: string; servicePort?: number };
type Current = { id: string; app: App; stopping: boolean };

// One app runs for review at a time, because many dev servers ask for the same fixed port.
export class LiveApps {
  private readonly store: Store;
  private readonly isRunning: (id: string) => boolean;
  private readonly root: string;
  private readonly blockedPorts: number[];
  private current: Current | null = null;

  constructor(store: Store, isRunning: (id: string) => boolean, { root, servicePort }: Options) {
    this.store = store;
    this.isRunning = isRunning;
    this.root = root;
    this.blockedPorts = servicePort ? [servicePort] : [];
    for (const task of store.list()) {
      if (task.liveApp) store.update(task.id, { liveApp: null });
    }
  }

  async start(id: string) {
    const task = this.store.require(id);
    if (this.isRunning(id) || isActive(task.status)) throw new Error('Wait for the run to finish');
    if (!task.worktree || task.worktreeRemoved) throw new Error('This task has no worktree');
    if (this.current?.id === id) return task;
    const { command } = await resolvePreview(task.worktree.path, '', task.preview);
    if (!command.length) throw new Error('No start command. Add a dev, start, or preview script.');
    await this.stopCurrent();
    const scratch = join(this.root, '.factory/sandbox', `live-${id}`);
    const app = await startApp(command, task.worktree.path, scratch, this.blockedPorts).catch((error: Error) => {
      throw new Error(`App did not start: ${error.message}`);
    });
    const current: Current = { id, app, stopping: false };
    this.current = current;
    void app.exited.then(async code => {
      if (this.current === current) this.current = null;
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
      if (!this.store.get(id)) return;
      this.store.update(id, { liveApp: null });
      this.store.event(id, 'app_stopped', current.stopping ? 'App stopped' : `App exited: ${code}`, { output: app.log() });
    });
    this.store.event(id, 'app_started', 'App running', { url: app.url, command });
    return this.store.update(id, { liveApp: { url: app.url, command, startedAt: now() } });
  }

  async stop(id: string) {
    if (this.current?.id !== id) throw new Error('The app is not running');
    await this.stopCurrent();
    return this.store.require(id);
  }

  async release(id: string) {
    if (this.current?.id === id) await this.stopCurrent();
  }

  stopAll() {
    return this.stopCurrent();
  }

  private async stopCurrent() {
    const current = this.current;
    if (!current) return;
    current.stopping = true;
    this.current = null;
    current.app.stop();
    await current.app.exited;
    await Bun.sleep(0);
  }
}
