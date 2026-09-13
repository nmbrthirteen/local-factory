import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Button } from '@/components/atoms/Button';
import Modal from '@/components/primitives/Modal';

export type ConfirmOptions = {
  title: string;
  message?: string;
  command?: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
};

type Pending = ConfirmOptions & { resolve: (approved: boolean) => void };

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);

export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => setPending({ ...options, resolve })), []);

  const answer = (approved: boolean) => {
    pending?.resolve(approved);
    setPending(null);
  };

  return (
    <ConfirmContext value={confirm}>
      {children}
      <Modal open={Boolean(pending)} label={pending?.title ?? 'Confirm'} onClose={() => answer(false)}>
        {pending && (
          <form
            id="confirm-dialog"
            onSubmit={event => {
              event.preventDefault();
              answer(true);
            }}
          >
            <div className="flex flex-col gap-2 p-5">
              <h2 className="text-[15px] leading-snug font-semibold tracking-[-0.01em] text-ink">{pending.title}</h2>
              {pending.message && <p className="text-[13px] leading-normal text-ink-2">{pending.message}</p>}
              {pending.command && (
                <pre className="scroll-thin mt-1 max-h-48 overflow-auto rounded-chip bg-field px-2.5 py-2 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-ink shadow-hairline [overflow-wrap:anywhere]">
                  {pending.command}
                </pre>
              )}
            </div>
            <div className="primitive-card-footer flex justify-end gap-1.5 border-t border-line">
              <Button type="button" variant="ghost" size="sm" onClick={() => answer(false)}>Cancel</Button>
              <Button type="submit" variant={pending.tone === 'danger' ? 'danger' : 'primary'} size="sm" autoFocus>{pending.confirmLabel}</Button>
            </div>
          </form>
        )}
      </Modal>
    </ConfirmContext>
  );
}
