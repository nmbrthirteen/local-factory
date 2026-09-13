import { useEffect, useState } from 'react';
import type { Task } from '@shared/types';
import { Chevron } from '@/components/atoms/Icon';
import { ValuePill } from '@/components/atoms/ValuePill';
import { highlight } from '@/lib/highlight';
import { api } from '@/lib/live';
import { parsePatch, type DiffFile } from '@/lib/patch';

const autoOpenLineLimit = 800;
const removedHatch = 'repeating-linear-gradient(45deg, var(--red) 0, var(--red) 1.5px, transparent 1.5px, transparent 3px)';
const fileStates: Partial<Record<DiffFile['state'], [string, 'green' | 'red' | 'accent']>> = { added: ['Added', 'green'], deleted: ['Deleted', 'red'], renamed: ['Renamed', 'accent'] };

type PatchResponse = { text: string; bytes: number; truncated: boolean };
type Loaded = { key: string; files?: DiffFile[]; note?: string; error?: string };

const formatBytes = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

function Stat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 font-mono text-[12px] leading-none tabular-nums">
      <span className="text-green">+{additions}</span>
      <span className="text-red">-{deletions}</span>
    </span>
  );
}

function FileDiff({ file }: { file: DiffFile }) {
  const [open, setOpen] = useState(file.lines.length <= autoOpenLineLimit);
  const state = fileStates[file.state];
  return (
    <section id={`file-${file.path}`} className="overflow-hidden rounded-card bg-surface shadow-card">
      <button type="button" aria-expanded={open} onClick={() => setOpen(current => !current)} className={`flex h-11 w-full items-center gap-2 px-4 text-left text-[12.5px] transition-colors duration-100 hover:bg-inset ${open ? 'border-b border-line' : ''}`}>
        <Chevron open={open} className="shrink-0 text-ink-3" />
        <span className="min-w-0 truncate font-mono leading-none text-ink" title={file.state === 'renamed' ? `${file.from} → ${file.path}` : file.path}>{file.path}</span>
        {state && <ValuePill tone={state[1]}>{state[0]}</ValuePill>}
        <span className="ml-auto" />
        <Stat additions={file.additions} deletions={file.deletions} />
      </button>
      {open && (file.binary
        ? <p className="px-4 py-3 text-[12.5px] text-ink-3">Binary file</p>
        : (
          <div className="py-1.5 font-mono text-[12px] leading-[1.65] text-ink-2">
            {file.lines.map((line, index) => {
              if (line.kind === 'hunk') return <div key={index} className="my-1 bg-inset px-4 py-1 text-[11.5px] text-ink-3 first:mt-0">{line.text || '···'}</div>;
              const added = line.kind === 'add';
              const removed = line.kind === 'del';
              return (
                <div key={index} className={`relative grid grid-cols-[44px_44px_minmax(0,1fr)] items-start ${added ? 'bg-green-tint' : removed ? 'bg-red-tint' : ''}`}>
                  {(added || removed) && <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: added ? 'var(--green)' : removedHatch }} />}
                  <span className={`pr-2 text-right text-[11px] select-none ${removed ? 'text-red' : 'text-ink-3'}`}>{line.oldLine ?? ''}</span>
                  <span className={`pr-2 text-right text-[11px] select-none ${added ? 'text-green' : 'text-ink-3'}`}>{line.newLine ?? ''}</span>
                  <code className="pr-4 pl-2 break-words whitespace-pre-wrap">{line.text ? highlight(line.text) : ' '}</code>
                </div>
              );
            })}
          </div>
        ))}
    </section>
  );
}

export default function Changes({ task }: { task: Task }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${task.id}:${task.candidate}`;

  useEffect(() => {
    if (!task.patch) return;
    const { path } = task.patch;
    let current = true;
    api<PatchResponse>(`/tasks/${task.id}/patch`)
      .then(patch => current && setLoaded({ key, files: parsePatch(patch.text), note: patch.truncated ? `Showing the first ${formatBytes(patch.text.length)} of ${formatBytes(patch.bytes)}. Full patch: ${path}` : '' }))
      .catch((failure: Error) => current && setLoaded({ key, error: failure.message }));
    return () => {
      current = false;
    };
  }, [key, task.id, task.patch]);

  const result = loaded?.key === key ? loaded : null;
  const files = result?.files;
  const totals = (files ?? []).reduce((sum, file) => ({ additions: sum.additions + file.additions, deletions: sum.deletions + file.deletions }), { additions: 0, deletions: 0 });

  return (
    <div id="panel-changes" role="tabpanel" aria-labelledby="tab-changes" className="scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-3 px-6 pt-5 pb-8">
        {!task.patch && <p className="text-[13px] text-ink-3">Changes appear after the agent finishes.</p>}
        {task.patch && result?.error && <p className="text-[13px] text-red">Could not load the changes: {result.error}</p>}
        {task.patch && !result && <p className="text-[13px] text-ink-3">Loading changes…</p>}
        {files && !files.length && <p className="text-[13px] text-ink-3">No file changes</p>}
        {files && files.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[13px] font-medium text-ink">{files.length} {files.length === 1 ? 'file' : 'files'} changed</span>
              <Stat {...totals} />
            </div>
            {files.length > 1 && (
              <div className="flex max-w-full flex-wrap gap-1.5">
                {files.map(file => (
                  <a
                    key={file.path}
                    href={`#file-${file.path}`}
                    onClick={event => {
                      event.preventDefault();
                      document.getElementById(`file-${file.path}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="inline-flex h-7 max-w-full items-center gap-2 rounded-chip bg-surface px-2 font-mono text-[11.5px] text-ink shadow-btn transition-colors duration-100 hover:bg-hover"
                  >
                    <span className="min-w-0 truncate">{file.path}</span>
                    <span className="shrink-0 text-green tabular-nums">+{file.additions}</span>
                    {file.deletions > 0 && <span className="shrink-0 text-red tabular-nums">−{file.deletions}</span>}
                  </a>
                ))}
              </div>
            )}
            {result?.note && <p className="text-[12px] text-ink-3 [overflow-wrap:anywhere]">{result.note}</p>}
            {files.map(file => <FileDiff key={file.path} file={file} />)}
          </>
        )}
      </div>
    </div>
  );
}
