import { useState, type ReactNode, type Ref } from 'react';
import type { Repository, TaskLike, TaskSummary } from '@shared/types';
import { Collapse } from '@/components/atoms/Collapse';
import { Icon } from '@/components/atoms/Icon';
import GlideMenu from '@/components/primitives/GlideMenu';
import { fadeUp } from '@/lib/motion';
import type { TaskHandlers } from '@/lib/taskControls';
import { agentName, ago, groupTasks, taskState, type GroupId } from '@/lib/tasks';
import { useStoredState } from '@/lib/useStoredState';
import RepositoryMenu from './RepositoryMenu';
import StatusIcon from './StatusIcon';
import TaskMenu from './TaskMenu';
import { useTaskPeek, type PeekBind } from './TaskPeek';

const previewCount = 8;
const liveGroups: GroupId[] = ['attention', 'working'];
const reveal = 'absolute z-20 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100';
const hideOnReveal = 'transition-opacity duration-150 group-hover/row:opacity-0 group-focus-within/row:opacity-0 group-has-[[aria-expanded=true]]/row:opacity-0 [@media(hover:none)]:opacity-0';

type RowMenu = (task: TaskSummary, className: string) => ReactNode;

function LiveCard({ task, current, onSelect, menu, peek }: { task: TaskSummary; current: boolean; onSelect: (id: string) => void; menu: RowMenu; peek: PeekBind }) {
  const state = taskState(task);
  return (
    <div className="group/row relative mx-2" style={fadeUp(300)} {...peek(task)}>
      <button
        type="button"
        data-task={task.id}
        aria-current={current ? 'page' : undefined}
        onClick={() => onSelect(task.id)}
        className={`flex w-full flex-col gap-1.5 rounded-[12px] px-3 py-2.5 text-left transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.99] ${current ? 'bg-line-strong' : 'bg-hover hover:bg-hover-2'}`}
      >
        <span className="flex items-center gap-1.5 text-[12px]">
          <StatusIcon kind={state.kind} size={14} />
          <span className="truncate text-ink-3">{agentName(task.harness)}</span>
          <span className={`ml-auto shrink-0 font-medium ${hideOnReveal} ${state.kind === 'attention' ? 'text-orange' : 'text-accent-ink'}`}>{state.label}</span>
        </span>
        <span className="line-clamp-2 text-[14px] leading-snug font-medium text-ink [overflow-wrap:anywhere]">{task.title}</span>
      </button>
      {menu(task, `${reveal} top-1 right-1.5`)}
    </div>
  );
}

type SectionProps = { id: GroupId; label: string; tasks: TaskSummary[]; selected: string | null; now: number; onSelect: (id: string) => void; menu: RowMenu; peek: PeekBind };

function Section({ id, label, tasks, selected, now, onSelect, menu, peek }: SectionProps) {
  const [stored, store] = useStoredState(`factory-group-${id}`, 'open');
  const [expanded, setExpanded] = useState(false);
  const open = stored !== 'closed';
  const visible = expanded ? tasks : tasks.slice(0, previewCount);
  const settled = id === 'done';

  return (
    <section className="mt-3" aria-label={label}>
      <button type="button" aria-expanded={open} onClick={() => store(open ? 'closed' : 'open')} className="mx-2 flex h-8 w-[calc(100%-16px)] items-center gap-3 rounded-[8px] px-3 text-[12.5px] font-medium text-ink-3 transition-colors duration-100 hover:text-ink-2">
        {label}
        <span aria-hidden className="h-px flex-1 bg-line" />
        <Icon name="chevronUp" strokeWidth={2.2} className="shrink-0 transition-transform duration-200" style={{ transform: open ? 'rotate(0deg)' : 'rotate(180deg)' }} />
      </button>
      <Collapse open={open}>
        <GlideMenu rowSelector="[data-row]" highlightClassName="inset-x-2 rounded-[8px] bg-hover" className="flex flex-col gap-px pt-0.5">
          {visible.map(task => {
            const state = taskState(task);
            const current = task.id === selected;
            const faded = settled && !current && (task.committed || task.worktreeRemoved || state.kind !== 'passed');
            return (
              <div key={task.id} data-row className="group/row relative mx-2" {...peek(task)}>
                <button
                  type="button"
                  data-task={task.id}
                  aria-current={current ? 'page' : undefined}
                  aria-label={`${task.title}, ${state.label}, ${agentName(task.harness)}`}
                  onClick={() => onSelect(task.id)}
                  className={`relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left transition-transform duration-150 active:scale-[0.99] ${current ? 'bg-hover-2' : ''}`}
                >
                  <StatusIcon kind={state.kind} size={15} className={faded ? 'opacity-60 grayscale' : ''} />
                  <span className={`min-w-0 flex-1 truncate text-[13.5px] ${current ? 'font-medium text-ink' : 'text-ink-2'}`}>{task.title}</span>
                  <time dateTime={task.createdAt} className={`shrink-0 text-[12px] tabular-nums text-ink-3 ${hideOnReveal}`}>{ago(task.createdAt, now, true)}</time>
                </button>
                {menu(task, `${reveal} top-1/2 right-1 -translate-y-1/2`)}
              </div>
            );
          })}
        </GlideMenu>
        {tasks.length > visible.length && (
          <button type="button" onClick={() => setExpanded(true)} className="mx-2 flex h-9 w-[calc(100%-16px)] items-center gap-2.5 rounded-[8px] px-2.5 text-[13px] text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink-2">
            <Icon name="plus" size={15} />
            Show {tasks.length - visible.length} more
          </button>
        )}
      </Collapse>
    </section>
  );
}

type SidebarProps = {
  ref?: Ref<HTMLInputElement>;
  repository: Repository;
  repositories: Repository[];
  tasks: TaskSummary[];
  hasMore: boolean;
  selected: string | null;
  creating: boolean;
  connection: string;
  query: string;
  locked: boolean;
  busy: boolean;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSwitchRepository: (path: string) => void;
  onAddRepository: () => void;
  handlersFor: (task: TaskLike) => TaskHandlers;
};

export default function Sidebar({ ref, repository, repositories, tasks, hasMore, selected, creating, connection, query, locked, busy, onQuery, onSelect, onNew, onSwitchRepository, onAddRepository, handlersFor }: SidebarProps) {
  const menu: RowMenu = (task, className) => (
    <TaskMenu taskId={task.id} title={task.title} locked={locked} busy={busy} handlersFor={handlersFor} full onOpen={() => onSelect(task.id)} className={className} buttonClassName="size-7 text-ink-3 hover:bg-line-strong hover:text-ink aria-expanded:bg-line-strong aria-expanded:text-ink" />
  );
  const peek = useTaskPeek();
  const live = connection === 'Live';
  const now = Date.now();
  const groups = groupTasks(tasks);
  const current = creating ? null : selected;

  return (
    <aside aria-label="Tasks" className="flex h-full w-[284px] shrink-0 flex-col py-2.5 max-md:w-full">
      <div className="flex h-10 shrink-0 items-center gap-1 px-2">
        <RepositoryMenu repository={repository} repositories={repositories} onSwitch={onSwitchRepository} onAdd={onAddRepository} />
        <span id="connection" role="status" title={live ? 'Receiving live updates' : connection} className="flex shrink-0 items-center gap-1.5 px-1.5 text-[11.5px] text-ink-3">
          <span className={`size-1.5 rounded-full ${live ? 'bg-green' : 'bg-orange'}`} />
          {connection}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 px-2 pt-1.5 pb-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-field px-2.5 text-ink-3 shadow-hairline transition-[color,box-shadow] duration-150 focus-within:text-ink-2 focus-within:shadow-[0_0_0_1px_var(--line-strong)]">
          <Icon name="search" size={15} />
          <input ref={ref} id="task-search" type="search" value={query} onChange={event => onQuery(event.target.value)} placeholder="Search tasks" aria-label="Search tasks" maxLength={200} autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-3" />
          <kbd>/</kbd>
        </label>
        <button
          type="button"
          id="new-task"
          onClick={onNew}
          aria-pressed={creating}
          title="New task (N)"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-ink pr-3 pl-2.5 text-[13px] font-medium text-canvas shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.96]"
        >
          <Icon name="plus" strokeWidth={2.4} />
          New
        </button>
      </div>

      <nav id="task-list" aria-label="Task list" className="scroll-thin min-h-0 flex-1 overflow-y-auto pt-px pb-3">
        {!tasks.length && <p className="px-5 py-3 text-[13px] text-ink-3">{query ? 'No matching tasks' : 'No tasks yet. Press N to create one.'}</p>}
        <div className="flex flex-col gap-1.5">
          {groups.filter(group => liveGroups.includes(group.id)).flatMap(group => group.tasks).map(task => (
            <LiveCard key={task.id} task={task} current={task.id === current} onSelect={onSelect} menu={menu} peek={peek.bind} />
          ))}
        </div>
        {groups.filter(group => !liveGroups.includes(group.id)).map(group => (
          <Section key={group.id} id={group.id} label={group.label} tasks={group.tasks} selected={current} now={now} onSelect={onSelect} menu={menu} peek={peek.bind} />
        ))}
        {hasMore && <p className="px-5 pt-3 text-[12px] text-ink-3">Showing the latest 50. Search to find older tasks.</p>}
      </nav>
      {peek.card}
    </aside>
  );
}
