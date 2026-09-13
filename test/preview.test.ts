import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreviewSession, previewToolSpecs, runPreviewTool } from '../backend/browser';
import { capturePreview, detectPreview, namedPreview, resolvePreview, type Browser, type Capture } from '../backend/preview';
import type { Task } from '../shared/types';
import { cleanupAfterEach, until } from './support';

const onCleanup = cleanupAfterEach();

async function project(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'factory-preview-'));
  onCleanup(() => rm(root, { recursive: true, force: true }));
  const worktree = join(root, 'worktree');
  await mkdir(worktree);
  for (const [name, content] of Object.entries(files)) await writeFile(join(worktree, name), content);
  return { root, worktree, task: { id: 'preview-task', preview: null } as unknown as Task };
}

const fixtureApp = (outside: string) => `
const { writeFileSync } = require('node:fs');
try { writeFileSync(${JSON.stringify(outside)}, 'escaped'); console.log('outside write allowed'); } catch { console.log('outside write blocked'); }
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('<h1>Fixture app</h1>', { headers: { 'content-type': 'text/html' } }) });
console.log('Ready at http://127.0.0.1:' + server.port);
`;

test('the start command comes from the agent, the previous preview, or a package script', async () => {
  expect(namedPreview('Done.\n\nCHECK: npm test\nPREVIEW: `npm run dev -- --port 5000`')).toEqual(['npm', 'run', 'dev', '--', '--port', '5000']);
  expect(namedPreview('No preview here')).toEqual([]);
  const { worktree } = await project({ 'package.json': JSON.stringify({ scripts: { test: 'node --test', start: 'node server.js', dev: 'vite' } }) });
  expect(await detectPreview(worktree)).toEqual(['npm', 'run', 'dev']);
  await writeFile(join(worktree, 'bun.lock'), '');
  expect(await detectPreview(worktree)).toEqual(['bun', 'run', 'dev']);
  expect(await resolvePreview(worktree, 'PREVIEW: node app.js')).toEqual({ command: ['node', 'app.js'], source: 'agent' });
  expect(await resolvePreview(worktree, '', { command: ['node', 'kept.js'], source: 'agent' })).toEqual({ command: ['node', 'kept.js'], source: 'agent' });
  const empty = await project({});
  expect(await detectPreview(empty.worktree)).toEqual([]);
  expect(await capturePreview({ task: empty.task, cwd: empty.worktree, root: empty.root, candidate: 'tree' })).toBeNull();
});

test('the app starts in a loopback-only sandbox, is captured at the address it prints, and stops afterwards', async () => {
  const { root, worktree, task } = await project({});
  const outside = join(root, 'outside.txt');
  await writeFile(join(worktree, 'app.js'), fixtureApp(outside));
  const pages: string[] = [];
  const capture: Capture = async (url, directory) => {
    pages.push(await (await fetch(url)).text());
    const path = join(directory, 'desktop.png');
    await writeFile(path, 'png');
    return { shots: [{ name: 'desktop', width: 1440, height: 900, path, bytes: 3 }], errors: ['TypeError: x is undefined'] };
  };
  const preview = await capturePreview({ task, cwd: worktree, root, candidate: 'tree1', message: `PREVIEW: ${process.execPath} app.js`, capture });
  expect(preview?.status).toBe('captured');
  expect(preview?.source).toBe('agent');
  expect(preview?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(pages).toEqual(['<h1>Fixture app</h1>']);
  expect(preview?.shots.map(shot => shot.path)).toEqual([join(root, '.factory/artifacts/preview-task/tree1/preview/desktop.png')]);
  expect(preview?.errors).toEqual(['TypeError: x is undefined']);
  expect(preview?.log).toContain('outside write blocked');
  expect(await Bun.file(outside).exists()).toBe(false);
  await until(async () => !(await fetch(preview!.url!).then(() => true, () => false)), { attempts: 80, delayMs: 50 });
});

test('an app that exits or never answers records a failed preview with its output', async () => {
  const { root, worktree, task } = await project({ 'crash.js': "console.error('missing config'); process.exit(2);" });
  const preview = await capturePreview({ task, cwd: worktree, root, candidate: 'tree2', message: `PREVIEW: ${process.execPath} crash.js`, capture: async () => { throw new Error('capture should not run'); } });
  expect(preview?.status).toBe('failed');
  expect(preview?.note).toBe('The app exited with 2 before it was ready');
  expect(preview?.log).toContain('missing config');
  expect(preview?.shots).toEqual([]);
});

function fakeBrowser(outputs: Record<string, string>) {
  const calls: string[][] = [];
  const browser: Browser = async (_session, args) => {
    calls.push(args);
    if (args[0] === 'screenshot') await writeFile(args[1], 'png');
    if (args.join(' ') === 'click #missing') throw Object.assign(new Error('agent-browser exited with 1'), { stderr: '✗ Element not found' });
    return outputs[args.join(' ')] ?? '';
  };
  return { browser, calls };
}

function serve(body: string) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(body) });
  onCleanup(() => server.stop(true));
  return server;
}

const notRunning = { content: [{ type: 'text' as const, text: 'The app is not running. Call preview_open first.' }], error: true };

test('agent preview tools run the app with the factory port blocked and drive the browser', async () => {
  const { root, worktree, task } = await project({});
  const factory = serve('factory');
  const other = serve('other');
  await writeFile(join(worktree, 'app.js'), `
fetch('http://127.0.0.1:${factory.port}/').then(() => console.log('factory reachable'), () => console.log('factory blocked'));
fetch('http://127.0.0.1:${other.port}/').then(() => console.log('loopback reachable'), () => console.log('loopback blocked'));
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('<h1>Fixture</h1>', { headers: { 'content-type': 'text/html' } }) });
console.log('Ready at http://127.0.0.1:' + server.port);
`);
  const { browser, calls } = fakeBrowser({
    errors: 'TypeError: boom',
    console: '[error] failed\n[log] hi',
    'network requests': '[1] GET http://127.0.0.1:1/ (Document) 200\n[2] GET http://127.0.0.1:1/api (Fetch) 500',
    snapshot: '- button "Save" [ref=e1]',
  });
  const session = new PreviewSession({ task, cwd: worktree, root, servicePort: factory.port, browser });
  onCleanup(() => session.close());

  expect(await runPreviewTool(session, 'preview_logs', {})).toEqual(notRunning);
  expect((await runPreviewTool(session, 'preview_interact', { action: 'hover' })).error).toBe(true);

  const opened = await runPreviewTool(session, 'preview_open', { command: `${process.execPath} app.js`, path: '/settings' });
  const [summary, image] = opened.content;
  expect(opened.error).toBeUndefined();
  expect(summary.type === 'text' && summary.text).toMatch(/^Opened http:\/\/127\.0\.0\.1:\d+\/settings with .+app\.js\.\nErrors:\nTypeError: boom\n\[error\] failed$/);
  expect(image).toMatchObject({ type: 'image', data: Buffer.from('png').toString('base64') });
  expect(calls.find(args => args[0] === 'open')?.[1]).toMatch(/\/settings$/);
  expect((await session.open({ path: 'https://example.com/' })).error).toBe(true);

  const logText = async () => { const [item] = (await session.logs()).content; return item.type === 'text' ? item.text : ''; };
  await until(async () => {
    const text = await logText();
    return /factory (blocked|reachable)/.test(text) && /loopback (blocked|reachable)/.test(text);
  }, { attempts: 80, delayMs: 50 });
  const logs = await logText();
  expect(logs).toContain('factory blocked');
  expect(logs).toContain('loopback reachable');
  expect(logs).toContain('Failed requests:\n[2] GET http://127.0.0.1:1/api (Fetch) 500');
  expect(logs).not.toContain('(Document) 200');

  expect(await runPreviewTool(session, 'preview_interact', { action: 'snapshot' })).toEqual({ content: [{ type: 'text', text: '- button "Save" [ref=e1]' }] });
  expect(await runPreviewTool(session, 'preview_interact', { action: 'click', target: '#missing' })).toEqual({ content: [{ type: 'text', text: '✗ Element not found' }], error: true });
  expect((await runPreviewTool(session, 'preview_screenshot', { viewport: 'mobile' })).content[0]).toMatchObject({ type: 'image' });
  expect(calls).toContainEqual(['set', 'viewport', '390', '844']);

  const url = summary.type === 'text' ? summary.text.match(/http:\/\/127\.0\.0\.1:\d+/)![0] : '';
  await session.close();
  expect(calls.at(-1)).toEqual(['close']);
  expect(await runPreviewTool(session, 'preview_screenshot', {})).toEqual(notRunning);
  await until(async () => !(await fetch(url).then(() => true, () => false)), { attempts: 80, delayMs: 50 });
});

test('preview tools explain a missing start command and publish JSON schemas', async () => {
  const { root, worktree, task } = await project({});
  const session = new PreviewSession({ task, cwd: worktree, root, browser: fakeBrowser({}).browser });
  expect(await session.open({})).toEqual({ content: [{ type: 'text', text: 'No start command found. Pass command, for example npm run dev.' }], error: true });
  expect(previewToolSpecs().map(spec => spec.name)).toEqual(['preview_open', 'preview_screenshot', 'preview_logs', 'preview_interact']);
  expect(previewToolSpecs().find(spec => spec.name === 'preview_interact')?.inputSchema).toMatchObject({ type: 'object', required: ['action'] });
});
