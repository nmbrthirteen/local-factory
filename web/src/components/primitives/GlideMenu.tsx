import { useEffect, useRef, useState, type ReactNode } from 'react';
import { easeOut } from '@/lib/motion';

type GlideMenuProps = {
  children: ReactNode;
  className?: string;
  highlightClassName?: string;
  rowSelector?: string;
};

export default function GlideMenu({ children, className = '', highlightClassName = 'inset-x-0 rounded-[8px] bg-hover', rowSelector = '[data-menu-row]' }: GlideMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const moveTo = (event: Event) => {
      const row = event.target instanceof Element ? event.target.closest(rowSelector) : null;
      if (!(row instanceof HTMLElement) || !container.contains(row)) return;
      const containerTop = container.getBoundingClientRect().top;
      const rowRect = row.getBoundingClientRect();
      setBox({ top: rowRect.top - containerTop, height: rowRect.height });
      setVisible(true);
    };
    const hide = () => setVisible(false);
    const hideOnFocusLeave = (event: FocusEvent) => {
      if (!container.contains(event.relatedTarget as Node | null)) hide();
    };
    container.addEventListener('mouseover', moveTo);
    container.addEventListener('mouseleave', hide);
    container.addEventListener('focusin', moveTo);
    container.addEventListener('focusout', hideOnFocusLeave);
    return () => {
      container.removeEventListener('mouseover', moveTo);
      container.removeEventListener('mouseleave', hide);
      container.removeEventListener('focusin', moveTo);
      container.removeEventListener('focusout', hideOnFocusLeave);
    };
  }, [rowSelector]);

  return (
    <div ref={ref} className={`group/glide-menu relative ${className}`}>
      <span
        aria-hidden
        className={`pointer-events-none absolute ${highlightClassName}`}
        style={{
          top: box?.top ?? 0,
          height: box?.height ?? 0,
          opacity: box && visible ? 1 : 0,
          transition: `top 220ms ${easeOut}, height 220ms ${easeOut}, opacity 150ms ease`,
        }}
      />
      {children}
    </div>
  );
}
