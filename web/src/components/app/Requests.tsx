import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AgentRequest, Question } from '@shared/types';
import { Button } from '@/components/atoms/Button';
import { Icon } from '@/components/atoms/Icon';
import GlideMenu from '@/components/primitives/GlideMenu';
import { fadeUp } from '@/lib/motion';
import StatusIcon from './StatusIcon';

const advanceDelayMs = 420;
const questionNav = 'flex size-[18px] items-center justify-center rounded-[5px] enabled:hover:text-ink disabled:opacity-30';

type Answer = (body: Record<string, unknown>) => void;

function RequestCard({ requestKey, bodyClassName, footerClassName, footer, children }: { requestKey: string; bodyClassName: string; footerClassName: string; footer: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-card bg-surface shadow-card" style={fadeUp(380)} data-request={requestKey}>
      <div className={`primitive-card-pad flex flex-col ${bodyClassName}`}>{children}</div>
      <div className={`primitive-card-footer flex items-center justify-between border-t border-line ${footerClassName}`}>{footer}</div>
    </div>
  );
}

function ApprovalRequest({ request, disabled, onAnswer }: { request: AgentRequest; disabled: boolean; onAnswer: Answer }) {
  const { reason, command, blockedPath } = request.params;
  const footer = (
    <>
      <span className="pl-1 text-[12px] text-ink-3">Applies once. It may reach files or the network outside the sandbox.</span>
      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="sm" disabled={disabled} data-decision="decline" onClick={() => onAnswer({ decision: 'decline' })}>Decline</Button>
        <Button variant="accent" size="sm" disabled={disabled} data-decision="accept" onClick={() => onAnswer({ decision: 'accept' })}>Allow once</Button>
      </div>
    </>
  );
  return (
    <RequestCard requestKey={request.key} bodyClassName="gap-2" footerClassName="flex-wrap gap-2" footer={footer}>
      <div className="flex items-center gap-2">
        <StatusIcon kind="attention" />
        <span className="text-[14px] font-medium text-ink">Permission needed</span>
      </div>
      {reason && <p className="text-[13px] leading-normal text-ink-2">{reason}</p>}
      <pre className="scroll-thin max-h-40 overflow-auto rounded-chip bg-field px-2.5 py-2 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-ink shadow-hairline [overflow-wrap:anywhere]">{command || JSON.stringify(request.params, null, 2)}</pre>
      {blockedPath && <p className="text-[12px] text-ink-3">Outside the worktree: <span className="font-mono">{blockedPath}</span></p>}
    </RequestCard>
  );
}

function QuestionRequest({ request, disabled, onAnswer }: { request: AgentRequest; disabled: boolean; onAnswer: Answer }) {
  const questions: Question[] = request.params.questions ?? [];
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const advanceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const question = questions[index];
  const last = index === questions.length - 1;
  const value = answers[question.id] ?? '';
  const complete = questions.every(item => answers[item.id]?.trim());
  const options = question.options ?? [];
  const pickedOption = options.some(option => option.label === value);

  useEffect(() => () => clearTimeout(advanceTimer.current), []);

  const advance = (next = answers) => {
    if (!last) setIndex(index + 1);
    else if (questions.every(item => next[item.id]?.trim())) onAnswer({ answers: next });
  };
  const pick = (label: string) => {
    const next = { ...answers, [question.id]: label };
    setAnswers(next);
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => advance(next), advanceDelayMs);
  };

  const footer = (
    <>
      <div className="flex items-center gap-1 pl-1 text-ink-3">
        {questions.length > 1 && (
          <>
            <button type="button" aria-label="Previous question" disabled={index === 0} onClick={() => setIndex(index - 1)} className={questionNav}>
              <Icon name="chevronUp" />
            </button>
            <span className="text-[12px] font-medium tabular-nums">{index + 1} / {questions.length}</span>
            <button type="button" aria-label="Next question" disabled={last} onClick={() => setIndex(index + 1)} className={questionNav}>
              <Icon name="chevronDown" />
            </button>
          </>
        )}
      </div>
      <Button variant="accent" size="sm" disabled={disabled || (last ? !complete : !value.trim())} onClick={() => advance()}>
        {last ? 'Send answer' : 'Continue'}
      </Button>
    </>
  );

  return (
    <RequestCard requestKey={request.key} bodyClassName="gap-2.5" footerClassName="gap-3" footer={footer}>
      <div className="flex items-center gap-2 text-[12px] font-medium text-ink-3">
        <StatusIcon kind="attention" size={14} />
        The agent has a question
      </div>
      <div key={question.id} className="flex flex-col gap-2.5" style={fadeUp(260)}>
        <p className="text-[14px] leading-snug font-medium text-ink">{question.question}</p>
        {options.length > 0 && (
          <GlideMenu className="flex flex-col gap-0.5" highlightClassName="inset-x-0 rounded-control bg-hover">
            {options.map(option => {
              const on = value === option.label;
              return (
                <button key={option.label} type="button" data-menu-row aria-pressed={on} disabled={disabled} onClick={() => pick(option.label)} className="relative z-10 flex items-start gap-2 rounded-control py-1.5 pr-2 pl-1 text-left">
                  <span className={`mt-px flex size-4 shrink-0 items-center justify-center rounded-full transition-colors duration-200 ${on ? 'bg-ink' : 'shadow-[inset_0_0_0_1.5px_var(--line-strong)]'}`}>
                    <span className="size-1.5 rounded-full bg-canvas transition-transform duration-200" style={{ transform: on ? 'scale(1)' : 'scale(0)' }} />
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[13px] leading-tight ${on ? 'text-ink' : 'text-ink-2'}`}>{option.label}</span>
                    {option.description && <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{option.description}</span>}
                  </span>
                </button>
              );
            })}
          </GlideMenu>
        )}
        <textarea
          name={question.id}
          aria-label="Your answer"
          rows={2}
          maxLength={4000}
          value={pickedOption ? '' : value}
          disabled={disabled}
          onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey || !value.trim()) return;
            event.preventDefault();
            advance();
          }}
          placeholder={options.length ? 'Something else…' : 'Type your answer'}
          className="w-full resize-none rounded-control bg-field px-2.5 py-2 text-[13px] leading-normal text-ink shadow-hairline outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_1px_var(--line-strong)]"
        />
      </div>
    </RequestCard>
  );
}

export default function Requests({ requests, disabled, onAnswer }: { requests: AgentRequest[]; disabled: boolean; onAnswer: (key: string, body: Record<string, unknown>) => void }) {
  if (!requests.length) return null;
  return (
    <div id="requests" className="flex flex-col gap-2.5">
      {requests.map(request => {
        const answer: Answer = body => onAnswer(request.key, body);
        return request.kind === 'question'
          ? <QuestionRequest key={request.key} request={request} disabled={disabled} onAnswer={answer} />
          : <ApprovalRequest key={request.key} request={request} disabled={disabled} onAnswer={answer} />;
      })}
    </div>
  );
}
