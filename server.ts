import { join } from 'node:path';
import { createApi } from './backend/api';
import { serveAsset } from './backend/assets';
import { Delivery } from './backend/delivery';
import { LiveApps } from './backend/live';
import { Runner } from './backend/runner';
import { Store } from './backend/store';
import { Terminal } from './backend/terminal';

const root = import.meta.dir;
const dist = join(root, 'dist');
const port = Number(Bun.env.PORT ?? 4310);

const store = new Store(join(root, '.factory/state.sqlite'));
const isRunning = (id: string) => runner.runs.has(id);
const live = new LiveApps(store, isRunning, { root, servicePort: port });
const runner = new Runner(store, root, { servicePort: port, live });
const delivery = new Delivery(store, isRunning, live);
const terminal = new Terminal(store, isRunning);
const api = createApi({ store, root, runner, delivery, terminal, live });

const server = Bun.serve({
  hostname: '127.0.0.1',
  port,
  idleTimeout: 30,
  fetch(request, server) {
    const { pathname } = new URL(request.url);
    return pathname.startsWith('/api/') ? api(request, server) : serveAsset(dist, pathname);
  },
});

let stopping = false;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  server.stop(true);
  await Promise.all([runner.shutdown(), terminal.stopAll(), live.stopAll()]);
  store.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
console.log(`Local Factory: http://localhost:${server.port}`);
