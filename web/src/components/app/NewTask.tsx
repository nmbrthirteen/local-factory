import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Autonomy, Harness } from '@shared/domain';
import type { Repository } from '@shared/types';
import { Button } from '@/components/atoms/Button';
import { Collapse } from '@/components/atoms/Collapse';
import { Chevron } from '@/components/atoms/Icon';
import { fadeUp } from '@/lib/motion';
import { agents, autonomyModes, parseCommand, repoName } from '@/lib/tasks';
import type { AgentState } from '@/lib/useFactory';
import Menu from './Menu';

const draftKey = 'factory-task-draft';
const minHeightPx = 132;
const maxHeightPx = 360;
const field = 'h-9 w-full rounded-[8px] bg-field px-2.5 text-[13px] text-ink shadow-hairline outline-none transition-shadow placeholder:text-ink-3 focus:shadow-[0_0_0_1px_var(--line-strong)]';
const optionFields = [
  ['title', 'Title', 'Taken from the first line of the description'],
  ['setup', 'Setup command', 'Found from the lockfile, such as npm ci'],
  ['check', 'Check command', 'The agent writes tests and picks one'],
] as const;

type OptionKey = (typeof optionFields)[number][0];

function AgentStatus({ agent }: { agent: AgentState }) {
  const info = agents[agent.harness as Harness];
  if (agent.error) return <span className="text-red">{agent.error}</span>;
  if (!agent.probe) return <span>Checking {info?.name ?? 'agent'} sign-in…</span>;
  if (!agent.probe.authenticated) return <span className="text-orange">Sign in first: run {agents[agent.probe.harness].signIn}</span>;
  return (
    <span title={`${agent.probe.version}${agent.probe.account ? ` · ${agent.probe.account}` : ''}`} className="inline-flex items-center gap-1.5">
      <span className="size-1.5 rounded-full bg-green" />
      Ready
    </span>
  );
}

type NewTaskProps = {
  agent: AgentState;
  repository: Repository;
  repositories: Repository[];
  busy: boolean;
  onAgent: (harness: string) => void;
  onReprobe: () => void;
  onCancel: () => void;
  onCreate: (task: Record<string, unknown>) => void;
};

export default function NewTask({ agent, busy, repository, repositories, onAgent, onReprobe, onCancel, onCreate }: NewTaskProps) {
  const [draft, setDraft] = useState(() => sessionStorage.getItem(draftKey) ?? '');
  const [target, setTarget] = useState(repository.path);
  const [model, setModel] = useState('');
  const [autonomy, setAutonomy] = useState<Autonomy>('ask');
  const [showOptions, setShowOptions] = useState(false);
  const [options, setOptions] = useState<Record<OptionKey, string>>({ title: '', setup: '', check: '' });
  const input = useRef<HTMLTextAreaElement>(null);
  const models = agent.probe?.harness === agent.harness ? agent.probe.models : [];

  useEffect(() => input.current?.focus(), []);
  useEffect(() => sessionStorage.setItem(draftKey, draft), [draft]);
  useEffect(() => {
    if (models.length && !models.some(option => option.id === model)) setModel((models.find(option => option.isDefault) ?? models[0]).id);
  }, [models, model]);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = '0px';
    node.style.height = `${Math.min(Math.max(node.scrollHeight, minHeightPx), maxHeightPx)}px`;
  }, [draft]);

  const ready = Boolean(draft.trim() && models.length && model && !busy);
  const submit = () => {
    if (!ready) return;
    onCreate({ criteria: draft, repository: target, model, autonomy, harness: agent.harness, title: options.title, setup: parseCommand(options.setup), check: parseCommand(options.check) });
    sessionStorage.removeItem(draftKey);
  };

  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pt-[max(48px,12vh)] pb-12">
      <form
        id="task-form"
        className="w-full max-w-[660px]"
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
        style={fadeUp(380)}
      >
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">What should the agent build?</h1>
        <p className="mt-1 text-[13.5px] text-ink-2">It works in its own worktree and runs a check before anything reaches your branch.</p>

        <div className="mt-5 flex flex-col gap-2 rounded-[22px] border border-line bg-surface p-3 shadow-card transition-[border-color] duration-150 focus-within:border-line-strong">
          <textarea
            ref={input}
            name="criteria"
            aria-label="Task description"
            value={draft}
            maxLength={10_000}
            onChange={event => setDraft(event.target.value)}
            placeholder="Describe the change and what success looks like."
            className="w-full resize-none bg-transparent px-2 py-1.5 text-[14px] leading-6 text-ink outline-none [overflow-wrap:anywhere] placeholder:text-ink-3"
          />
          <div className="flex flex-wrap items-center gap-1">
            <Menu label="Repository" value={target} onChange={setTarget} options={repositories.map(repo => ({ value: repo.path, name: repoName(repo.path), description: repo.path }))} />
            <Menu label="Agent" value={agent.harness} onChange={onAgent} options={Object.entries(agents).map(([value, { name }]) => ({ value, name }))} />
            <Menu label="Model" value={model} onChange={setModel} options={models.map(option => ({ value: option.id, name: option.name, tag: option.isDefault ? 'Default' : undefined }))} />
            <Menu label="Permissions" value={autonomy} onChange={setAutonomy} options={autonomyModes} />
            <button
              type="submit"
              aria-label="Create task"
              disabled={!ready}
              className="ml-auto flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-medium transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96]"
              style={{ background: ready ? 'var(--ink)' : 'var(--line-strong)', color: ready ? 'var(--surface)' : 'var(--ink-2)' }}
            >
              Create task <kbd>⌘↵</kbd>
            </button>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-2 text-[12px] text-ink-3">
          <button type="button" id="retry-agent" onClick={onReprobe} title="Check sign-in again" className="rounded-[6px] transition-colors hover:text-ink-2">
            <span id="agent-status"><AgentStatus agent={agent} /></span>
          </button>
          <span id="autonomy-note" className="max-w-[380px] text-right">{autonomyModes.find(mode => mode.value === autonomy)?.description}</span>
        </div>

        <div className="mt-6 border-t border-line pt-3">
          <button type="button" aria-expanded={showOptions} onClick={() => setShowOptions(open => !open)} className="-mx-1.5 flex items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2">
            <Chevron open={showOptions} />
            Options
            <span className="text-ink-3">title, setup, and check are picked for you</span>
          </button>
          <Collapse open={showOptions}>
            <div className="grid gap-3 px-0.5 pt-3 pb-1">
              {optionFields.map(([key, label, placeholder]) => (
                <label key={key} className="grid gap-1.5 text-[12.5px] font-medium text-ink-2">
                  {label}
                  <input name={key} value={options[key]} onChange={event => setOptions(current => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} className={`${key === 'title' ? '' : 'font-mono text-[12.5px]'} ${field}`} />
                </label>
              ))}
              <p className="text-[12px] text-ink-3">Setup can use the network. Checks run offline.</p>
            </div>
          </Collapse>
        </div>

        <div className="mt-5">
          <Button type="button" id="cancel-task" variant="quiet" size="xs" onClick={onCancel}>Cancel <kbd>Esc</kbd></Button>
        </div>
      </form>
    </div>
  );
}
