import { spawn } from 'node:child_process';
import type { OwnerCommand } from '../shared/commands';
import { isActive } from '../shared/domain';
import type { Task } from '../shared/types';
import { pathExists } from './git';
import { safeEnv, stopProcessGroup } from './process';
import type { Store } from './store';

const outputLimit = 64_000;
const eventOutputLimit = 12_000;
const flushMs = 400;
const localUrl = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+[^\s'"`<>)]*/;

const now = () => new Date().toISOString();

type Session = { stopped: boolean; stop: () => void; closed: Promise<void> };

export class Terminal {
  private readonly store: Store;
  private readonly isRunning: (id: string) => boolean;
  private readonly sessions = new Map<string, Session>();

  constructor(store: Store, isRunning: (id: string) => boolean) {
    this.store = store;
    this.isRunning = isRunning;
    for (const task of store.list()) {
      if (task.ownerCommand?.status === 'running') store.update(task.id, { ownerCommand: { ...task.ownerCommand, status: 'stopped', endedAt: now() } });
    }
  }

  async start(id: string, command: unknown) {
    if (typeof command !== 'string' || !command.trim() || command.length > 4000) throw new Error('Choose a command to run');
    const task = this.store.require(id);
    if (this.isRunning(id) || isActive(task.status)) throw new Error('Wait for the agent run to finish before running commands');
    if (this.sessions.has(id)) throw new Error('A command is already running for this task. Stop it first.');

    const cwd = await this.directoryFor(task);
    const child = spawn('/bin/zsh', ['-lc', command], { cwd, env: { ...safeEnv(), TERM: 'dumb' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const run: OwnerCommand = { command, cwd, status: 'running', exitCode: null, output: '', url: null, startedAt: now() };
    const closed = Promise.withResolvers<void>();
    const session: Session = { stopped: false, stop: () => stopProcessGroup(child), closed: closed.promise };
    this.sessions.set(id, session);

    let changed = false;
    const flush = () => {
      if (!changed) return;
      changed = false;
      this.store.update(id, { ownerCommand: { ...run } });
    };
    const timer = setInterval(flush, flushMs);
    const collect = (chunk: Buffer | string) => {
      run.output = (run.output + chunk).slice(-outputLimit);
      run.url ??= run.output.match(localUrl)?.[0] ?? null;
      changed = true;
    };

    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', error => collect(`${error.message}\n`));
    child.once('close', code => {
      clearInterval(timer);
      this.sessions.delete(id);
      Object.assign(run, { status: session.stopped ? 'stopped' : 'exited', exitCode: code, endedAt: now() });
      this.store.update(id, { ownerCommand: { ...run } });
      const summary = session.stopped ? `Stopped ${command}` : `${command} exited with ${code}`;
      this.store.event(id, 'owner_command', summary, { command, cwd, exitCode: code, output: run.output.slice(-eventOutputLimit) });
      closed.resolve();
    });

    this.store.event(id, 'owner_command_started', command, { cwd });
    return this.store.update(id, { ownerCommand: { ...run } });
  }

  stop(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error('No command is running for this task');
    session.stopped = true;
    session.stop();
    return this.store.require(id);
  }

  async stopAll() {
    const closing = [...this.sessions].map(([id, session]) => {
      this.stop(id);
      return session.closed;
    });
    await Promise.all(closing);
  }

  private async directoryFor(task: Task) {
    if (task.worktree && !task.worktreeRemoved && (await pathExists(task.worktree.path))) return task.worktree.path;
    if (await pathExists(task.repo.path)) return task.repo.path;
    throw new Error('Neither the worktree nor the repository folder exists anymore');
  }
}
