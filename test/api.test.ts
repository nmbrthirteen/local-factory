import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ApiServices } from '../backend/api';
import { taskPrompt } from '../backend/checks';
import { git } from '../backend/git';
import { Store } from '../backend/store';
import type { FactoryState, Task } from '../shared/types';
import { cleanupAfterEach, openSession, serveApi } from './support';

const onCleanup = cleanupAfterEach();

async function repository(path: string, message: string) {
  await mkdir(path, { recursive: true });
  await git(path, ['init']);
  await git(path, ['-c', 'user.name=Factory test', '-c', 'user.email=factory@example.invalid', 'commit', '--allow-empty', '-m', message]);
}

test('local API rejects cross-origin, unauthenticated and malformed requests, and serves real repositories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-api-'));
  const store = new Store(join(root, 'state.sqlite'));
  const { server, base } = serveApi({ store, root, runner: { recovery: [], runs: new Map() } as unknown as ApiServices['runner'] });
  onCleanup(async () => {
    server.stop(true);
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  expect((await fetch(`${base}/api/state`)).status).toBe(401);
  expect((await fetch(`${base}/api/session`, { method: 'POST', headers: { Origin: 'https://attacker.invalid' } })).status).toBe(403);
  const cookie = await openSession(base);
  expect(cookie).toStartWith('factory_session=');
  expect((await fetch(`${base}/api/state`, { headers: { Cookie: cookie } })).status).toBe(200);
  const json = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' };
  const post = (path: string, body: unknown) => fetch(`${base}/api${path}`, { method: 'POST', headers: json, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const state = async () => (await fetch(`${base}/api/state`, { headers: { Cookie: cookie } })).json() as Promise<FactoryState>;
  const read = <T>(response: Response) => response.json() as Promise<T>;

  expect((await post('/tasks', '{broken')).status).toBe(400);
  expect((await fetch(`${base}/api/tasks`, { method: 'POST', headers: { ...json, Origin: 'https://attacker.invalid' }, body: '{}' })).status).toBe(403);
  expect((await post('/tasks', 'x'.repeat(30_000))).status).toBe(413);
  expect(store.list()).toHaveLength(0);
  expect((await post('/preferences', { implementer: 'other' })).status).toBe(400);
  expect(await (await post('/preferences', { implementer: 'claude' })).json()).toEqual({ implementer: 'claude', models: {} });
  expect((await state()).preferences.implementer).toBe('claude');

  const repoPath = join(root, 'repo');
  await repository(repoPath, 'first');
  expect((await post('/repository', { path: repoPath, trusted: true })).status).toBe(200);
  await git(repoPath, ['-c', 'user.name=Factory test', '-c', 'user.email=factory@example.invalid', 'commit', '--allow-empty', '-m', 'second']);
  const created = await post('/tasks', { criteria: '  Build the first working version\nwith more detail', harness: 'claude', model: 'default' });
  const simple = await read<Task>(created);
  expect(created.status).toBe(201);
  expect(simple.title).toBe('Build the first working version');
  expect(simple.check).toEqual([]);
  expect(simple.repo.base).toBe(await git(repoPath, ['rev-parse', 'HEAD']));

  const patchPath = join(root, 'candidate.patch');
  await writeFile(patchPath, 'diff --git a/output.txt b/output.txt');
  const withPatch = store.create({ title: 'Patch', criteria: 'Patch', model: 'test', setup: [], check: [], repo: simple.repo, patch: { path: patchPath, bytes: 36 } });
  const patch = await fetch(`${base}/api/tasks/${withPatch.id}/patch`, { headers: { Cookie: cookie } });
  expect(await patch.json()).toEqual({ text: 'diff --git a/output.txt b/output.txt', bytes: 36, truncated: false });
  expect((await fetch(`${base}/api/tasks/00000000-0000-0000-0000-000000000000`, { headers: { Cookie: cookie } })).status).toBe(404);
  expect((await post(`/tasks/${withPatch.id}/command`, { command: 'revert' })).status).toBe(400);

  const first = (await state()).repository!.path;
  const otherPath = join(root, 'other');
  await repository(otherPath, 'other');
  expect((await post('/repository', { path: otherPath })).status).toBe(400);
  expect((await post('/repository', { path: otherPath, trusted: true })).status).toBe(200);
  const switched = await state();
  expect(switched.repositories.map(repo => repo.path)).toEqual([switched.repository!.path, first]);
  expect(switched.tasks).toHaveLength(0);
  const elsewhere = await read<Task>(await post('/tasks', { criteria: 'Work in the first repository', harness: 'codex', model: 'default', repository: first }));
  expect(elsewhere.repo.path).toBe(first);
  expect((await post('/tasks', { criteria: 'Unknown', harness: 'codex', model: 'default', repository: '/nowhere' })).status).toBe(400);
  expect((await post('/repository', { path: first })).status).toBe(200);

  const back = await state();
  expect(back.repository?.path).toBe(first);
  const target = back.tasks.find(task => task.title === 'Work in the first repository')!;
  expect((await post(`/tasks/${target.id}/reveal`, {})).status).toBe(400);
  expect((await post(`/tasks/${target.id}/settle`, { settled: 'yes' })).status).toBe(400);
  expect((await read<Task>(await post(`/tasks/${target.id}/settle`, { settled: true }))).settled).toBe(true);
  expect((await state()).tasks.find(task => task.id === target.id)?.settled).toBe(true);
  store.update(target.id, { status: 'running' });
  expect((await post(`/tasks/${target.id}/settle`, { settled: true })).status).toBe(400);
  expect(back.tasks.map(task => task.title)).toEqual(['Work in the first repository', 'Patch', 'Build the first working version']);

  const png = new Blob(['\x89PNG\r\n\x1a\n']);
  const upload = (type: string, body: Blob) => fetch(`${base}/api/uploads`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': type, 'X-Image-Name': 'shot%20one.png' }, body });
  expect((await upload('text/plain', png)).status).toBe(400);
  const uploaded = await read<{ id: string; name: string; mediaType: string; bytes: number }>(await upload('image/png', png));
  expect(uploaded).toMatchObject({ name: 'shot one.png', mediaType: 'image/png', bytes: png.size });
  const served = await fetch(`${base}/api/uploads/${uploaded.id}`, { headers: { Cookie: cookie } });
  expect(served.headers.get('content-type')).toBe('image/png');
  expect((await fetch(`${base}/api/uploads/nope.png`, { headers: { Cookie: cookie } })).status).toBe(400);
  expect((await post('/tasks', { criteria: 'With a missing image', harness: 'codex', model: 'default', images: [{ id: '00000000-0000-0000-0000-000000000000.png', name: 'gone.png' }] })).status).toBe(400);
  const illustrated = await read<Task>(await post('/tasks', { criteria: 'With an image', harness: 'codex', model: 'default', images: [{ id: uploaded.id, name: uploaded.name }] }));
  expect(illustrated.images).toEqual([{ id: uploaded.id, name: 'shot one.png', mediaType: 'image/png', bytes: png.size }]);
  expect(taskPrompt(illustrated, [], false)).toContain('One image is attached to this message: shot one.png.');
});

test('preview routes return the recorded preview, serve its screenshots, and retake on request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factory-api-preview-'));
  const store = new Store(join(root, 'state.sqlite'));
  const retaken: string[] = [];
  const runner = { recovery: [], runs: new Map(), retakePreview: async (id: string) => { retaken.push(id); return store.require(id); } };
  const { server, base } = serveApi({ store, root, runner: runner as unknown as ApiServices['runner'] });
  onCleanup(async () => {
    server.stop(true);
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const cookie = await openSession(base);
  const repo = { path: join(root, 'repo'), base: 'abc' };
  const task = store.create({ title: 'Previewed', criteria: 'Show it', model: 'test', setup: [], check: [], repo });
  const preview = (query = '') => fetch(`${base}/api/tasks/${task.id}/preview${query}`, { headers: { Cookie: cookie } });

  expect(await (await preview()).json()).toBeNull();
  const shot = join(root, 'desktop.png');
  await writeFile(shot, 'png bytes');
  store.update(task.id, { preview: { status: 'captured', candidate: 'tree', command: ['npm', 'run', 'dev'], source: 'detected', url: 'http://127.0.0.1:5173', shots: [{ name: 'desktop', width: 1280, height: 800, path: shot, bytes: 9 }], errors: [], at: new Date().toISOString(), durationMs: 10 } });
  expect((await (await preview()).json()).command).toEqual(['npm', 'run', 'dev']);
  const image = await preview('?shot=desktop');
  expect(image.headers.get('content-type')).toBe('image/png');
  expect(await image.text()).toBe('png bytes');
  expect((await preview('?shot=mobile')).status).toBe(404);
  const screenshot = store.event(task.id, 'screenshot', 'Desktop screenshot', { images: [{ name: 'desktop', width: 1280, height: 800, path: shot }] });
  const eventImage = (query: string) => fetch(`${base}/api/tasks/${task.id}/image${query}`, { headers: { Cookie: cookie } });
  expect(await (await eventImage(`?event=${screenshot.id}&index=0`)).text()).toBe('png bytes');
  expect((await eventImage(`?event=${screenshot.id}&index=1`)).status).toBe(404);
  expect((await eventImage('?event=abc')).status).toBe(404);
  const retake = await fetch(`${base}/api/tasks/${task.id}/preview`, { method: 'POST', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: '{}' });
  expect(retake.status).toBe(200);
  expect(retaken).toEqual([task.id]);
});
