import { Fragment, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/atoms/Icon';
import Modal from '@/components/primitives/Modal';
import { searchPalette, type PaletteItem } from '@/lib/palette';
import { MenuLabel } from './Menu';

type CommandPaletteProps = { open: boolean; items: PaletteItem[]; onClose: () => void };

const optionId = (item: PaletteItem) => `palette-${item.id}`;

export default function CommandPalette({ open, items, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = searchPalette(items, query);
  const current = results[Math.min(active, results.length - 1)];

  const chosen = useRef<PaletteItem | null>(null);

  // Modal closes the dialog in its own effect, which runs first and restores focus, so an action that moves focus has to run after it.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      return;
    }
    const item = chosen.current;
    chosen.current = null;
    item?.run();
  }, [open]);

  useEffect(() => {
    if (current) document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    chosen.current = item;
    onClose();
  };

  return (
    <Modal open={open} label="Command palette" onClose={onClose} className="w-[min(560px,calc(100vw-32px))]">
      <div className="flex items-center gap-2.5 border-b border-line px-4">
        <Icon name="search" size={15} className="shrink-0 text-ink-3" />
        <input
          id="palette-input"
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={current ? optionId(current) : undefined}
          aria-label="Search tasks and actions"
          autoComplete="off"
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (results.length) setActive(index => (index + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              run(current);
            }
          }}
          placeholder="Search tasks and actions"
          className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
        />
        <kbd>Esc</kbd>
      </div>
      <div id="palette-results" role="listbox" aria-label="Results" className="scroll-thin max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
        {!results.length && <p className="px-3 py-6 text-center text-[13px] text-ink-3">Nothing matches "{query}"</p>}
        {results.map((item, index) => (
          <Fragment key={item.id}>
            {(index === 0 || results[index - 1].group !== item.group) && <MenuLabel>{item.group}</MenuLabel>}
            <button
              id={optionId(item)}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={item === current}
              onPointerMove={() => setActive(index)}
              onClick={() => run(item)}
              className={`flex h-9 w-full items-center gap-3 rounded-[8px] px-2.5 text-left text-[13px] transition-colors duration-75 ${item === current ? 'bg-hover-2 text-ink' : 'text-ink-2'}`}
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.detail && <span className="max-w-[45%] shrink-0 truncate text-[12px] text-ink-3">{item.detail}</span>}
            </button>
          </Fragment>
        ))}
      </div>
    </Modal>
  );
}
