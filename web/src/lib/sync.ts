export function refreshQueue(refresh: () => Promise<void>) {
  let running: Promise<void> | null = null;
  let pending = false;
  return function request() {
    pending = true;
    running ??= (async () => {
      try {
        while (pending) {
          pending = false;
          await refresh();
        }
      } finally {
        running = null;
      }
    })();
    return running;
  };
}

export function mergeEvents<T extends { id: number }>(current: T[], incoming: T[], limit = 200) {
  const byId = new Map([...current, ...incoming].map(event => [event.id, event]));
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(-limit);
}
