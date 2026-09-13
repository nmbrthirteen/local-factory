import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Task, TaskSummary } from '@shared/types';
import { api } from '@/lib/live';
import { popIn } from '@/lib/motion';
import { agentName, ago, autonomyModes, checkSummary, repoName, taskState } from '@/lib/tasks';
import StatusIcon from './StatusIcon';

const openDelayMs = 400;
const switchDelayMs = 80;
const closeDelayMs = 120;
const cardWidth = 288;
const gap = 8;
const margin = 12;

type Anchor = { task: TaskSummary; top: number; left: number };
type Cached = { version: string; task: Task };

// A summary row carries no update time, so these fields decide whether a cached detail is stale.
const version = (task: TaskSummary) => [task.status, task.settled, task.merged, task.pullRequestState, task.worktreeRemoved].join(':');
const changeSummary = (stat?: string) => stat?.trim().split('\n').at(-1)?.trim() ?? '';

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-ink-3">{term}</dt>
      <dd className="min-w-0 truncate text-ink">{children}</dd>
    </div>
  );
}

function Card({ anchor, detail }: { anchor: Anchor; detail: Task | null }) {
  const { task } = anchor;
  const panel = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(anchor.top);

  useLayoutEffect(() => {
    const height = panel.current?.offsetHeight ?? 0;
    setTop(Math.max(margin, Math.min(anchor.top, innerHeight - height - margin)));
  }, [anchor.top, detail]);

  const state = taskState(task);
  const check = detail ? checkSummary(detail) : null;
  const branch = detail?.worktree && !detail.worktreeRemoved ? detail.worktree.branch : '';
  const changes = changeSummary(detail?.files);
  const permissions = detail ? autonomyModes.find(mode => mode.value === (detail.autonomy ?? 'ask'))?.name : '';

  return (
    <div ref={panel} id="task-peek" role="tooltip" className="pointer-events-none fixed z-50 rounded-card bg-surface p-3 shadow-overlay" style={{ top, left: anchor.left, width: cardWidth, ...popIn(160, 'left top') }}>
      <div className="flex items-center gap-1.5 text-[12px]">
        <StatusIcon kind={state.kind} size={14} />
        <span className="font-medium text-ink">{state.label}</span>
        <time dateTime={task.createdAt} className="ml-auto tabular-nums text-ink-3">{ago(task.createdAt)}</time>
      </div>
      <p className="mt-2 line-clamp-4 text-[13.5px] leading-snug font-medium text-ink [overflow-wrap:anywhere]">{task.title}</p>
      <dl className="mt-2.5 grid grid-cols-[80px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12px]">
        <Row term="Agent">{agentName(task.harness)} · {task.model}</Row>
        <Row term="Repository">{repoName(task.repository)}</Row>
        {detail && (detail.attempt ?? 1) > 1 && <Row term="Attempt">{detail.attempt}</Row>}
        {permissions && <Row term="Permissions">{permissions}</Row>}
        {check && <Row term="Check">{check.command ? `${check.title} · ${check.command}` : check.title}</Row>}
        {branch && <Row term="Branch"><span className="font-mono text-[11.5px]">{branch}</span></Row>}
        {changes && <Row term="Changes">{changes}</Row>}
      </dl>
      {detail?.feedback && <p className="mt-2.5 line-clamp-2 border-t border-line pt-2 text-[12px] text-ink-2 [overflow-wrap:anywhere]">Your note: {detail.feedback}</p>}
      {!detail && <p className="mt-2 text-[11.5px] text-ink-3">Loading details…</p>}
    </div>
  );
}

export function useTaskPeek() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [details, setDetails] = useState<Map<string, Cached>>(() => new Map());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!anchor) return;
    const hide = () => setAnchor(null);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, [anchor]);

  const cached = anchor ? details.get(anchor.task.id) : undefined;
  const detail = anchor && cached?.version === version(anchor.task) ? cached.task : null;

  useEffect(() => {
    if (!anchor || detail) return;
    const { task } = anchor;
    let current = true;
    api<{ task: Task }>(`/tasks/${task.id}?events=0`).then(
      result => current && setDetails(previous => new Map(previous).set(task.id, { version: version(task), task: result.task })),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [anchor, detail]);

  const bind = (task: TaskSummary) => ({
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      if (matchMedia('(hover: none)').matches) return;
      const row = event.currentTarget;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (row.querySelector('[aria-expanded="true"]')) return;
        const rect = row.getBoundingClientRect();
        const sidebarRight = row.closest('aside')?.getBoundingClientRect().right ?? rect.right;
        setAnchor({ task, top: rect.top, left: Math.min(sidebarRight + gap, innerWidth - cardWidth - margin) });
      }, anchor ? switchDelayMs : openDelayMs);
    },
    onMouseLeave: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setAnchor(null), closeDelayMs);
    },
    onMouseDown: () => {
      clearTimeout(timer.current);
      setAnchor(null);
    },
  });

  return { bind, card: anchor && createPortal(<Card key={anchor.task.id} anchor={anchor} detail={detail} />, document.body) };
}

export type PeekBind = ReturnType<typeof useTaskPeek>['bind'];
