import { useEffect, useEffectEvent, useState, type KeyboardEvent } from 'react';
import type { ProgressUpdate, Task, TaskEvent, TaskLike } from '@shared/types';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import { taskControls, type Control, type TaskHandlers } from '@/lib/taskControls';
import { agentName, autonomyModes, repoName, taskState } from '@/lib/tasks';
import { useStoredState } from '@/lib/useStoredState';
import Activity from './Activity';
import Changes from './Changes';
import CheckStrip from './CheckStrip';
import Details from './Details';
import Menu from './Menu';
import Preview from './Preview';
import StatusIcon from './StatusIcon';
import TaskMenu from './TaskMenu';

const views = [['activity', 'Activity'], ['changes', 'Changes'], ['preview', 'Preview'], ['details', 'Details']] as const;
const verbosities = [['summary', 'Summary'], ['all', 'Everything']] as const;
type View = (typeof views)[number][0];

const segment = (active: boolean) => `rounded-[6px] px-2 py-[3px] text-ink transition-[background-color,opacity] duration-100 ${active ? 'bg-field' : 'opacity-50 hover:opacity-75'}`;

function HeaderButton({ control, variant }: { control?: Control; variant: 'primary' | 'secondary' }) {
  if (!control) return null;
  return <Button id={control.elementId} variant={variant} size="sm" disabled={control.disabled} onClick={control.run} title={control.hint}>{control.label}</Button>;
}

type TaskViewProps = { task: Task; events: TaskEvent[]; progress?: ProgressUpdate; locked: boolean; busy: boolean; handlersFor: (task: TaskLike) => TaskHandlers; onBack: () => void };

export default function TaskView({ task, events, progress, locked, busy, handlersFor, onBack }: TaskViewProps) {
  const handlers = handlersFor(task);
  const [view, setView] = useState<View>('activity');
  const [verbosity, setVerbosity] = useStoredState('factory-activity', 'summary');
  const state = taskState(task);
  const controls = taskControls(task, locked, busy, handlers);
  const meta = [repoName(task.repo?.path), agentName(task.harness), task.model, (task.attempt ?? 1) > 1 ? `Attempt ${task.attempt}` : ''].filter(Boolean);
  const liveUrl = task.liveApp?.url;
  const checkFailedError =task.error?.startsWith('Project check failed') && task.checkResult?.exitCode;

  const syncOpenPullRequest = useEffectEvent(() => {
    if (task.pullRequest?.state === 'OPEN') handlers.syncPullRequest();
  });
  useEffect(() => syncOpenPullRequest(), [task.id]);

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = { ArrowRight: (index + 1) % views.length, ArrowLeft: (index + views.length - 1) % views.length }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setView(views[next][0]);
    document.getElementById(`tab-${views[next][0]}`)?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-3 border-b border-line px-6 pt-4 pb-0 max-md:px-4">
        <button type="button" id="back-tasks" onClick={onBack} className="-ml-1 hidden w-fit items-center gap-1 rounded-[6px] px-1 text-[12.5px] text-ink-2 max-md:flex">
          <Icon name="chevronLeft" strokeWidth={2.2} />
          Tasks
        </button>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 id="task-heading" tabIndex={-1} className="text-[17px] leading-snug font-semibold tracking-[-0.02em] text-ink outline-none [overflow-wrap:anywhere]">{task.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-2">
              <span id="task-state" role="status" className="inline-flex items-center gap-1.5 font-medium text-ink"><StatusIcon kind={state.kind} size={14} />{state.label}</span>
              {meta.map(item => <span key={item} className="before:mr-2 before:text-ink-3 before:content-['·']">{item}</span>)}
              {task.worktree?.branch && <span className="inline-flex h-5 items-center rounded-chip bg-field px-1.5 font-mono text-[11px] text-ink-2 shadow-hairline">{task.worktree.branch}</span>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5" data-key="actions">
            {!task.commit && !task.worktreeRemoved && <Menu label="Permissions" align="right" value={task.autonomy ?? 'ask'} options={autonomyModes} onChange={handlers.setAutonomy} disabled={busy} />}
            <HeaderButton control={controls.stop} variant="secondary" />
            <HeaderButton control={controls.uncommit} variant="secondary" />
            <HeaderButton control={controls.start} variant="primary" />
            {liveUrl && <Button id="open-app" variant="secondary" size="sm" onClick={() => window.open(liveUrl, '_blank', 'noopener')}>Open app</Button>}
            <HeaderButton control={controls.pullRequest ?? controls.merge} variant="primary" />
            <TaskMenu taskId={task.id} title={task.title} task={task} locked={locked} busy={busy} handlersFor={handlersFor} className="relative" buttonClassName="text-ink-2 hover:bg-hover hover:text-ink aria-expanded:bg-hover aria-expanded:text-ink" />
          </div>
        </div>
        {task.error && !checkFailedError && <p role="alert" className="rounded-control bg-red-tint px-3 py-2 text-[12.5px] text-red [overflow-wrap:anywhere]">{task.error}</p>}
        <CheckStrip task={task} busy={busy} onReveal={handlers.reveal} onRunCommand={handlers.runCommand} />
        <div className="flex items-center justify-between gap-3 pb-2">
          <div role="tablist" aria-label="Task view" className="flex items-center">
            {views.map(([id, label], index) => (
              <button
                key={id}
                type="button"
                id={`tab-${id}`}
                role="tab"
                aria-selected={view === id}
                aria-controls={`panel-${id}`}
                tabIndex={view === id ? 0 : -1}
                onClick={() => setView(id)}
                onKeyDown={event => moveTab(event, index)}
                className={`flex items-center gap-1.5 text-[13px] ${segment(view === id)}`}
              >
                {label}
                {id === 'changes' && task.patch && <span role="img" className="size-1.5 rounded-full bg-accent" aria-label="Changes available" />}
                {id === 'preview' && task.preview && <span role="img" className={`size-1.5 rounded-full ${task.preview.status === 'failed' ? 'bg-red' : task.preview.errors.length ? 'bg-orange' : 'bg-accent'}`} aria-label="Screenshots available" />}
              </button>
            ))}
          </div>
          {view === 'activity' && (
            <fieldset aria-label="Activity detail" className="m-0 flex min-w-0 items-center border-0 p-0">
              {verbosities.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={verbosity === value} onClick={() => setVerbosity(value)} className={`text-[12px] ${segment(verbosity === value)}`}>
                  {label}
                </button>
              ))}
            </fieldset>
          )}
        </div>
      </header>
      {view === 'activity' && <Activity key={task.id} task={task} events={events} progress={progress} verbosity={verbosity} locked={locked} busy={busy} onAnswer={handlers.answer} onRetry={handlers.retry} onRunShell={handlers.runShell} onStopShell={handlers.stopShell} />}
      {view === 'changes' && <Changes task={task} />}
      {view === 'preview' && <Preview task={task} busy={busy} locked={locked} onRetake={handlers.preview} onStartApp={handlers.startApp} onStopApp={handlers.stopApp} />}
      {view === 'details' && <Details task={task} busy={busy} locked={locked} onRollback={handlers.rollback} onRemove={handlers.remove} />}
    </div>
  );
}
