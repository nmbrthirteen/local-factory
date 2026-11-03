import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Server } from 'bun';
import { z } from 'zod';
import { type Json, type JsonObject, jsonObjectSchema } from '../shared/json';
import type { Preferences, ProgressUpdate, Repository, Task } from '../shared/types';
import { Delivery } from './delivery';
import { thrownSchema } from './failure';
import { inspectRepo } from './git';
import type { LiveApps } from './live';
import { chooseFolder } from './process';
import type { Runner } from './runner';
import { eventPageSize, type Store } from './store';
import { Terminal } from './terminal';
import { attachmentsField, Uploads } from './uploads';
import {
  answerBody,
  autonomyField,
  commandField,
  harnessField,
  repositoryPathField,
  settledField,
  textField,
  titleFrom,
} from './validation';

const patchLimit = 1024 * 1024;
const bodyLimit = 24_000;
const heartbeatMs = 10_000;
const cookieName = 'factory_session';
const ok = { ok: true };
const encoder = new TextEncoder();

type Body = JsonObject;

type Context = { request: Request; url: URL; body: Body; server: Server };

type Handler = (context: Context) => Response | Promise<Response>;

export type ApiRunner = Pick<
  Runner,
  'probe' | 'recover' | 'start' | 'cancel' | 'answer' | 'setAutonomy' | 'retakePreview'
> & { recovery: Pick<Task, 'id'>[]; runs: Pick<ReadonlyMap<string, unknown>, 'has' | 'keys'> };

export type ApiServices = {
  store: Store;
  root: string;
  runner: ApiRunner;
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

const json = <T>(body: T, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

async function readJson(request: Request): Promise<Body> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new HttpError(415, 'Use application/json');
  const raw = await request.text();

  if (Buffer.byteLength(raw) > bodyLimit) throw new HttpError(413, 'Request is too large');
  const body = jsonObjectSchema.safeParse(JSON.parse(raw || '{}'));

  if (!body.success) throw new Error('Expected a JSON object');

  return body.data;
}

function hasSession(request: Request, token: string) {
  const value =
    request.headers
      .get('cookie')
      ?.split(/;\s*/)
      .find(cookie => cookie.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) ?? '';

  const given = Buffer.from(value);
  const expected = Buffer.from(token);

  return given.length === expected.length && timingSafeEqual(given, expected);
}

function changeStream(store: Store, request: Request) {
  let release = () => {};

  const body = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        const send = (event: string, data: Json = {}) => {
          if ((controller.desiredSize ?? 0) > 0)
            return controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          release();
          controller.close();
        };

        const change = () => send('change');
        const progress = (update: ProgressUpdate) => send('progress', update);
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
    },
    { highWaterMark: 64 },
  );

  return new Response(body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
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

  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': `attachment; filename="${id}-activity.jsonl"`,
      'Cache-Control': 'no-store',
    },
  });
}

async function readPatch({ patch }: Task) {
  if (!patch) throw new HttpError(404, 'No candidate diff recorded');

  return {
    text: await Bun.file(patch.path).slice(0, patchLimit).text(),
    bytes: patch.bytes,
    truncated: patch.bytes > patchLimit,
  };
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

  const preferences = (): Preferences => ({
    implementer: 'codex',
    models: {},
    ...store.setting<Preferences>('preferences'),
  });

  function savePreferences(body: Body) {
    const current = preferences();
    const implementer = body.implementer === undefined ? current.implementer : harnessField.parse(body.implementer);

    const models =
      body.model === undefined
        ? current.models
        : { ...current.models, [harnessField.parse(body.harness)]: textField('Model', 150).parse(body.model) };

    return store.setting<Preferences>('preferences', { implementer, models });
  }

  const repositories = () => {
    const current = currentRepository();

    return store.setting<Repository[]>('repositories') ?? (current ? [current] : []);
  };

  const isKnown = (path: Json | undefined) => repositories().some(known => known.path === path);

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
      repository: url.searchParams.get('all') === '1' ? '' : (current?.path ?? ''),
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
    if (body.trusted !== true && !isKnown(body.path))
      throw new Error('Confirm that you trust this repository and its scripts');
    const repo = await inspectRepo(repositoryPathField.parse(body.path));
    remember(repo, true);

    return repo;
  }

  async function createTask(body: Body) {
    const current = currentRepository();
    const target = body.repository ?? current?.path;

    if (!target) throw new Error('Connect a repository first');

    if (!isKnown(target)) throw new Error('Connect this repository before creating tasks in it');
    const criteria = textField('Description', 10_000).parse(body.criteria);

    const givenTitle = z
      .string()
      .refine(value => value.trim() !== '')
      .safeParse(body.title);

    const input = {
      criteria,
      attachments: await uploads.attach(attachmentsField.parse(body.attachments)),
      title: givenTitle.success ? textField('Title', 100).parse(givenTitle.data) : titleFrom(criteria),
      harness: harnessField.parse(body.harness),
      model: textField('Model', 150).parse(body.model),
      autonomy: autonomyField.parse(body.autonomy ?? 'ask'),
      setup: commandField('Setup').parse(body.setup),
      check: commandField('Check').parse(body.check),
    };

    const repo = await inspectRepo(repositoryPathField.parse(target));
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

    const image =
      Number.isSafeInteger(eventId) && eventId > 0
        ? store.events(id, eventId - 1).find(event => event.id === eventId)?.details.images?.[index]
        : undefined;

    if (!image?.path || !(await Bun.file(image.path).exists()))
      throw new HttpError(404, 'No image with that reference');

    return new Response(Bun.file(image.path), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  }

  function taskDetail(id: string, url: URL) {
    const after = Number(url.searchParams.get('after') ?? 0);

    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid event cursor');

    const events =
      url.searchParams.get('events') === '0'
        ? []
        : url.searchParams.get('latest') === '1'
          ? store.latestEvents(id)
          : store.events(id, after);

    const last = events.at(-1);

    return {
      task: store.require(id),
      events,
      hasMore: events.length === eventPageSize && Boolean(last) && store.hasEventsAfter(id, last!.id),
    };
  }

  const routes = {
    'GET /api/events': ({ request, server }) => {
      server.timeout(request, 0);

      return changeStream(store, request);
    },
    'GET /api/state': ({ url }) => json(state(url)),
    'POST /api/probe': async ({ body }) => json(await runner.probe(harnessField.parse(body.harness))),
    'POST /api/preferences': ({ body }) => json(savePreferences(body)),
    'POST /api/recover': () => {
      runner.recover();

      return json(ok);
    },
    'POST /api/browse': async () => json({ path: await chooseFolder() }),
    'POST /api/uploads': async ({ request }) => json(await uploads.save(request), 201),
    'POST /api/repository': async ({ body }) => json(await connectRepository(body)),
    'POST /api/tasks': async ({ body }) => json(await createTask(body), 201),
  } satisfies Record<string, Handler>;

  const isRoute = (key: string): key is keyof typeof routes => Object.hasOwn(routes, key);

  const taskReads = {
    '': (id, { url }) => json(taskDetail(id, url)),
    activity: id => activityStream(store, id),
    patch: async id => json(await readPatch(store.require(id))),
    'pull-request': async id => json(await delivery.syncPullRequest(id)),
    preview: (id, { url }) => previewResponse(store.require(id), url.searchParams.get('shot')),
    image: (id, { url }) => eventImage(id, url),
  } satisfies Record<string, (id: string, context: Context) => Response | Promise<Response>>;

  const isTaskRead = (action: string): action is keyof typeof taskReads => Object.hasOwn(taskReads, action);

  const taskActions = {
    start: id => runner.start(id),
    retry: (id, body) => runner.start(id, body.feedback ? textField('Feedback', 4000).parse(body.feedback) : ''),
    cancel: id => {
      runner.cancel(id);

      return ok;
    },
    answer: (id, body) => {
      runner.answer(id, String(body.key), answerBody.parse(body));

      return ok;
    },
    settings: (id, body) => runner.setAutonomy(id, autonomyField.parse(body.autonomy)),
    preview: id => runner.retakePreview(id),
    'app-start': id => live().start(id),
    'app-stop': id => live().stop(id),
    commit: id => delivery.commit(id),
    uncommit: id => delivery.uncommit(id),
    merge: (id, body) => delivery.merge(id, body.unchecked === true),
    'pull-request': (id, body) => delivery.openPullRequest(id, body.unchecked === true),
    command: (id, body) => delivery.runCommand(id, z.string().parse(body.command)),
    'command-run': (id, body) => terminal.start(id, z.string({ error: 'Choose a command to run' }).parse(body.command)),
    'command-stop': id => terminal.stop(id),
    rollback: (id, body) => delivery.rollback(id, String(body.target)),
    remove: id => delivery.removeWorktree(id),
    settle: (id, body) => delivery.settle(id, settledField.parse(body.settled)),
    reveal: async id => {
      await delivery.reveal(id);

      return ok;
    },
  } satisfies Record<string, (id: string, body: Body) => object | Promise<object>>;

  const isTaskAction = (action: string): action is keyof typeof taskActions => Object.hasOwn(taskActions, action);

  const accepted = new Set(['start', 'retry']);
  const actionNames = [...new Set([...Object.keys(taskReads), ...Object.keys(taskActions)])].filter(Boolean).join('|');
  const taskPath = new RegExp(`^/api/tasks/([a-f0-9-]+)(?:/(${actionNames}))?$`);

  function uploadRoute(method: string, pathname: string): Handler | null {
    if (method !== 'GET' || !pathname.startsWith('/api/uploads/')) return null;
    const id = pathname.slice('/api/uploads/'.length);

    return async () => {
      const file = Bun.file(uploads.path(id));

      if (!(await file.exists())) throw new HttpError(404, 'No attachment with that reference');

      return new Response(file, {
        headers: {
          'Content-Type': uploads.describe(id).mediaType,
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      });
    };
  }

  function taskRoute(method: string, pathname: string): Handler | null {
    const match = pathname.match(taskPath);

    if (!match) return null;
    const [, id, action = ''] = match;

    if (!store.get(id))
      return () => {
        throw new HttpError(404, 'Task not found');
      };

    if (method === 'GET' && isTaskRead(action)) {
      const read = taskReads[action];

      return context => read(id, context);
    }

    if (method === 'POST' && isTaskAction(action)) {
      const act = taskActions[action];

      return async ({ body }) => json(await act(id, body), accepted.has(action) ? 202 : 200);
    }

    return null;
  }

  return async function handle(request: Request, server: Server) {
    const url = new URL(request.url);
    const host = request.headers.get('host') ?? '';
    const origin = request.headers.get('origin');
    const sameOrigin = origin === `http://${host}`;

    if (![`localhost:${server.port}`, `127.0.0.1:${server.port}`].includes(host) || (origin && !sameOrigin))
      return json({ error: 'Request origin is not allowed' }, 403);

    if (request.method !== 'GET' && !sameOrigin) return json({ error: 'A same-origin request is required' }, 403);
    const key = `${request.method} ${url.pathname}`;

    if (key === 'POST /api/session')
      return json(ok, 200, { 'Set-Cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/api` });

    if (!hasSession(request, token)) return json({ error: 'Reconnect to the local service' }, 401);

    try {
      // The upload route reads the file bytes itself, so it is the one POST that skips JSON parsing.
      const body = request.method === 'POST' && key !== 'POST /api/uploads' ? await readJson(request) : {};

      const handler =
        (isRoute(key) ? routes[key] : null) ??
        uploadRoute(request.method, url.pathname) ??
        taskRoute(request.method, url.pathname);

      if (!handler) throw new HttpError(404, 'Unknown API route');

      return await handler({ request, url, body, server });
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? (error.issues[0]?.message ?? 'Invalid request')
          : thrownSchema.parse(error).message;

      return json({ error: message }, error instanceof HttpError ? error.status : 400);
    }
  };
}
