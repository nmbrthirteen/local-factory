import type { ProgressUpdate } from '@shared/types';
import { fadeUp } from '@/lib/motion';

const visibleLines = 14;
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, 'g');

export default function LiveProgress({ progress }: { progress: ProgressUpdate }) {
  const text = progress.text.replace(ansi, '');
  if (progress.kind === 'message') {
    if (!text.trim()) return null;
    return <p id="live-progress" className="text-[14px] leading-6 whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]" style={fadeUp(200)}>{text}</p>;
  }
  const tail = text.split('\n').slice(-visibleLines).join('\n').trimEnd();
  return (
    <div id="live-progress" className="flex flex-col gap-1.5" style={fadeUp(200)}>
      {progress.label && <p className="truncate font-mono text-[12px] text-ink-3" title={progress.label}>{progress.label}</p>}
      {tail && <pre className="scroll-thin max-h-60 overflow-auto rounded-chip bg-field px-2.5 py-2 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-ink-2 shadow-hairline [overflow-wrap:anywhere]">{tail}</pre>}
    </div>
  );
}
