import type { DeliveryCommand } from '@shared/commands';
import type { Autonomy } from '@shared/domain';
import type { TaskLike } from '@shared/types';
import { taskActions } from './tasks';

export type TaskHandlers = {
  start: () => void;
  stop: () => void;
  commit: () => void;
  uncommit: () => void;
  retry: (feedback: string) => void;
  answer: (key: string, body: Record<string, unknown>) => void;
  setAutonomy: (autonomy: Autonomy) => void;
  settle: (settled: boolean) => void;
  reveal: () => void;
  merge: () => void;
  pullRequest: () => void;
  syncPullRequest: () => void;
  runCommand: (command: DeliveryCommand) => void;
  runShell: (command: string) => void;
  stopShell: () => void;
  preview: () => void;
  startApp: () => void;
  stopApp: () => void;
  rollback: (target: string, label: string) => void;
  remove: () => void;
};

type ControlId = 'start' | 'stop' | 'pullRequest' | 'merge' | 'commit' | 'uncommit' | 'settle' | 'unsettle';
export type Control = { label: string; disabled: boolean; run: () => void; elementId?: string; hint?: string };

export function taskControls(task: TaskLike, locked: boolean, busy: boolean, handlers: TaskHandlers) {
  const actions = taskActions(task, locked);
  const controls: Partial<Record<ControlId, Control>> = {};
  if (task.status === 'queued') controls.start = { label: 'Start run', elementId: 'start', disabled: busy || !actions.start, run: handlers.start };
  if (actions.stop) controls.stop = { label: 'Stop', elementId: 'cancel', disabled: busy || task.status === 'canceling', run: handlers.stop };
  if (actions.pullRequest) controls.pullRequest = { label: 'Open pull request', elementId: 'pull-request', disabled: busy, run: handlers.pullRequest, hint: 'Commit the work, push the task branch, and open a pull request with GitHub CLI' };
  if (actions.merge) controls.merge = { label: actions.pullRequest ? 'Merge locally' : 'Merge', elementId: 'merge', disabled: busy, run: handlers.merge, hint: "Commit the work, merge it into the repository's current branch, and remove the worktree" };
  if (actions.commit) controls.commit = { label: 'Commit to branch only', disabled: busy, run: handlers.commit };
  if (actions.uncommit) controls.uncommit = { label: 'Undo commit', elementId: 'uncommit', disabled: busy, run: handlers.uncommit };
  if (actions.settle) controls.settle = { label: 'Settle', disabled: busy, run: () => handlers.settle(true) };
  else if (actions.unsettle) controls.unsettle = { label: 'Move back to review', disabled: busy, run: () => handlers.settle(false) };
  return controls;
}
