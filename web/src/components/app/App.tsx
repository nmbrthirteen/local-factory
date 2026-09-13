import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { commandLine } from '@shared/commands';
import type { Task, TaskLike } from '@shared/types';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import { api } from '@/lib/live';
import { popIn } from '@/lib/motion';
import { askForBanners } from '@/lib/notifications';
import type { PaletteItem } from '@/lib/palette';
import { taskControls, type TaskHandlers } from '@/lib/taskControls';
import { checkSummary, groupTasks, repoName, taskGroup, taskState } from '@/lib/tasks';
import { useFactory } from '@/lib/useFactory';
import CommandPalette from './CommandPalette';
import { useConfirm } from './ConfirmProvider';
import ConnectRepo, { AddRepositoryModal } from './ConnectRepo';
import NewTask from './NewTask';
import Sidebar from './Sidebar';
import StatusIcon from './StatusIcon';
import TaskView from './TaskView';

const deliveryTimeoutMs = 150_000;

function Pending({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-2 text-[13px] text-ink-3 ${className}`}>
      <StatusIcon kind="working" size={14} />
      {children}
    </div>
  );
}

function Toast({ error, notice, onDismiss }: { error: string; notice: string; onDismiss: () => void }) {
  if (!error && !notice) return null;
  return (
    <div id="status" role={error ? 'alert' : 'status'} className={`fixed top-3 left-1/2 z-50 flex w-[min(560px,calc(100vw-24px))] -translate-x-1/2 items-start gap-2 rounded-control bg-surface px-3 py-2 text-[12.5px] shadow-overlay ${error ? 'text-red' : 'text-ink'}`} style={popIn(200)}>
      <StatusIcon kind={error ? 'failed' : 'passed'} size={14} className="mt-0.5" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{error || notice}</span>
      <button type="button" aria-label="Dismiss" onClick={onDismiss} className="primitive-icon-button -my-1 -mr-1.5 size-6 text-ink-3 hover:bg-hover hover:text-ink">
        <Icon name="close" size={12} strokeWidth={2.4} />
      </button>
    </div>
  );
}

export default function App() {
  const factory = useFactory();
  const confirm = useConfirm();
  const { state, detail, selected, select, act, busy, agent } = factory;
  const [creating, setCreating] = useState(false);
  // New task opens on its own while every task is settled, until the owner cancels it.
  const [newWhenSettled, setNewWhenSettled] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [palette, setPalette] = useState(false);
  const [showList, setShowList] = useState(!selected);
  const search = useRef<HTMLInputElement>(null);

  const openNew = () => {
    setCreating(true);
    setShowList(false);
  };
  const open = (id: string) => {
    setCreating(false);
    setShowList(false);
    select(id);
  };

  const focusSearch = () => {
    setShowList(true);
    search.current?.focus();
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && state?.repository) {
      event.preventDefault();
      setPalette(open => !open);
      return;
    }
    if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === '/') {
      event.preventDefault();
      focusSearch();
    } else if (event.key.toLowerCase() === 'n' && state?.repository) {
      event.preventDefault();
      openNew();
    } else if ((event.key === 'j' || event.key === 'k') && state?.tasks.length) {
      const order = groupTasks(state.tasks).flatMap(group => group.tasks.map(task => task.id));
      const index = order.indexOf(selected ?? '');
      const next = order[Math.min(order.length - 1, Math.max(0, index + (event.key === 'j' ? 1 : -1)))];
      if (next) open(next);
    }
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  const toast = <Toast error={factory.error} notice={factory.notice} onDismiss={() => { factory.setError(''); factory.setNotice(''); }} />;

  if (!state) {
    return <>{toast}<Pending className="h-dvh">{factory.connection === 'Connecting' ? 'Connecting to the local service' : factory.connection}</Pending></>;
  }

  const connectRepository = (path: string) => act(() => api('/repository', { path, trusted: true }));

  if (!state.repository) {
    return (
      <>
        {toast}
        <ConnectRepo busy={busy} onConnect={connectRepository} />
      </>
    );
  }

  const repository = state.repository;
  const locked = Boolean(state.active || state.recovery.length || busy || factory.connection !== 'Live');
  const allSettled = state.tasks.every(task => taskGroup(task) === 'done');
  const showNew = creating || (newWhenSettled && !selected && allSettled && !factory.query);

  const openNewIfLastOpen = (task: TaskLike) => {
    if (state.tasks.some(other => other.id !== task.id && taskGroup(other) !== 'done')) return;
    setNewWhenSettled(true);
    setShowList(false);
    select(null);
  };

  const handlersFor = (task: TaskLike): TaskHandlers => {
    const post = <T,>(action: string, body: object = {}, timeoutMs?: number) => api<T>(`/tasks/${task.id}/${action}`, body, timeoutMs);
    return {
      start: () => act(() => post('start')),
      stop: () => act(() => post('cancel')),
      commit: () => act(() => post('commit'), 'Committed to the task branch'),
      uncommit: () => act(() => post('uncommit'), 'Commit undone. The changes are back in the worktree.'),
      retry: feedback => act(() => post('retry', { feedback }), 'Another attempt started'),
      answer: (key, body) => act(() => post('answer', { key, ...body })),
      setAutonomy: autonomy => act(() => post('settings', { autonomy }), 'Permissions updated'),
      settle: settled => {
        act(() => post('settle', { settled }), settled ? 'Settled' : 'Moved back to review').then(ok => {
          if (ok && settled) openNewIfLastOpen(task);
        });
      },
      reveal: () => act(() => post('reveal')),
      syncPullRequest: () => {
        api(`/tasks/${task.id}/pull-request`).then(factory.refresh, () => undefined);
      },
      pullRequest: async () => {
        const approved = await confirm({ title: 'Open a pull request?', message: `This commits "${task.title}", pushes its branch to origin, and opens a pull request with GitHub CLI.`, confirmLabel: 'Open pull request' });
        if (approved) act(() => post<Task>('pull-request', {}, deliveryTimeoutMs), result => `Pull request opened into ${result.pullRequest?.base}`);
      },
      merge: async () => {
        const approved = await confirm({ title: `Merge into ${repoName(task.repo?.path)}?`, message: `This commits "${task.title}", merges it into the repository's current branch, and removes the worktree.`, confirmLabel: 'Merge' });
        if (!approved) return;
        const merged = await act(() => post<Task>('merge', {}, deliveryTimeoutMs), result => `Merged into ${result.merge?.branch}. The files are in ${repoName(result.repo.path)} now.`);
        if (merged) openNewIfLastOpen(task);
      },
      runCommand: async command => {
        const approved = await confirm({ title: command.confirm, command: commandLine(command.argv), confirmLabel: 'Run' });
        if (approved) act(() => post<Task>('command', { command: command.id }, deliveryTimeoutMs), result => checkSummary(result)?.title ?? 'Done');
      },
      runShell: async command => {
        const where = task.worktree && !task.worktreeRemoved ? `the worktree of "${task.title}"` : repoName(task.repo?.path);
        const approved = await confirm({ title: 'Run this command?', message: `It runs in ${where} with your login shell.`, command, confirmLabel: 'Run' });
        if (approved) act(() => post('command-run', { command }), 'Command started');
      },
      stopShell: () => act(() => post('command-stop'), 'Command stopped'),
      preview: () => act(() => post<Task>('preview', {}, deliveryTimeoutMs), result => (result.preview?.status === 'captured' ? 'Screenshots captured' : `Preview failed: ${result.preview?.note}`)),
      startApp: () => act(() => post<Task>('app-start', {}, deliveryTimeoutMs), 'App running'),
      stopApp: () => act(() => post('app-stop'), 'App stopped'),
      rollback: async (target, label) => {
        const approved = await confirm({ title: 'Restore the worktree?', message: `The files in the worktree of "${task.title}" are replaced with ${label}. The task history stays.`, confirmLabel: 'Restore', tone: 'danger' });
        if (approved) act(() => post('rollback', { target }), 'Worktree restored');
      },
      remove: async () => {
        const message = task.commit ? 'The branch keeps your commit.' : 'Its branch is deleted too, along with any uncommitted changes in the worktree.';
        const approved = await confirm({ title: `Remove the worktree of "${task.title}"?`, message, confirmLabel: 'Remove worktree', tone: 'danger' });
        if (approved) act(() => post('remove'), 'Worktree removed');
      },
    };
  };

  const createTask = (body: Record<string, unknown>) => {
    askForBanners();
    act(async () => {
      const task = await api<Task>('/tasks', body);
      setCreating(false);
      factory.setQuery('');
      select(task.id);
    });
  };

  const switchRepository = (path: string) => act(() => api('/repository', { path })).then(ok => {
    if (!ok) return;
    setCreating(false);
    setNewWhenSettled(true);
    setShowList(true);
    select(null);
  });

  const paletteItems: PaletteItem[] = [
    { id: 'new-task', group: 'Actions', label: 'New task', detail: 'N', keywords: 'create start', run: openNew },
    { id: 'search', group: 'Actions', label: 'Search tasks', detail: '/', keywords: 'find filter', run: focusSearch },
    { id: 'add-repository', group: 'Actions', label: 'Add repository', keywords: 'connect folder project', run: () => setConnecting(true) },
    ...(detail
      ? Object.entries(taskControls(detail.task, locked, busy, handlersFor(detail.task)))
          .filter(([, control]) => control && !control.disabled)
          .map(([id, control]) => ({ id: `control-${id}`, group: 'This task', label: control.label, detail: detail.task.title, run: control.run }))
      : []),
    ...state.tasks.map(task => ({ id: `task-${task.id}`, group: 'Tasks', label: task.title, detail: taskState(task).label, run: () => open(task.id) })),
    ...state.repositories
      .filter(repo => repo.path !== repository.path)
      .map(repo => ({ id: `repository-${repo.path}`, group: 'Repositories', label: `Switch to ${repoName(repo.path)}`, detail: repo.path, run: () => switchRepository(repo.path) })),
  ];

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
      {toast}
      <CommandPalette open={palette} items={paletteItems} onClose={() => setPalette(false)} />
      <AddRepositoryModal open={connecting} busy={busy} onClose={() => setConnecting(false)} onConnect={path => connectRepository(path).then(ok => ok && setConnecting(false))} />
      <div className={`flex h-full max-md:w-full ${showList ? '' : 'max-md:hidden'}`}>
        <Sidebar
          ref={search}
          repository={repository}
          repositories={state.repositories}
          tasks={state.tasks}
          hasMore={Boolean(state.page?.next)}
          selected={selected}
          creating={showNew}
          connection={factory.connection}
          query={factory.query}
          locked={locked}
          busy={busy}
          onQuery={factory.setQuery}
          onSelect={open}
          onNew={openNew}
          onSwitchRepository={switchRepository}
          onAddRepository={() => setConnecting(true)}
          handlersFor={handlersFor}
        />
      </div>
      <main className={`my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-window bg-surface shadow-card max-md:m-0 max-md:rounded-none ${showList ? 'max-md:hidden' : ''}`}>
        {state.recovery.length > 0 && (
          <div id="recovery" className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line bg-orange-tint px-4 py-2.5 text-[12.5px] text-ink">
            <StatusIcon kind="attention" size={14} />
            <span className="min-w-0 flex-1">A run was interrupted. Stop leftover agent processes, then acknowledge.</span>
            <Button id="recover" size="sm" variant="secondary" disabled={busy} onClick={() => act(() => api('/recover', {}))}>Acknowledge</Button>
          </div>
        )}
        {showNew ? (
          <NewTask
            agent={agent}
            busy={busy}
            repository={repository}
            repositories={state.repositories}
            onAgent={factory.chooseAgent}
            onReprobe={factory.reprobe}
            onCancel={() => {
              setCreating(false);
              setNewWhenSettled(false);
              if (!selected) setShowList(true);
            }}
            onCreate={createTask}
          />
        ) : detail ? (
          <TaskView key={detail.task.id} task={detail.task} events={detail.events} locked={locked} busy={busy} handlersFor={handlersFor} onBack={() => setShowList(true)} />
        ) : selected ? (
          <Pending className="flex-1">Loading task</Pending>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">What needs doing?</h1>
            <p className="max-w-[340px] text-[13px] leading-normal text-ink-2">Describe a change. An agent builds it in its own worktree and runs a check before you review it.</p>
            <Button variant="primary" size="sm" onClick={openNew}>New task <kbd>N</kbd></Button>
          </div>
        )}
      </main>
    </div>
  );
}
