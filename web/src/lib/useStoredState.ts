import { useState } from 'react';

export function useStoredState(key: string, fallback: string) {
  const [value, setValue] = useState(() => localStorage.getItem(key) ?? fallback);
  const store = (next: string) => {
    localStorage.setItem(key, next);
    setValue(next);
  };
  return [value, store] as const;
}
