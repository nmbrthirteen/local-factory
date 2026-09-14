import { isActive } from '@shared/domain';
import type { Task } from '@shared/types';
import { Button } from '@/components/atoms/Button';
import { ago } from '@/lib/tasks';
import Screenshot, { shotLabels } from './Screenshot';
import StatusIcon from './StatusIcon';

type PreviewProps = { task: Task; busy: boolean; locked: boolean; onRetake: () => void; onStartApp: () => void; onStopApp: () => void };

export default function Preview({ task, busy, locked, onRetake, onStartApp, onStopApp }: PreviewProps) {
  const { preview, liveApp } = task;
  const canRetake = Boolean(task.worktree) && !task.worktreeRemoved && Boolean(task.candidate) && !isActive(task.status);
  const image = (name: string) => `/api/tasks/${task.id}/preview?shot=${name}&at=${encodeURIComponent(preview?.at ?? '')}`;
  const stale = preview && preview.candidate !== task.candidate;
  const kind = !preview ? 'info' : preview.status === 'failed' ? 'failed' : preview.errors.length ? 'unchecked' : 'passed';

  return (
    <div id="panel-preview" role="tabpanel" aria-labelledby="tab-preview" className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-6 pt-5 pb-10 max-md:px-4">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px]">
          <StatusIcon kind={kind} size={14} />
          {preview ? (
            <>
              <span className="font-medium text-ink">{preview.status === 'captured' ? 'Screenshots captured' : 'Preview failed'}</span>
              <span className="inline-flex h-5.5 items-center rounded-chip bg-field px-1.5 font-mono text-[11.5px] text-ink-2 shadow-hairline">{preview.command.join(' ')}</span>
              <span className="text-[12.5px] text-ink-3">{preview.source === 'agent' ? 'from the agent' : 'from package.json'} · {ago(preview.at)}{stale ? ' · earlier attempt' : ''}</span>
            </>
          ) : (
            <span className="text-ink-2">No screenshots yet</span>
          )}
          {canRetake && <Button className="ml-auto" size="sm" variant="secondary" disabled={busy || locked} onClick={onRetake}>{preview ? 'Retake screenshots' : 'Take screenshots'}</Button>}
          {canRetake && !liveApp && <Button size="sm" variant="secondary" disabled={busy || locked} onClick={onStartApp}>Start app</Button>}
        </div>

        {liveApp && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-card bg-surface px-3 py-2 text-[13px] shadow-card">
            <StatusIcon kind="running" size={14} />
            <span className="font-medium text-ink">App running</span>
            <a href={liveApp.url} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-ink-2 underline-offset-2 hover:underline">{liveApp.url}</a>
            <span className="text-[12.5px] text-ink-3">Stops on merge or settle</span>
            <Button className="ml-auto" size="sm" variant="secondary" disabled={busy} onClick={onStopApp}>Stop</Button>
            <Button size="sm" variant="primary" onClick={() => window.open(liveApp.url, '_blank', 'noopener')}>Open app</Button>
          </div>
        )}

        {preview?.note && <p role="alert" className="rounded-control bg-red-tint px-3 py-2 text-[12.5px] text-red [overflow-wrap:anywhere]">{preview.note}</p>}

        {preview && preview.errors.length > 0 && (
          <div className="overflow-hidden rounded-card bg-surface shadow-card">
            <p className="border-b border-line px-3 py-2 text-[12.5px] font-medium text-orange">{preview.errors.length === 1 ? '1 page error' : `${preview.errors.length} page errors`}</p>
            <pre className="scroll-thin max-h-40 overflow-auto px-3 py-2 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">{preview.errors.join('\n')}</pre>
          </div>
        )}

        {preview && preview.shots.length > 0 && (
          <div className="flex flex-wrap items-start gap-4">
            {preview.shots.map(shot => (
              <figure key={shot.name} className={shot.name === 'mobile' ? 'w-[240px] shrink-0' : 'min-w-[320px] flex-1'}>
                <Screenshot src={image(shot.name)} shot={shot} alt={task.title} className="rounded-card" />
                <figcaption className="mt-1.5 text-[12px] text-ink-3">{shotLabels[shot.name]} · {shot.width}×{shot.height}</figcaption>
              </figure>
            ))}
          </div>
        )}

        {preview?.log && (
          <details className="text-[12.5px] text-ink-3">
            <summary className="w-fit cursor-pointer rounded-[6px] hover:text-ink-2">App output</summary>
            <pre className="scroll-thin mt-2 max-h-60 overflow-auto rounded-control bg-inset p-3 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">{preview.log}</pre>
          </details>
        )}
      </div>
    </div>
  );
}
