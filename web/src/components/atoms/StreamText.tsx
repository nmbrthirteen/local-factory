import { useEffect, useEffectEvent, useState } from 'react';

type StreamTextProps = {
  text: string;
  charsPerTick?: number;
  tickMs?: number;
  blurTail?: number;
  className?: string;
  onProgress?: () => void;
  onDone?: () => void;
};

export function StreamText({ text, charsPerTick = 2, tickMs = 9, blurTail = 6, className, onProgress, onDone }: StreamTextProps) {
  const [count, setCount] = useState(0);
  const progress = useEffectEvent(() => onProgress?.());
  const done = useEffectEvent(() => onDone?.());

  useEffect(() => {
    setCount(0);
    let shown = 0;
    const timer = setInterval(() => {
      shown = Math.min(shown + charsPerTick, text.length);
      setCount(shown);
      progress();
      if (shown < text.length) return;
      clearInterval(timer);
      done();
    }, tickMs);
    return () => clearInterval(timer);
  }, [text, charsPerTick, tickMs]);

  const visible = text.slice(0, count);
  const split = count < text.length ? Math.max(0, count - blurTail) : count;

  return (
    <span className={className}>
      {visible.slice(0, split)}
      {split < visible.length && <span className="stream-tail">{visible.slice(split)}</span>}
    </span>
  );
}
