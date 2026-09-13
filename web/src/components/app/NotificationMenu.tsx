import { Icon } from '@/components/atoms/Icon';
import GlideMenu from '@/components/primitives/GlideMenu';
import { popIn } from '@/lib/motion';
import { askForBanners, bannersBlocked, chime, notifyKey, notifyModes, readNotifyMode, wantsBanner, wantsSound, type NotifyMode } from '@/lib/notifications';
import { usePopover } from '@/lib/usePopover';
import { useStoredState } from '@/lib/useStoredState';
import { MenuCheck, MenuLabel, menuHighlight, popoverClass } from './Menu';

export default function NotificationMenu() {
  const { open, setOpen, ref } = usePopover();
  const [stored, store] = useStoredState(notifyKey, readNotifyMode());
  const mode = stored as NotifyMode;
  const current = notifyModes.find(option => option.value === mode) ?? notifyModes[1];

  const choose = (next: NotifyMode) => {
    store(next);
    setOpen(false);
    if (wantsBanner(next)) askForBanners();
    if (wantsSound(next)) chime();
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        id="notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Notifications: ${current.name}`}
        title="Notifications"
        onClick={() => setOpen(state => !state)}
        className={`flex size-8 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-100 hover:bg-hover-2 hover:text-ink active:scale-[0.96] ${open ? 'bg-hover-2 text-ink' : 'text-ink-3'}`}
      >
        <Icon name={mode === 'off' ? 'bellOff' : 'bell'} size={15} />
      </button>
      {open && (
        <div role="menu" aria-label="Notifications" className={`${popoverClass} right-0 w-64`} style={popIn(180, 'top right')}>
          <MenuLabel>Notify when a task needs you or finishes</MenuLabel>
          <GlideMenu className="flex flex-col" highlightClassName={menuHighlight}>
            {notifyModes.map(option => (
              <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === mode} data-menu-row onClick={() => choose(option.value)} className="relative z-10 flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{option.name}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-3">{option.description}</span>
                </span>
                <MenuCheck on={option.value === mode} />
              </button>
            ))}
          </GlideMenu>
          {wantsBanner(mode) && bannersBlocked() && <p className="px-2 pt-1 pb-1.5 text-[11.5px] leading-snug text-orange">Your browser blocks banners for this site. Allow notifications in its site settings.</p>}
        </div>
      )}
    </div>
  );
}
