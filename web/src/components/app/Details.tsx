import type { ReactNode } from 'react';
import type { Task } from '@shared/types';
import { Button, buttonVariants } from '@/components/atoms/Button';
import { agentName, rollbackTargets, taskActions } from '@/lib/tasks';
import Markdown from './Markdown';
import StatusIcon from './StatusIcon';

type Row = { term: string; value: string; mono?: boolean };

const Heading = ({ children }: { children: ReactNode }) => <h2 className="mb-2 text-[12.5px] font-medium text-ink-3">{children}</h2>;

function runRows(task: Task): Row[] {
  const { usage, setupResult, worktree, instructionFiles = [] } = task;
  const usageText = usage && (usage.costUsd ? `$${usage.costUsd.toFixed(4)} estimated, ${usage.turns} model turns` : `${usage.turns} model turns, no cost reported`);
  const setup = task.setup.length ? task.setup.join(' ') : setupResult ? `${setupResult.command.join(' ')} (from the lockfile)` : '';
  const check = task.check.length ? task.check.join(' ') : task.resolvedCheck ? task.resolvedCheck.join(' ') : task.unchecked ? 'None ran' : 'The agent picks one';
  const rows: (Row | false | undefined | '')[] = [
    task.repo?.path && { term: 'Repository', value: task.repo.path, mono: true },
    { term: 'Agent', value: `${agentName(task.harness)} · ${task.model}` },
    instructionFiles.length > 0 && { term: 'Instructions', value: instructionFiles.map(file => file.label).join(', ') },
    task.autonomy && task.autonomy !== 'ask' && { term: 'Decisions', value: task.autonomy === 'full' ? 'On its own, full access' : 'On its own, sandboxed' },
    (task.attempt ?? 1) > 1 && { term: 'Attempts', value: String(task.attempt) },
    usageText && { term: 'Usage', value: usageText },
    setup && { term: 'Setup', value: setup, mono: true },
    { term: 'Check', value: check, mono: true },
    task.repo?.base && { term: 'Base commit', value: task.repo.base.slice(0, 12), mono: true },
    worktree && { term: 'Worktree', value: task.worktreeRemoved ? `${worktree.path} (removed)` : worktree.path, mono: true },
  ];
  return rows.filter((row): row is Row => Boolean(row));
}

type DetailsProps = { task: Task; busy: boolean; locked: boolean; onRollback: (target: string, label: string) => void; onRemove: () => void };

export default function Details({ task, busy, locked, onRollback, onRemove }: DetailsProps) {
  const actions = taskActions(task, locked);

  return (
    <div id="panel-details" role="tabpanel" aria-labelledby="tab-details" className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-7 px-6 pt-5 pb-10">
        <section>
          <Heading>Task</Heading>
          <div className="text-[14px] leading-[1.65] text-ink [overflow-wrap:anywhere]"><Markdown text={task.criteria} /></div>
          {task.images && task.images.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {task.images.map(image => (
                <a key={image.id} href={`/api/uploads/${image.id}`} target="_blank" rel="noreferrer" title={image.name} className="block size-20 shrink-0 cursor-zoom-in overflow-hidden rounded-[10px] bg-inset shadow-hairline">
                  <img src={`/api/uploads/${image.id}`} alt={image.name} loading="lazy" className="size-full object-cover" />
                </a>
              ))}
            </div>
          )}
        </section>

        <section>
          <Heading>Run</Heading>
          <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px] max-sm:grid-cols-1 max-sm:gap-y-0.5">
            {runRows(task).map(({ term, value, mono }) => (
              <div key={term} className="contents">
                <dt className="text-ink-3 max-sm:mt-2">{term}</dt>
                <dd className={`text-ink [overflow-wrap:anywhere] ${mono ? 'font-mono text-[12.5px]' : ''}`}>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {actions.rollback && (
          <section>
            <Heading>Roll back</Heading>
            <p className="mb-2.5 text-[12.5px] text-ink-3">Restoring replaces the files in the worktree. The task history stays.</p>
            <div className="overflow-hidden rounded-card bg-surface shadow-card">
              {rollbackTargets(task).map(target => (
                <div key={target.key} className="flex h-11 items-center gap-2.5 border-b border-line px-3 last:border-0">
                  <StatusIcon kind={target.kind} size={16} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{target.title}</span>
                  <span className="text-[12.5px] text-ink-2">{target.result}</span>
                  {target.current
                    ? <span className="inline-flex h-5.5 items-center rounded-full bg-field px-2 text-[11.5px] font-medium text-ink-2 shadow-hairline">Current</span>
                    : <Button size="sm" variant="secondary" disabled={busy} data-restore={target.target} onClick={() => onRollback(target.target, target.description)}>Restore</Button>}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
          <a href={`/api/tasks/${task.id}/activity`} download className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Download activity</a>
          {actions.remove && <Button id="remove" variant="ghost" size="sm" className="text-red" disabled={busy} onClick={onRemove}>Remove worktree</Button>}
        </section>
      </div>
    </div>
  );
}
