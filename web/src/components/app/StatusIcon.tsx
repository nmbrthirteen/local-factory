import type { ReactNode } from 'react';
import { popIn } from '@/lib/motion';
import type { StatusKind } from '@/lib/tasks';

const filled: Partial<Record<StatusKind, { color: string; mark: ReactNode }>> = {
  passed: { color: 'var(--green)', mark: <path d="m5 8.2 2 2 4-4.2" /> },
  failed: { color: 'var(--red)', mark: <path d="m5.75 5.75 4.5 4.5m0-4.5-4.5 4.5" /> },
  attention: { color: 'var(--orange)', mark: <path d="M8 4.75v3.9M8 11.1v.15" /> },
  committed: { color: 'var(--accent)', mark: <><circle cx="8" cy="8" r="2" /><path d="M3.6 8H6m4 0h2.4" /></> },
};

export default function StatusIcon({ kind, size = 16, className = '' }: { kind: StatusKind; size?: number; className?: string }) {
  if (kind === 'working' || kind === 'running') {
    return (
      <span aria-hidden className={`inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}>
        <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" style={{ animation: 'spin 1.1s linear infinite' }}>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--line-strong)" strokeWidth="1.75" />
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="var(--ink-2)" strokeWidth="1.75" strokeLinecap="round" strokeDasharray="11 28.3" />
        </svg>
      </span>
    );
  }

  const glyph = filled[kind];
  if (glyph) {
    const { color, mark } = glyph;
    return (
      <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" className={`shrink-0 ${className}`} style={popIn(300)}>
        <circle cx="8" cy="8" r="7.5" fill={color} />
        <g fill="none" stroke="white" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{mark}</g>
      </svg>
    );
  }

  const warning = kind === 'unchecked' || kind === 'soft';
  const ring = warning ? 'var(--orange)' : 'var(--ink-3)';
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" className={`shrink-0 ${className}`} fill="none" strokeLinecap="round" strokeLinejoin="round">
      {kind === 'done' && <path d="m3.8 8.4 2.7 2.7 5.7-5.7" stroke="var(--ink-3)" strokeWidth="1.8" />}
      {kind === 'info' && <circle cx="8" cy="8" r="2" fill="var(--ink-3)" />}
      {kind !== 'done' && kind !== 'info' && <circle cx="8" cy="8" r="6.25" stroke={ring} strokeWidth="1.5" strokeDasharray={kind === 'queued' ? '2.6 2.3' : undefined} />}
      {kind === 'stopped' && <rect x="5.6" y="5.6" width="4.8" height="4.8" rx="1" fill="var(--ink-3)" />}
      {warning && <path d="M5.6 8h4.8" stroke={ring} strokeWidth="1.6" />}
    </svg>
  );
}
