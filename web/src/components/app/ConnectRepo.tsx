import { useState, type CSSProperties } from 'react';
import { Button } from '@/components/atoms/Button';
import { Logo } from '@/components/atoms/Logo';
import Modal from '@/components/primitives/Modal';
import { fadeUp } from '@/lib/motion';

type ConnectProps = { busy: boolean; onConnect: (path: string) => void };
type FormProps = ConnectProps & { page?: boolean; onCancel?: () => void; className?: string; style?: CSSProperties };

function ConnectRepoForm({ busy, onConnect, onCancel, page = false, className = '', style }: FormProps) {
  const [path, setPath] = useState('');
  const [trusted, setTrusted] = useState(false);
  const ready = Boolean(path.trim()) && trusted;
  const Heading = page ? 'h1' : 'h2';

  return (
    <form
      id="connect"
      onSubmit={event => {
        event.preventDefault();
        if (ready) onConnect(path.trim());
      }}
      className={className}
      style={style}
    >
      <div className="flex flex-col gap-4 p-5">
        {page && <Logo />}
        <div>
          <Heading className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Connect a repository</Heading>
          <p className="mt-1 text-[13px] leading-normal text-ink-2">Each task runs an agent in its own Git worktree. Your branch changes only when you merge.</p>
        </div>
        <label className="grid gap-1.5 text-[12.5px] font-medium text-ink-2">
          Repository folder
          <input name="path" autoFocus required value={path} onChange={event => setPath(event.target.value)} placeholder="/Users/you/projects/my-app" autoComplete="off" className="h-9 w-full rounded-[8px] bg-field px-2.5 font-mono text-[12.5px] text-ink shadow-hairline outline-none placeholder:text-ink-3 focus:shadow-[0_0_0_1px_var(--line-strong)]" />
        </label>
        <label className="flex items-start gap-2 text-[13px] text-ink-2">
          <input type="checkbox" name="trusted" checked={trusted} onChange={event => setTrusted(event.target.checked)} className="mt-0.5 size-4 accent-[var(--ink)]" />
          I trust this repository and the scripts it runs.
        </label>
      </div>
      <div className="primitive-card-footer flex justify-end gap-1.5 border-t border-line">
        {onCancel && <Button type="button" id="cancel-connect" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" variant="primary" size="sm" disabled={busy || !ready}>Connect</Button>
      </div>
    </form>
  );
}

export default function ConnectRepo({ busy, onConnect }: ConnectProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <ConnectRepoForm page busy={busy} onConnect={onConnect} className="w-full max-w-[420px] overflow-hidden rounded-window bg-surface shadow-overlay" style={fadeUp(380)} />
    </div>
  );
}

export function AddRepositoryModal({ open, busy, onConnect, onClose }: ConnectProps & { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} label="Connect a repository" onClose={onClose}>
      {open && <ConnectRepoForm busy={busy} onConnect={onConnect} onCancel={onClose} />}
    </Modal>
  );
}
