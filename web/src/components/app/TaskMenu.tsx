import { useEffect, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Task, TaskLike } from '@shared/types';
import { Icon } from '@/components/atoms/Icon';
import GlideMenu from '@/components/primitives/GlideMenu';
import { api } from '@/lib/live';
import { popIn } from '@/lib/motion';
import { taskControls, type Control, type TaskHandlers } from '@/lib/taskControls';
import { autonomyModes, rollbackTargets, taskActions } from '@/lib/tasks';
import { usePopover } from '@/lib/usePopover';
import { MenuCheck, MenuDivider, MenuLabel, menuHighlight, menuItem } from './Menu';
import StatusIcon from './StatusIcon';

const panelWidth = 264;
const panelHeight = 340;

type ItemsProps = { task: TaskLike; locked: boolean; busy: boolean; handlers: TaskHandlers; full: boolean; onOpen?: () => void; close: () => void };

function Items({ task, locked, busy, handlers, full, onOpen, close }: ItemsProps) {
  const actions = taskActions(task, locked);
  const controls = taskControls(task, locked, busy, handlers);
  const run = (action: () => void) => () => {
    close();
    action();
  };
  const item = (key: string, control?: Control) => control && (
    <button key={key} type="button" role="menuitem" data-menu-row disabled={control.disabled} onClick={run(control.run)} className={menuItem}>{control.label}</button>
  );

  const runItems = full
    ? [
      onOpen && <button key="open" type="button" role="menuitem" data-menu-row onClick={run(onOpen)} className={menuItem}>Open</button>,
      item('start', controls.start),
      item('stop', controls.stop),
      item('pull-request', controls.pullRequest),
      item('merge', controls.merge),
    ].filter(Boolean)
    : [];
  const branchItems = [!full && controls.pullRequest && item('merge-local', controls.merge), item('commit', controls.commit), item('uncommit', controls.uncommit)].filter(Boolean);
  const settleItem = item('settle', controls.settle ?? controls.unsettle);
  const autonomy = task.autonomy ?? 'ask';
  const worktree = Boolean(task.worktree) && !task.worktreeRemoved;
  const restorable = actions.rollback ? rollbackTargets(task).filter(target => !target.current) : [];

  return (
    <GlideMenu className="flex flex-col" highlightClassName={menuHighlight}>
      {runItems}
      {branchItems}
      {settleItem}
      {(runItems.length > 0 || branchItems.length > 0 || settleItem) && <MenuDivider />}
      {full && !task.commit && !task.worktreeRemoved && (
        <>
          <MenuLabel>Permissions</MenuLabel>
          {autonomyModes.map(mode => (
            <button key={mode.value} type="button" role="menuitemradio" aria-checked={autonomy === mode.value} data-menu-row disabled={busy} onClick={run(() => handlers.setAutonomy(mode.value))} className={menuItem}>
              {mode.name}
              <span className="ml-auto" />
              <MenuCheck on={autonomy === mode.value} />
            </button>
          ))}
          <MenuDivider />
        </>
      )}
      {actions.rollback && <MenuLabel>Roll back the worktree to</MenuLabel>}
      {restorable.map(target => (
        <button key={target.key} type="button" role="menuitem" data-menu-row data-restore={target.target} disabled={busy} onClick={run(() => handlers.rollback(target.target, target.description))} className={menuItem}>
          <StatusIcon kind={target.kind} size={14} />
          {target.title}
          <span className="ml-auto text-[11.5px] font-normal text-ink-3">{target.result}</span>
        </button>
      ))}
      {task.commit && worktree && <p className="px-2 py-1.5 text-[12px] text-ink-3">Undo the commit to roll back.</p>}
      {(actions.rollback || (task.commit && worktree)) && <MenuDivider />}
      {worktree && <button type="button" role="menuitem" data-menu-row onClick={run(handlers.reveal)} className={menuItem}>Show files in Finder</button>}
      <a role="menuitem" data-menu-row href={`/api/tasks/${task.id}/activity`} download onClick={close} className={menuItem}>Download activity</a>
      {actions.remove && <button type="button" role="menuitem" data-menu-row disabled={busy} onClick={run(handlers.remove)} className={`${menuItem} text-red`}>Remove worktree</button>}
    </GlideMenu>
  );
}

type TaskMenuProps = {
  taskId: string;
  title: string;
  task?: Task;
  locked: boolean;
  busy: boolean;
  handlersFor: (task: TaskLike) => TaskHandlers;
  full?: boolean;
  onOpen?: () => void;
  className?: string;
  buttonClassName?: string;
};

export default function TaskMenu({ taskId, title, task: known, locked, busy, handlersFor, full = false, onOpen, className = '', buttonClassName = '' }: TaskMenuProps) {
  const { open, setOpen, ref, panel } = usePopover();
  const [loaded, setLoaded] = useState<Task | null>(null);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; right: number }>({ right: 0 });
  const task = known ?? (loaded?.id === taskId ? loaded : null);

  useEffect(() => {
    if (!open || known) return;
    let current = true;
    api<{ task: Task }>(`/tasks/${taskId}?events=0`)
      .then(result => current && setLoaded(result.task))
      .catch(() => current && setOpen(false));
    return () => {
      current = false;
    };
  }, [open, known, taskId, setOpen]);

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const right = Math.max(8, Math.min(innerWidth - rect.right, innerWidth - panelWidth));
    setPosition(rect.bottom + panelHeight < innerHeight ? { top: rect.bottom + 6, right } : { bottom: innerHeight - rect.top + 6, right });
    setOpen(state => !state);
  };

  return (
    <div ref={ref} className={className}>
      <button type="button" aria-label={`Actions for ${title}`} aria-haspopup="menu" aria-expanded={open} onClick={toggle} className={`primitive-icon-button transition-colors duration-150 ${buttonClassName}`}>
        <Icon name="more" size={16} />
      </button>
      {open && createPortal(
        <div ref={panel} role="menu" aria-label={`Actions for ${title}`} className="scroll-thin fixed z-50 max-h-[70vh] w-64 overflow-y-auto rounded-[10px] bg-surface p-1 shadow-raised" style={{ ...position, ...popIn(180, position.top === undefined ? 'bottom right' : 'top right') }}>
          {task
            ? <Items task={task} locked={locked} busy={busy} handlers={handlersFor(task)} full={full} onOpen={onOpen} close={() => setOpen(false)} />
            : <p role="status" className="flex h-8 items-center gap-2 px-2 text-[12.5px] text-ink-3"><StatusIcon kind="working" size={12} />Loading</p>}
        </div>,
        document.body,
      )}
    </div>
  );
}
