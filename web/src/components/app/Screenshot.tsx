import { useState } from 'react';
import type { PreviewShot } from '@shared/types';
import { Button } from '@/components/atoms/Button';
import Modal from '@/components/primitives/Modal';

export const shotLabels = { desktop: 'Desktop', mobile: 'Phone' };

type ScreenshotProps = { src: string; shot: Pick<PreviewShot, 'name' | 'width' | 'height'>; alt: string; className?: string; imageClassName?: string };

export default function Screenshot({ src, shot, alt, className = '', imageClassName = 'h-auto w-full' }: ScreenshotProps) {
  const [open, setOpen] = useState(false);
  const description = `${alt}, ${shotLabels[shot.name].toLowerCase()} at ${shot.width} by ${shot.height} pixels`;
  const width = shot.name === 'mobile' ? 'w-[min(430px,calc(100vw-32px))]' : 'w-[min(1320px,calc(100vw-32px))]';

  return (
    <>
      <button type="button" aria-label={`View ${description}`} onClick={() => setOpen(true)} className={`block shrink-0 cursor-zoom-in overflow-hidden bg-inset shadow-card ${className}`}>
        <img src={src} alt={description} loading="lazy" className={`block ${imageClassName}`} />
      </button>
      <Modal open={open} label={description} onClose={() => setOpen(false)} className={width}>
        {open && (
          <div className="flex max-h-[calc(100dvh-48px)] flex-col">
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4 text-[13px]">
              <span className="font-medium text-ink">{shotLabels[shot.name]}</span>
              <span className="tabular-nums text-ink-3">{shot.width}×{shot.height}</span>
              <a href={src} target="_blank" rel="noreferrer" className="ml-auto rounded-[6px] px-2 py-1 text-[12.5px] text-ink-2 hover:bg-hover hover:text-ink">Open file</a>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
            </div>
            <div className="scroll-thin min-h-0 overflow-auto bg-inset">
              <img src={src} alt={description} className="block h-auto w-full" />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
