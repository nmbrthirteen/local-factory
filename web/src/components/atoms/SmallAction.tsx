import { useState } from 'react';

const copiedMs = 1500;

export const smallAction = 'flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[12px] font-medium transition-colors duration-100 hover:bg-hover disabled:pointer-events-none disabled:opacity-50';

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(text).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), copiedMs);
  });
  return <button type="button" onClick={copy} className={`${smallAction} ${copied ? 'text-green' : 'text-ink-3 hover:text-ink'}`}>{copied ? 'Copied' : 'Copy'}</button>;
}
