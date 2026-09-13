import { useLayoutEffect, useRef } from 'react';
import type { OwnerCommand } from '@shared/commands';
import { smallAction } from '@/components/atoms/SmallAction';
import type { StatusKind } from '@/lib/tasks';
import StatusIcon from './StatusIcon';

function commandState(run: OwnerCommand): [StatusKind, string] {
  if (run.status === 'running') return ['working', 'Running'];
  if (run.status === 'stopped') return ['stopped', 'Stopped'];
  return run.exitCode === 0 ? ['passed', 'Finished'] : ['failed', `Exited with ${run.exitCode}`];
}

type CommandPanelProps = { run: OwnerCommand; busy: boolean; onStop: () => void; onRunAgain: () => void };

export default function CommandPanel({ run, busy, onStop, onRunAgain }: CommandPanelProps) {
  const output = useRef<HTMLPreElement>(null);
  const [kind, label] = commandState(run);

  useLayoutEffect(() => {
    if (output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [run.output]);

  return (
    <section id="command-panel" aria-label="Command output" className="overflow-hidden rounded-card bg-surface shadow-card">
      <div className="flex min-h-10 flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2 text-[13px]">
        <StatusIcon kind={kind} size={14} />
        <span className="shrink-0 font-medium text-ink">{label}</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2" title={`${run.command}\nin ${run.cwd}`}>{run.command}</code>
        {run.url && <a href={run.url} target="_blank" rel="noreferrer" className={`${smallAction} text-accent-ink`}>Open {new URL(run.url).host}</a>}
        {run.status === 'running'
          ? <button type="button" id="stop-command" disabled={busy} onClick={onStop} className={`${smallAction} text-red`}>Stop</button>
          : <button type="button" disabled={busy} onClick={onRunAgain} className={`${smallAction} text-ink-3 hover:text-ink`}>Run again</button>}
      </div>
      {run.output && (
        <pre ref={output} className="scroll-thin max-h-56 overflow-auto border-t border-line bg-inset px-3.5 py-2.5 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">
          {run.output}
        </pre>
      )}
    </section>
  );
}
