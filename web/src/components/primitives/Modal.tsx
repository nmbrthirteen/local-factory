import { useEffect, useRef, type ReactNode } from 'react';
import { popIn } from '@/lib/motion';

type ModalProps = { open: boolean; label: string; onClose: () => void; children: ReactNode; className?: string };

export default function Modal({ open, label, onClose, children, className = 'w-[min(440px,calc(100vw-32px))]' }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={`m-auto ${className} overflow-hidden rounded-window border-0 bg-surface p-0 text-ink shadow-overlay backdrop:bg-black/40`}
      style={popIn(180)}
    >
      {children}
    </dialog>
  );
}
