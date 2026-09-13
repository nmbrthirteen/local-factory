import { afterEach } from 'bun:test';
import { createApi, type ApiServices } from '../backend/api';

type Cleanup = () => unknown;

export function cleanupAfterEach() {
  const cleanups: Cleanup[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });
  return (cleanup: Cleanup) => void cleanups.push(cleanup);
}

export function serveApi(services: ApiServices, port = 0) {
  const api = createApi(services);
  const server = Bun.serve({ hostname: '127.0.0.1', port, fetch: (request, server) => api(request, server) });
  return { server, base: `http://127.0.0.1:${server.port}` };
}

export async function openSession(base: string) {
  const response = await fetch(`${base}/api/session`, { method: 'POST', headers: { Origin: base } });
  return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

export async function until(predicate: () => unknown, { attempts = 200, delayMs = 25 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (predicate()) return;
    await Bun.sleep(delayMs);
  }
  throw new Error('Condition did not become true');
}
