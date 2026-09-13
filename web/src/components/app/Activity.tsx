import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isActive, isWorking } from '@shared/domain';
import type { Task, TaskEvent } from '@shared/types';
import { Button } from '@/components/atoms/Button';
import { Collapse } from '@/components/atoms/Collapse';
import { Chevron, Icon } from '@/components/atoms/Icon';
import { StreamText } from '@/components/atoms/StreamText';
import LoadingState from '@/components/primitives/LoadingState';
import { buildActivity, taskActions, taskState, toolSummary, type EventEntry, type MessageEntry, type ToolEntry, type ToolGroupStep } from '@/lib/tasks';
import CommandPanel from './CommandPanel';
import Markdown from './Markdown';
import Requests from './Requests';
import Screenshot from './Screenshot';
import StatusIcon from './StatusIcon';

const compactQuery = '(max-width: 767px)';
const followThresholdPx = 48;
const liveWindow = 200;

const clock = (at: string) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function useCompact() {
  const [compact, setCompact] = useState(() => matchMedia(compactQuery).matches);
  useEffect(() => {
    const media = matchMedia(compactQuery);
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return compact;
}

const Output = ({ text }: { text: string }) => (
  <pre className="scroll-thin mt-0.5 mb-1 ml-2 max-h-72 overflow-auto border-l border-line py-0.5 pl-3.5 font-mono text-[11.5px] leading-[1.6] whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]">{text}</pre>
);

function ToolRow({ item }: { item: ToolEntry }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(item.output);
  return (
    <div data-step={item.id}>
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => setOpen(state => !state)}
        className="group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-control px-[3px] text-left transition-colors duration-100 enabled:hover:bg-hover-2"
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center text-ink-3">
          <Icon name={item.icon} size={13} className={`transition-opacity duration-100 ${expandable ? 'group-hover/row:opacity-0' : ''} ${open ? 'opacity-0' : ''}`} />
          {expandable && <span className={`absolute flex transition-opacity duration-150 group-hover/row:opacity-100 ${open ? 'opacity-100' : 'opacity-0'}`}><Chevron open={open} /></span>}
        </span>
        <span className={`shrink-0 text-[12.5px] font-medium ${item.state === 'failed' ? 'text-red' : 'text-ink'}`}>{item.verb}</span>
        <span className="inline-flex h-5.5 min-w-0 flex-1 items-center rounded-chip bg-field px-1.5 font-mono text-[11.5px] text-ink-2 shadow-hairline" title={item.target}>
          <span className="truncate">{item.target}</span>
        </span>
        {item.state === 'running' && <StatusIcon kind="working" size={13} />}
        {item.state === 'failed' && <span className="shrink-0 font-mono text-[11px] text-red">{item.exitCode ? `exit ${item.exitCode}` : 'failed'}</span>}
        {item.state === 'soft' && <span className="shrink-0 text-[11.5px] text-orange">error</span>}
      </button>
      {expandable && <Collapse open={open}><Output text={item.output} /></Collapse>}
    </div>
  );
}

function ToolGroup({ step, latest }: { step: ToolGroupStep; latest: boolean }) {
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? latest;
  const failed = step.items.filter(item => item.state === 'failed').length;
  const running = step.items.some(item => item.state === 'running');
  return (
    <div data-event={step.id} className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={() => setManual(!open)} className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2">
        {running ? <StatusIcon kind="working" size={12} /> : <Chevron open={open} />}
        <span className="tabular-nums">{toolSummary(step.items)}</span>
        {failed > 0 && <span className="text-red">· {failed} failed</span>}
      </button>
      <Collapse open={open}>
        <div className="-mx-1 flex flex-col gap-0.5 px-1.5 pt-1 pb-0.5">
          {step.items.map(item => <ToolRow key={item.id} item={item} />)}
        </div>
      </Collapse>
    </div>
  );
}

function EventRow({ step, taskId }: { step: EventEntry; taskId: string }) {
  const [open, setOpen] = useState(step.state === 'failed' && step.type !== 'check_result');
  return (
    <div data-event={step.id} className="flex flex-col">
      <button type="button" disabled={!step.output} aria-expanded={step.output ? open : undefined} onClick={() => setOpen(state => !state)} className="-mx-1.5 flex min-h-7 items-start gap-2 rounded-control px-1.5 py-1 text-left text-[12.5px] transition-colors duration-100 enabled:hover:bg-hover-2">
        <span className="mt-px flex"><StatusIcon kind={step.state} size={14} /></span>
        <span className={`line-clamp-2 min-w-0 flex-1 [overflow-wrap:anywhere] ${step.state === 'failed' ? 'text-red' : 'text-ink'}`}>{step.text || step.label}</span>
        <time dateTime={step.at} className="shrink-0 text-[11.5px] tabular-nums text-ink-3">{clock(step.at)}</time>
      </button>
      {step.output && <Collapse open={open}><Output text={step.output} /></Collapse>}
      {step.images.length > 0 && (
        <div className="mt-1 mb-1 ml-6 flex flex-wrap items-start gap-2.5">
          {step.images.map((shot, index) => (
            <Screenshot key={index} src={`/api/tasks/${taskId}/image?event=${step.id}&index=${index}`} shot={shot} alt={step.label} className="rounded-control" imageClassName="h-[168px] w-auto max-w-full" />
          ))}
        </div>
      )}
    </div>
  );
}

type MessageProps = { step: MessageEntry; animate: boolean; onProgress: () => void; onRunCommand?: (command: string) => void };

function Message({ step, animate, onProgress, onRunCommand }: MessageProps) {
  const [streamed, setStreamed] = useState(!animate);
  return (
    <div data-event={step.id} className="text-[14px] leading-[1.65] text-ink [overflow-wrap:anywhere]">
      {streamed
        ? <Markdown text={step.text} onRunCommand={onRunCommand} />
        : <StreamText text={step.text} blurTail={4} charsPerTick={Math.max(2, Math.ceil(step.text.length / 90))} onProgress={onProgress} onDone={() => setStreamed(true)} className="whitespace-pre-wrap" />}
    </div>
  );
}

function FollowUp({ task, busy, locked, onRetry }: { task: Task; busy: boolean; locked: boolean; onRetry: (feedback: string) => void }) {
  const [draft, setDraft] = useState('');
  const disabled = busy || locked;
  const send = () => {
    if (disabled) return;
    onRetry(draft.trim());
    setDraft('');
  };
  return (
    <form id="retry-form" onSubmit={event => { event.preventDefault(); send(); }} className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-2.5 shadow-card transition-[border-color] duration-150 focus-within:border-line-strong">
      <textarea
        name="feedback"
        aria-label="Follow-up for the agent"
        rows={2}
        maxLength={4000}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
          event.preventDefault();
          send();
        }}
        placeholder={task.status === 'failed' ? 'What should it try next?' : 'Ask for a change'}
        className="w-full resize-none bg-transparent px-1 text-[13.5px] leading-normal text-ink outline-none placeholder:text-ink-3"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        {locked && !busy && <span className="pl-1 text-[12px] text-ink-3">Another run is active</span>}
        <Button type="submit" variant="primary" size="sm" className="ml-auto" disabled={disabled}>{draft.trim() ? 'Send and run' : 'Run again'} <kbd>⌘↵</kbd></Button>
      </div>
    </form>
  );
}

type ActivityProps = {
  task: Task;
  events: TaskEvent[];
  verbosity: string;
  locked: boolean;
  busy: boolean;
  onAnswer: (key: string, body: Record<string, unknown>) => void;
  onRetry: (feedback: string) => void;
  onRunShell?: (command: string) => void;
  onStopShell?: () => void;
};

export default function Activity({ task, events, verbosity, locked, busy, onAnswer, onRetry, onRunShell, onStopShell }: ActivityProps) {
  const live = isActive(task.status);
  const steps = useMemo(() => buildActivity(events, { worktree: task.worktree?.path, live, verbosity }), [events, task.worktree?.path, live, verbosity]);
  const compact = useCompact();
  const scroller = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const firstSeen = useRef(events.at(-1)?.id ?? 0);
  const lastId = steps.at(-1)?.id;
  const lastGroup = steps.findLast(step => step.kind === 'tools')?.id;
  const retryable = taskActions(task, locked).retry;
  const requests = task.requests ?? [];

  const stick = () => {
    if (following && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  };
  useLayoutEffect(stick, [lastId, following, requests.length, task.status]);

  const ownerCommand = task.ownerCommand;
  const runCommand = live ? undefined : onRunShell;

  const dock = (requests.length > 0 || retryable || ownerCommand) && (
    <div className={`mx-auto flex w-full max-w-[760px] shrink-0 flex-col gap-2.5 ${compact ? 'px-4 pb-4' : 'px-6 pb-4'}`}>
      <Requests requests={requests} disabled={busy} onAnswer={onAnswer} />
      {ownerCommand && <CommandPanel run={ownerCommand} busy={busy} onStop={() => onStopShell?.()} onRunAgain={() => runCommand?.(ownerCommand.command)} />}
      {retryable && <FollowUp task={task} busy={busy} locked={locked} onRetry={onRetry} />}
    </div>
  );

  return (
    <div id="panel-activity" role="tabpanel" aria-labelledby="tab-activity" className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        id="activity-scroll"
        tabIndex={0}
        aria-label="Activity history"
        onScroll={event => {
          const node = event.currentTarget;
          setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < followThresholdPx);
        }}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto outline-none"
      >
        <div className={`mx-auto flex w-full max-w-[760px] flex-col gap-4 pt-5 pb-6 ${compact ? 'px-4' : 'px-6'}`}>
          {events.length >= liveWindow && <p className="text-[12px] text-ink-3">Latest 200 events. Full log in Details.</p>}
          {!steps.length && <p className="text-[13px] text-ink-3">{task.status === 'queued' ? 'Not started' : 'Starting…'}</p>}
          {steps.map(step => {
            if (step.kind === 'message') return <Message key={step.id} step={step} animate={live && step.id > firstSeen.current && step.id === lastId} onProgress={stick} onRunCommand={runCommand} />;
            if (step.kind === 'tools') return <ToolGroup key={step.id} step={step} latest={live && step.id === lastGroup} />;
            return <EventRow key={step.id} step={step} taskId={task.id} />;
          })}
          {isWorking(task.status) && <LoadingState label={taskState(task).label} since={task.startedAt} />}
        </div>
        {compact && dock}
      </div>
      {!following && (
        <Button id="latest" variant="secondary" size="sm" className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 shadow-raised" onClick={() => setFollowing(true)}>
          Jump to latest
        </Button>
      )}
      {!compact && dock}
    </div>
  );
}
