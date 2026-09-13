import type { Repository } from '@shared/types';
import { Icon } from '@/components/atoms/Icon';
import { Logo } from '@/components/atoms/Logo';
import GlideMenu from '@/components/primitives/GlideMenu';
import { popIn } from '@/lib/motion';
import { repoName } from '@/lib/tasks';
import { usePopover } from '@/lib/usePopover';
import { MenuCheck, MenuDivider, MenuLabel, menuHighlight, menuItem, popoverClass } from './Menu';

type RepositoryMenuProps = {
  repository: Repository;
  repositories: Repository[];
  onSwitch: (path: string) => void;
  onAdd: () => void;
};

export default function RepositoryMenu({ repository, repositories, onSwitch, onAdd }: RepositoryMenuProps) {
  const { open, setOpen, ref } = usePopover();
  const choose = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        id="change-repo"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(state => !state)}
        title={repository.path}
        className={`flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left transition-[background-color,transform] duration-100 hover:bg-hover-2 active:scale-[0.99] ${open ? 'bg-hover-2' : ''}`}
      >
        <Logo />
        <span className="min-w-0 truncate text-[14px] font-medium text-ink">{repoName(repository.path)}</span>
        {repository.dirty && <span className="shrink-0 text-[11.5px] text-orange">uncommitted changes</span>}
        <Icon name="chevronDown" strokeWidth={2.2} className="ml-auto shrink-0 text-ink-3" />
      </button>
      {open && (
        <div role="menu" aria-label="Repositories" className={`${popoverClass} left-0 w-[268px]`} style={popIn(180, 'top left')}>
          <MenuLabel>Repositories</MenuLabel>
          <GlideMenu className="flex flex-col" highlightClassName={menuHighlight}>
            {repositories.map(repo => {
              const current = repo.path === repository.path;
              return (
                <button key={repo.path} type="button" role="menuitemradio" aria-checked={current} data-menu-row onClick={choose(() => !current && onSwitch(repo.path))} className="relative z-10 flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{repoName(repo.path)}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-3" title={repo.path}>{repo.path}</span>
                  </span>
                  <MenuCheck on={current} />
                </button>
              );
            })}
            <MenuDivider />
            <button type="button" role="menuitem" data-menu-row onClick={choose(onAdd)} className={menuItem}>
              <Icon name="plus" strokeWidth={2.2} />
              Add repository
            </button>
          </GlideMenu>
        </div>
      )}
    </div>
  );
}
