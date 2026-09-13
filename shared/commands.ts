import type { TaskLike } from './types';

export type DeliveryCommand = {
  id: 'revert' | 'merge-pull-request' | 'close-pull-request';
  label: string;
  argv: string[];
  confirm: string;
};

export type OwnerCommand = {
  command: string;
  cwd: string;
  status: 'running' | 'exited' | 'stopped';
  exitCode: number | null;
  output: string;
  url: string | null;
  startedAt: string;
  endedAt?: string;
};

export const parseCommand =(text = '') =>
  [...text.trim().matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(([, double, single, bare]) => double ?? single ?? bare ?? '');

export const commandLine = (argv: string[]) =>
  argv.map(arg => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`)).join(' ');

export function deliveryCommands(task: TaskLike): DeliveryCommand[] {
  if (task.merge && !task.revert) {
    const { sha, branch } = task.merge;
    return [{
      id: 'revert',
      label: 'To undo',
      argv: ['git', 'revert', '-m', '1', '--no-edit', sha],
      confirm: `Revert the merge of "${task.title}" on ${branch}? A new commit undoes its changes.`,
    }];
  }
  if (task.pullRequest?.state === 'OPEN') {
    const { url, base } = task.pullRequest;
    return [
      { id: 'merge-pull-request', label: 'Merge on GitHub', argv: ['gh', 'pr', 'merge', url, '--merge'], confirm: `Merge the pull request for "${task.title}" into ${base} on GitHub?` },
      { id: 'close-pull-request', label: 'Close without merging', argv: ['gh', 'pr', 'close', url], confirm: `Close the pull request for "${task.title}" without merging it?` },
    ];
  }
  return [];
}
