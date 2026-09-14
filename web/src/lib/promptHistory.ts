import { useRef, type KeyboardEvent } from 'react';

const historyLimit = 50;

export function pushHistory(history: string[], text: string, limit = historyLimit) {
  const entry = text.trim();
  if (!entry) return history;
  return [entry, ...history.filter(item => item !== entry)].slice(0, limit);
}

export function stepHistory(length: number, index: number, key: string) {
  if (key === 'ArrowUp') return Math.min(index + 1, length - 1);
  if (key === 'ArrowDown') return Math.max(index - 1, -1);
  return index;
}

function readHistory(key: string): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(stored) ? stored.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function usePromptHistory(key: string) {
  const position = useRef(-1);

  const record = (text: string) => {
    localStorage.setItem(key, JSON.stringify(pushHistory(readHistory(key), text)));
    position.current = -1;
  };

  // Recall only replaces an empty field or an unedited recalled entry, so arrow keys still move the caret in real text.
  const recall = (event: KeyboardEvent<HTMLTextAreaElement>, value: string, setValue: (value: string) => void) => {
    if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const history = readHistory(key);
    const browsing = position.current >= 0 && value === history[position.current];
    if (value && !browsing) {
      position.current = -1;
      return;
    }
    const next = stepHistory(history.length, position.current, event.key);
    if (next === position.current) return;
    event.preventDefault();
    position.current = next;
    setValue(next < 0 ? '' : history[next]);
  };

  return { record, recall };
}
