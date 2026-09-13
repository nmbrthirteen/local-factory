import { useEffect, useState } from 'react';

const waveDelays = Array.from({ length: 9 }, (_, index) => ((index % 3) + Math.abs(Math.floor(index / 3) - 1)) * 90);
const shimmer = {
  backgroundImage: 'linear-gradient(90deg, var(--ink-3) 35%, var(--ink) 50%, var(--ink-3) 65%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer-text 1.4s linear infinite',
};

function formatElapsed(ms: number) {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function useElapsed(since?: string) {
  const [start] = useState(() => (since ? Date.parse(since) : Date.now()));
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return formatElapsed(now - start);
}

export default function LoadingState({ label, since }: { label: string; since?: string }) {
  const elapsed = useElapsed(since);
  return (
    <div role="status" className="flex w-fit items-center gap-2.5">
      <span aria-hidden className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {waveDelays.map((delay, index) => (
          <span key={index} className="size-[4px] rounded-[1px] bg-ink" style={{ opacity: 0.15, animation: `pixel-on 650ms ease-in-out ${delay}ms infinite` }} />
        ))}
      </span>
      <span className="bg-clip-text text-[13px] font-medium text-transparent" style={shimmer}>{label}</span>
      <span className="font-mono text-[12px] text-ink-3 tabular-nums">{elapsed}</span>
    </div>
  );
}
