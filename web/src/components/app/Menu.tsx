import type { ReactNode } from 'react';
import { Icon } from '@/components/atoms/Icon';
import GlideMenu from '@/components/primitives/GlideMenu';
import { popIn } from '@/lib/motion';
import { usePopover } from '@/lib/usePopover';
import { cn } from '@/lib/utils';

export type MenuOption<T extends string = string> = { value: T; name: string; description?: string; tag?: string };

export const popoverClass = 'absolute top-full z-30 mt-2 rounded-[10px] bg-surface p-1 shadow-raised';
export const menuHighlight = 'inset-x-0 rounded-[6px] bg-hover';
export const menuItem = 'relative z-10 flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12.5px] font-medium text-ink disabled:pointer-events-none disabled:opacity-50';

export const MenuLabel = ({ children }: { children: ReactNode }) => <p className="px-2 pt-1.5 pb-1 text-[11.5px] font-medium text-ink-3">{children}</p>;
export const MenuDivider = () => <div className="my-1 h-px bg-line" />;
export const MenuCheck = ({ on }: { on: boolean }) => <Icon name="check" size={13} strokeWidth={2.5} className={cn('shrink-0 text-ink', !on && 'invisible')} />;

type MenuProps<T extends string> = {
  label: string;
  value: T;
  options: MenuOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  align?: 'left' | 'right';
};

export default function Menu<T extends string>({ label, value, options, onChange, disabled = false, align = 'left' }: MenuProps<T>) {
  const { open, setOpen, ref } = usePopover();
  const current = options.find(option => option.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.name ?? 'none'}`}
        disabled={disabled || !options.length}
        onClick={() => setOpen(state => !state)}
        className={`flex h-7 items-center gap-1 rounded-[8px] px-1.5 text-[12px] font-medium transition-colors duration-150 hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-50 ${open ? 'bg-hover text-ink' : 'text-ink-2'}`}
      >
        <span className="text-ink-3">{label}</span>
        {current?.name ?? 'Loading…'}
        <Icon name="chevronDown" size={11} strokeWidth={2.4} className="text-ink-3" />
      </button>
      {open && (
        <div role="listbox" aria-label={label} className={`${popoverClass} ${align === 'right' ? 'right-0' : 'left-0'} w-64`} style={popIn(180, `top ${align}`)}>
          <GlideMenu className="flex flex-col" highlightClassName={menuHighlight}>
            {options.map(option => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                data-menu-row
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className="relative z-10 flex min-h-7.5 w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{option.name}</span>
                  {option.description && <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">{option.description}</span>}
                </span>
                {option.tag && <span className="shrink-0 text-[11px] text-ink-3">{option.tag}</span>}
                <MenuCheck on={option.value === value} />
              </button>
            ))}
          </GlideMenu>
        </div>
      )}
    </div>
  );
}
