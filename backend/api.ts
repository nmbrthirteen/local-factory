import type { Server } from 'bun';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Preferences, Repository, Task } from '../shared/types';
import { Delivery } from './delivery';
import { inspectRepo } from './git';
import type { LiveApps } from './live';
import { chooseFolder } from './process';
import type { Runner } from './runner';
import { eventPageSize, type Store } from './store';
import { Terminal } from './terminal';
import { Uploads } from './uploads';
import { optionalCommand, text, titleFrom, validAutonomy, validHarness } from './validation';

const patchLimit = 1024 * 1024;
const bodyLimit = 24_000;
const heartbeatMs = 10_000;
const cookieName = 'factory_session';
const ok = { ok: true };
const encoder = new TextEncoder();

type Body = Record<string, any>;
type Context = { request: Request; url: URL; body: Body; server: Server };
type Handler = (context: Context) => Response | Promise<Response>;

export type ApiServices = {
  store: Store;
  root: string;
  runner: Pick<Runner, 'recovery' | 'runs' | 'probe' | 'recover' | 'start' | 'cancel' | 'answer' | 'setAutonomy' | 'retakePreview'>;
  delivery?: Delivery;
  terminal?: Terminal;
  live?: Pick<LiveApps, 'start' | 'stop'>;
};

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

async function readJson(request: Request): Promise<Body> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Use application/json');
  const raw = await request.text();
  if (Buffer.byteLength(raw) > bodyLimit) throw new HttpError(413, 'Request is too large');
  const body = JSON.parse(raw || '{}');
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object');
  return body;
}

function hasSession(request: Request, token: string) {
  const value = request.headers.get('cookie')?.split(/;\s*/).find(cookie => cookie.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';
  const given = Buffer.from(value);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function changeStream(store: Store, request: Request) {
  let release = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown = {}) => {
        if ((controller.desiredSize ?? 0) > 0) return controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        release();
        controller.close();
      };
      const change = () => send('change');
      const progress = (update: unknown) => send('progress', update);
      const heartbeat = setInterval(() => send('ping'), heartbeatMs);
      release = () => {
        clearInterval(heartbeat);
        store.off('change', change);
        store.progress.off('update', progress);
      };
      store.on('change', change);
      store.progress.on('update', progress);
      request.signal.addEventListener('abort', release, { once: true });
      change();
      for (const update of store.progress.current()) progress(update);
    },
    cancel: () => release(),
  }, { highWaterMark: 64 });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}

function activityStream(store: Store, id: string) {
  const lines = store.eventLog(id);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      let chunk = '';
      for (let count = 0; count < 100; count++) {
        const next = lines.next();
        if (next.done) {
          if (chunk) controller.enqueue(encoder.encode(chunk));
          controller.close();
          return;
        }
        chunk += next.value;
      }
      controller.enqueue(encoder.encode(chunk));
    },
    cancel: () => void lines.return(undefined),
  });
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson', 'Content-Disposition': `attachment; filename="${id}-activity.jsonl"`, 'Cache-Control': 'no-store' } });
}

async function readPatch({ patch }: Task) {
  if (!patch) throw new HttpError(404, 'No candidate diff recorded');
  return { text: await Bun.file(patch.path).slice(0, patchLimit).text(), bytes: patch.bytes, truncated: patch.bytes > patchLimit };
}

export function createApi({ store, root, runner, ...services }: ApiServices) {
  const token = randomBytes(32).toString('hex');
  const uploads = new Uploads(root);
  const isRunning = (id: string) => runner.runs.has(id);
  const delivery = services.delivery ?? new Delivery(store, isRunning);
  const terminal = services.terminal ?? new Terminal(store, isRunning);
  const live = () => {
    if (!services.live) throw new Error('Live apps are not available');
    return services.live;
  };

  const currentRepository = () => store.setting<Repository>('repository');
  const preferences = (): Preferences => ({ implementer: 'codex', models: {}, ...store.setting<Preferences>('preferences') });

  function savePreferences(body: Body) {
    const current = preferences();
    const implementer = body.implementer === undefined ? current.implementer : validHarness(body.implementer);
    const models = body.model === undefined ? current.models : { ...current.models, [validHarness(body.harness)]: text(body.model, 'Model', 150) };
    return store.setting<Preferences>('preferences', { implementer, models });
  }

  const repositories = () => {
    const current = currentRepository();
    return store.setting<Repository[]>('repositories') ?? (current ? [current] : []);
  };
  const isKnown = (path: unknown) => repositories().some(known => known.path === path);
  const remember = (repo: Repository, makeCurrent: boolean) => {
    if (makeCurrent) store.setting('repository', repo);
    store.setting('repositories', [repo, ...repositories().filter(known => known.path !== repo.path)].slice(0, 20));
  };

  function state(url: URL) {
    const current = currentRepository();
    const page = store.taskPage({
      query: url.searchParams.get('q') ?? '',
      filter: url.searchParams.get('filter') ?? 'all',
      before: Number(url.searchParams.get('before') ?? 0),
      repository: url.searchParams.get('all') === '1' ? '' : current?.path ?? '',
    });
    return {
      repository: current,
      repositories: repositories(),
      preferences: preferences(),
      ...page,
      needsYou: store.attentionCount(),
      recovery: runner.recovery.map(task => task.id),
      active: [...runner.runs.keys()],
    };
  }

  async function connectRepository(body: Body) {
    if (body.trusted !== true && !isKnown(body.path)) throw new Error('Confirm that you trust this repository and its scripts');
    const repo = await inspectRepo(body.path);
    remember(repo, true);
    return repo;
  }

  async function createTask(body: Body) {
    const current = currentRepository();
    const target = body.repository ?? current?.path;
    if (!target) throw new Error('Connect a repository first');
    if (!isKnown(target)) throw new Error('Connect this repository before creating tasks in it');
    const criteria = text(body.criteria, 'Description', 10_000);
    const input = {
      criteria,
      images: await uploads.attach(body.images),
      title: body.title?.trim() ? text(body.title, 'Title', 100) : titleFrom(criteria),
      harness: validHarness(body.harness),
      model: text(body.model, 'Model', 150),
      autonomy: validAutonomy(body.autonomy ?? 'ask'),
      setup: optionalCommand(body.setup, 'Setup'),
      check: optionalCommand(body.check, 'Check'),
    };
    const repo = await inspectRepo(target);
    remember(repo, repo.path === current?.path);
    return store.create({ ...input, repo });
  }

  function previewResponse(task: Task, shot: string | null) {
    if (!shot) return json(task.preview ?? null);
    const file = task.preview?.shots.find(item => item.name === shot);
    if (!file) throw new HttpError(404, 'No screenshot with that name');
    return new Response(Bun.file(file.path), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  }

  async function eventImage(id: string, url: URL) {
    const eventId = Number(url.searchParams.get('event'));
    const index = Number(url.searchParams.get('index') ?? 0);
    const image = Number.isSafeInteger(eventId) && eventId > 0 ? store.events(id, eventId - 1).find(event => event.id === eventId)?.details.images?.[index] : undefined;
    if (!image?.path || !(await Bun.file(image.path).exists())) throw new HttpError(404, 'No image with that reference');
    return new Response(Bun.file(image.path), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } });
  }

  function taskDetail(id: string, url: URL) {
    const after = Number(url.searchParams.get('after') ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid event cursor');
    const events = url.searchParams.get('events') === '0' ? [] : url.searchParams.get('latest') === '1' ? store.latestEvents(id) : store.events(id, after);
    const last = events.at(-1);
    return { task: store.require(id), events, hasMore: events.length === eventPageSize && Boolean(last) && store.hasEventsAfter(id, last!.id) };
  }

  const routes: Record<string, Handler> = {
    'GET /api/events': ({ request, server }) => {
      server.timeout(request, 0);
      return changeStream(store, request);
    },
    'GET /api/state': ({ url }) => json(state(url)),
    'POST /api/probe': async ({ body }) => json(await runner.probe(validHarness(body.harness))),
    'POST /api/preferences': ({ body }) => json(savePreferences(body)),
    'POST /api/recover': () => {
      runner.recover();
      return json(ok);
    },
    'POST /api/browse': async () => json({ path: await chooseFolder() }),
    'POST /api/uploads': async ({ request }) => json(await uploads.save(request), 201),
    'POST /api/repository': async ({ body }) => json(await connectRepository(body)),
    'POST /api/tasks': async ({ body }) => json(await createTask(body), 201),
  };

  const taskReads: Record<string, (id: string, context: Context) => Response | Promise<Response>> = {
    '': (id, { url }) => json(taskDetail(id, url)),
    activity: id => activityStream(store, id),
    patch: async id => json(await readPatch(store.require(id))),
    'pull-request': async id => json(await delivery.syncPullRequest(id)),
    preview: (id, { url }) => previewResponse(store.require(id), url.searchParams.get('shot')),
    image: (id, { url }) => eventImage(id, url),
  };

  const taskActions: Record<string, (id: string, body: Body) => unknown> = {
    start: id => runner.start(id),
    retry: (id, body) => runner.start(id, body.feedback ? text(body.feedback, 'Feedback', 4000) : ''),
    cancel: id => {
      runner.cancel(id);
      return ok;
    },
    answer: (id, body) => {
      runner.answer(id, String(body.key), body);
      return ok;
    },
    settings: (id, body) => runner.setAutonomy(id, body.autonomy),
    preview: id => runner.retakePreview(id),
    'app-start': id => live().start(id),
    'app-stop': id => live().stop(id),
    commit: id => delivery.commit(id),
    uncommit: id => delivery.uncommit(id),
    merge: id => delivery.merge(id),
    'pull-request': id => delivery.openPullRequest(id),
    command: (id, body) => delivery.runCommand(id, body.command),
    'command-run': (id, body) => terminal.start(id, body.command),
    'command-stop': id => terminal.stop(id),
    rollback: (id, body) => delivery.rollback(id, String(body.target)),
    remove: id => delivery.removeWorktree(id),
    settle: (id, body) => delivery.settle(id, body.settled),
    reveal: async id => {
      await delivery.reveal(id);
      return ok;
    },
  };

  const accepted = new Set(['start', 'retry']);
  const actionNames = [...new Set([...Object.keys(taskReads), ...Object.keys(taskActions)])].filter(Boolean).join('|');
  const taskPath = new RegExp(`^/api/tasks/([a-f0-9-]+)(?:/(${actionNames}))?$`);

  function uploadRoute(method: string, pathname: string): Handler | null {
    if (method !== 'GET' || !pathname.startsWith('/api/uploads/')) return null;
    const id = pathname.slice('/api/uploads/'.length);
    return async () => {
      const file = Bun.file(uploads.path(id));
      if (!(await file.exists())) throw new HttpError(404, 'No image with that reference');
      return new Response(file, { headers: { 'Content-Type': uploads.mediaType(id), 'Cache-Control': 'private, max-age=31536000, immutable' } });
    };
  }

  function taskRoute(method: string, pathname: string): Handler | null {
    const match = pathname.match(taskPath);
    if (!match) return null;
    const [, id, action = ''] = match;
    if (!store.get(id)) return () => { throw new HttpError(404, 'Task not found'); };
    const read = method === 'GET' ? taskReads[action] : undefined;
    if (read) return context => read(id, context);
    const act = method === 'POST' ? taskActions[action] : undefined;
    if (act) return async ({ body }) => json(await act(id, body), accepted.has(action) ? 202 : 200);
    return null;
  }

  return async function handle(request: Request, server: Server) {
    const url = new URL(request.url);
    const host = request.headers.get('host') ?? '';
    const origin = request.headers.get('origin');
    const sameOrigin = origin === `http://${host}`;
    if (![`localhost:${server.port}`, `127.0.0.1:${server.port}`].includes(host) || (origin && !sameOrigin)) return json({ error: 'Request origin is not allowed' }, 403);
    if (request.method !== 'GET' && !sameOrigin) return json({ error: 'A same-origin request is required' }, 403);
    const key = `${request.method} ${url.pathname}`;
    if (key === 'POST /api/session') return json(ok, 200, { 'Set-Cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api` });
    if (!hasSession(request, token)) return json({ error: 'Reconnect to the local service' }, 401);
    try {
      // The upload route reads the image bytes itself, so it is the one POST that skips JSON parsing.
      const body = request.method === 'POST' && key !== 'POST /api/uploads' ? await readJson(request) : {};
      const handler = routes[key] ?? uploadRoute(request.method, url.pathname) ?? taskRoute(request.method, url.pathname);
      if (!handler) throw new HttpError(404, 'Unknown API route');
      return await handler({ request, url, body, server });
    } catch (error) {
      return json({ error: (error as Error).message }, error instanceof HttpError ? error.status : 400);
    }
  };
}
