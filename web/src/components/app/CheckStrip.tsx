import { useState } from 'react';
import { commandLine, type DeliveryCommand } from '@shared/commands';
import type { TaskLike } from '@shared/types';
import { CopyButton, smallAction } from '@/components/atoms/SmallAction';
import { fadeUp } from '@/lib/motion';
import { checkSummary, repoName } from '@/lib/tasks';
import StatusIcon from './StatusIcon';

const stripRow = 'flex items-center gap-2 border-t border-line bg-inset px-3 py-2';

function CommandRow({ id, label, command, disabled, onRun }: { id: string; label: string; command: string; disabled?: boolean; onRun?: () => void }) {
  return (
    <div data-command={id} className={stripRow}>
      <span className="text-[12.5px] text-ink-3">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink" title={command}>{command}</code>
      <CopyButton text={command} />
      {onRun && <button type="button" data-run-command={id} disabled={disabled} onClick={onRun} className={`${smallAction} text-accent-ink`}>Run</button>}
    </div>
  );
}

type CheckStripProps = { task: TaskLike; busy: boolean; onReveal: () => void; onRunCommand: (command: DeliveryCommand) => void };

export default function CheckStrip({ task, busy, onReveal, onRunCommand }: CheckStripProps) {
  const summary = checkSummary(task);
  const [open, setOpen] = useState(true);
  if (!summary) return null;
  const filesInWorktree = ['passed', 'unchecked', 'failed'].includes(summary.kind) && task.worktree && !task.worktreeRemoved;

  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-card" style={fadeUp(300)}>
      <div className="flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2 text-[13px]">
        <StatusIcon kind={summary.kind} />
        <span className="font-medium text-ink">{summary.title}</span>
        {summary.command && <span className="inline-flex h-5.5 min-w-0 items-center truncate rounded-chip bg-field px-1.5 font-mono text-[11.5px] text-ink-2 shadow-hairline">{summary.command}</span>}
        {summary.source && <span className="text-[12.5px] text-ink-3">{summary.source}</span>}
        {summary.note && <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">{summary.note}</span>}
        {summary.link && <a href={summary.link} target="_blank" rel="noreferrer" className="text-[12.5px] font-medium text-accent-ink underline-offset-2 hover:underline">View pull request</a>}
        {summary.commit && <span className="text-[12.5px] text-ink-2"><span className="font-mono">{summary.commit.sha.slice(0, 12)}</span> on <span className="font-mono">{summary.commit.branch}</span></span>}
        <span className="ml-auto flex items-center gap-2">
          {summary.meta && <span className="font-mono text-[11.5px] text-ink-3 tabular-nums">{summary.meta}</span>}
          {summary.output && (
            <button type="button" aria-expanded={open} onClick={() => setOpen(state => !state)} className="rounded-[6px] px-1.5 py-0.5 text-[12px] font-medium text-ink-3 transition-colors hover:bg-hover hover:text-ink">
              {open ? 'Hide output' : 'Show output'}
            </button>
          )}
        </span>
      </div>
      {summary.output && open && <pre className="scroll-thin max-h-48 overflow-auto border-t border-line bg-inset px-3.5 py-2.5 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">{summary.output}</pre>}
      {filesInWorktree && (
        <div className={`${stripRow} flex-wrap`}>
          <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">The files are in this task's worktree. They reach <span className="font-medium text-ink">{repoName(task.repo?.path)}</span> when you merge.</span>
          <button type="button" onClick={onReveal} className={`${smallAction} text-ink-3 hover:text-ink`}>Show files in Finder</button>
        </div>
      )}
      {summary.copy && <CommandRow id="merge-by-hand" label={summary.copy[0]} command={summary.copy[1]} />}
      {summary.commands?.map(command => (
        <CommandRow key={command.id} id={command.id} label={command.label} command={commandLine(command.argv)} disabled={busy} onRun={() => onRunCommand(command)} />
      ))}
    </div>
  );
}
