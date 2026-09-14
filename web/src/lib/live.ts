import type { ProgressEvent, TaskImage } from '@shared/types';

const reconnectDelayMs = 1500;
const staleAfterMs = 30_000;
const fallbackRefreshMs = 15_000;

export async function api<T = unknown>(path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
  const request: RequestInit = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(`/api${path}`, { signal: AbortSignal.timeout(timeoutMs), ...request });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

export async function uploadImage(file: File): Promise<TaskImage> {
  const response = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Image-Name': encodeURIComponent(file.name) }, body: file });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

export function connectLive(refresh: () => unknown, status: (status: string) => void, onProgress?: (event: ProgressEvent) => void) {
  let stream: EventSource | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let connecting = false;

  const heartbeat = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(reconnect, staleAfterMs);
  };

  function reconnect() {
    stream?.close();
    clearTimeout(watchdog);
    clearTimeout(retry);
    if (stopped) return;
    status('Reconnecting');
    retry = setTimeout(connect, reconnectDelayMs);
  }

  async function connect() {
    if (stopped || connecting) return;
    connecting = true;
    try {
      await api('/session', {});
      if (stopped) return;
      refresh();
      stream = new EventSource('/api/events');
      heartbeat();
      stream.onopen = () => {
        status('Live');
        heartbeat();
        refresh();
      };
      stream.addEventListener('change', () => {
        heartbeat();
        refresh();
      });
      stream.addEventListener('progress', event => {
        heartbeat();
        onProgress?.(JSON.parse((event as MessageEvent<string>).data));
      });
      stream.addEventListener('ping', heartbeat);
      stream.onerror = reconnect;
    } catch {
      reconnect();
    } finally {
      connecting = false;
    }
  }

  const resume = () => {
    if (document.visibilityState !== 'visible') return;
    refresh();
    if (stream?.readyState !== EventSource.OPEN) reconnect();
  };
  const fallback = setInterval(refresh, fallbackRefreshMs);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  connect();

  return () => {
    stopped = true;
    stream?.close();
    clearTimeout(retry);
    clearTimeout(watchdog);
    clearInterval(fallback);
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', resume);
  };
}
