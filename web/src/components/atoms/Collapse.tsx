import type { ReactNode } from 'react';
import { easeOut } from '@/lib/motion';

export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="grid transition-[grid-template-rows,opacity] duration-300" style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0, transitionTimingFunction: easeOut }}>
      <div className="min-h-0 overflow-hidden" inert={!open}>{children}</div>
    </div>
  );
}
