import { afterEach } from 'bun:test';
import { type ApiRunner, type ApiServices, createApi } from '../backend/api';

type Cleanup = () => void | Promise<void>;

export type RunningAgent = { running: string | null };

export const idleAgent = (): RunningAgent => ({ running: null });

const unused = (): never => {
  throw new Error('This test double does not implement that runner method');
};

export const stubRunner = (overrides: Partial<ApiRunner> = {}): ApiRunner => ({
  recovery: [],
  runs: new Map(),
  probe: unused,
  recover: unused,
  start: unused,
  cancel: unused,
  answer: unused,
  setAutonomy: unused,
  retakePreview: unused,
  ...overrides,
});

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

export async function until(predicate: () => boolean | Promise<boolean>, { attempts = 200, delayMs = 25 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await predicate()) return;
    await Bun.sleep(delayMs);
  }

  throw new Error('Condition did not become true');
}
