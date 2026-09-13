import { useEffect, useRef, useState } from 'react';

export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) => ref.current?.contains(target as Node) || panel.current?.contains(target as Node);
    const close = (event: PointerEvent) => {
      if (!inside(event.target)) setOpen(false);
    };
    const scroll = (event: Event) => {
      if (panel.current && !inside(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [open]);

  return { open, setOpen, ref, panel };
}
