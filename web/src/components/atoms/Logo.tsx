import { logoPath } from '@/lib/logo';

export function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 36 36" aria-hidden className="shrink-0 text-ink">
      <path d={logoPath} fill="currentColor" />
    </svg>
  );
}
