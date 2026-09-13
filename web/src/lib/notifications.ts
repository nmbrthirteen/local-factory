import type { TaskStatus } from '@shared/domain';
import { logoPath, logoTheme } from './logo';

export type NotifyMode = 'both' | 'banner' | 'sound' | 'off';
type TaskStatusLike = { id: string; status: TaskStatus; settled?: boolean | null };

export const notifyKey = 'factory-notify';
export const notifyModes: { value: NotifyMode; name: string; description: string }[] = [
  { value: 'both', name: 'Sound and banner', description: 'Chime, and a system banner while this tab is in the background' },
  { value: 'banner', name: 'Banner', description: 'System banner while this tab is in the background' },
  { value: 'sound', name: 'Sound', description: 'Chime when a task you are not viewing changes' },
  { value: 'off', name: 'Off', description: 'Only the count on the tab' },
];

const notifyStates: TaskStatus[] = ['awaiting_approval', 'handoff', 'failed'];
const reviewStates: TaskStatus[] = ['handoff', 'failed'];
const badgeColor = '#e8590c';

export const readNotifyMode = (): NotifyMode => {
  const stored = localStorage.getItem(notifyKey);
  return notifyModes.find(mode => mode.value === stored)?.value ?? 'banner';
};
export const wantsSound = (mode: NotifyMode) => mode === 'sound' || mode === 'both';
export const wantsBanner = (mode: NotifyMode) => mode === 'banner' || mode === 'both';
export const bannersBlocked = () => 'Notification' in window && Notification.permission === 'denied';

export function askForBanners() {
  if (wantsBanner(readNotifyMode()) && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

export function arrivals<T extends TaskStatusLike>(previous: ReadonlyMap<string, TaskStatus>, tasks: T[]) {
  return tasks.filter(task => {
    const before = previous.get(task.id);
    return before !== undefined && before !== task.status && notifyStates.includes(task.status);
  });
}

export function unseenAfter(current: ReadonlySet<string>, tasks: TaskStatusLike[], fresh: TaskStatusLike[]) {
  const known = new Map(tasks.map(task => [task.id, task]));
  const reviewable = (id: string) => {
    const task = known.get(id);
    return !task || (reviewStates.includes(task.status) && !task.settled);
  };
  const next = new Set([...current].filter(reviewable));
  for (const task of fresh) if (reviewStates.includes(task.status)) next.add(task.id);
  return next.size === current.size && [...next].every(id => current.has(id)) ? current : next;
}

export function without(set: ReadonlySet<string>, id: string | null) {
  if (!id || !set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}

export function faviconHref(count: number) {
  if (!count) return '/favicon.svg';
  const label = count > 9 ? '9+' : String(count);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><style>${logoTheme}</style><path d="${logoPath}" fill="currentColor"/><circle cx="27" cy="9" r="9" fill="${badgeColor}"/><text x="27" y="13" font-family="system-ui,sans-serif" font-size="${label.length > 1 ? 9 : 12}" font-weight="700" text-anchor="middle" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function showBadge(count: number) {
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = faviconHref(count);
}

let audio: AudioContext | undefined;

export function chime() {
  audio ??= new AudioContext();
  void audio.resume();
  const start = audio.currentTime;
  for (const [offset, frequency] of [[0, 880], [0.13, 1318.5]]) {
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.14, start + offset + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.28);
    tone.connect(gain).connect(audio.destination);
    tone.start(start + offset);
    tone.stop(start + offset + 0.3);
  }
}
