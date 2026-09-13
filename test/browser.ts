import type { Server } from 'bun';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createApi, type ApiServices } from '../backend/api';
import { serveAsset } from '../backend/assets';
import { Store } from '../backend/store';
import { agentBrowser } from './agent-browser';

const root = join(import.meta.dir, '..');
const dist = join(root, 'dist');
const screenshots = Bun.env.SCREENSHOTS ?? '/tmp';
const { browser, evaluate, waitFor } = agentBrowser('factory-regression');
const noOverflow = 'document.documentElement.scrollWidth <= innerWidth';

if (!Bun.env.SKIP_BUILD) await Bun.$`bun --bun vite build --logLevel warn`.cwd(root);

const store = new Store(':memory:');
const repo = { path: '/tmp/browser-test-repository', base: '1234567890abcdef' };
store.setting('repository', { ...repo, dirty: false });
store.setting('preferences', { implementer: 'codex' });
const task = store.create({ title: 'Verify activity updates', criteria: 'Keep replies and activity in sync.', harness: 'codex', model: 'test-model', check: ['npm', 'test'], setup: [], repo, worktree: { path: '/tmp/browser-test-worktree', branch: 'factory/test' } });
store.update(task.id, { status: 'awaiting_approval', requests: [{ key: 'reply-1', kind: 'question', params: { questions: [{ id: 'answer', question: 'Which behavior should stay?', options: [] }] } }] });
for (let index = 0; index < 30; index++) store.event(task.id, 'message', `Recorded output ${index}`);

const runner = {
  active: { id: task.id },
  recovery: [],
  probe: async (harness: string) => ({ harness, version: 'test', authenticated: true, models: [{ id: 'test-model', name: 'Test model', isDefault: true }] }),
} as unknown as ApiServices['runner'];

let api = createApi({ store, runner });
let slowDetail = false;
let stateCalls = 0;

async function handle(request: Request, server: Server) {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith('/api/')) return serveAsset(dist, pathname);
  if (pathname === '/api/state') stateCalls++;
  if (slowDetail && pathname === `/api/tasks/${task.id}`) await Bun.sleep(350);
  return api(request, server);
}

const listen = (port = 0) => Bun.serve({ hostname: '127.0.0.1', port, idleTimeout: 30, fetch: handle });
let server = listen();
const base = `http://127.0.0.1:${server.port}`;

try {
  await browser('open', base);
  await browser('set', 'viewport', '1440', '1000');
  await waitFor('document.querySelector("[name=answer]")');
  await browser('fill', '[name=answer]', 'Preserve my draft');
  await evaluate('window.replyNode = document.querySelector("[name=answer]"); true');
  store.event(task.id, 'message', 'Fresh output while answering');
  await waitFor('document.querySelector("#activity-scroll").textContent.includes("Fresh output while answering")');
  assert.equal(await evaluate('document.activeElement === window.replyNode && window.replyNode.value === "Preserve my draft"'), true);
  assert.equal(await evaluate('!document.querySelector("#connect") && !document.querySelector("#recovery")'), true);
  console.log('Live activity preserves reply focus and draft; setup and recovery stay hidden.');

  await evaluate('document.querySelector("#activity-scroll").scrollTop = 0; document.querySelector("#activity-scroll").dispatchEvent(new Event("scroll")); true');
  await waitFor('document.querySelector("#latest")');
  const top = await evaluate('document.querySelector("#activity-scroll").scrollTop');
  store.event(task.id, 'message', 'Fresh output while reading');
  await waitFor('document.querySelector("#activity-scroll").textContent.includes("Fresh output while reading")');
  assert.equal(await evaluate('document.querySelector("#activity-scroll").scrollTop'), top);
  await browser('click', '#latest');
  await waitFor('!document.querySelector("#latest")');
  console.log('Reading history keeps its scroll position; jump to latest resumes following.');

  slowDetail = true;
  const before = stateCalls;
  for (let index = 0; index < 430; index++) store.event(task.id, 'message', `Burst ${index}`);
  await waitFor('document.querySelector("#activity-scroll").textContent.includes("Burst 429")');
  assert.equal(await evaluate('document.querySelectorAll("#activity-scroll [data-event]").length'), 200);
  assert.equal(await evaluate('new Set([...document.querySelectorAll("#activity-scroll [data-event]")].map(node => node.dataset.event)).size'), 200);
  assert.ok(stateCalls - before < 10);
  slowDetail = false;
  console.log('430-event burst catches up in order, without duplicates; the feed keeps 200 events.');

  api = createApi({ store, runner });
  const port = server.port;
  server.stop(true);
  server = listen(port);
  store.event(task.id, 'message', 'Output after service restart');
  await waitFor('document.querySelector("#connection").textContent === "Live" && document.querySelector("#activity-scroll").textContent.includes("Output after service restart")');
  assert.equal(await evaluate('document.querySelector("[name=answer]").value'), 'Preserve my draft');
  await browser('screenshot', join(screenshots, 'factory-desktop.png'));
  console.log('Restart with a new session cookie reconnects and catches up without losing the draft.');

  const older = store.create({ title: 'Another queued task', criteria: 'Test selection', harness: 'codex', model: 'test-model', check: [], setup: [], repo });
  await waitFor(`document.querySelector('[data-task="${older.id}"]')`);
  slowDetail = true;
  store.event(task.id, 'message', 'Delayed response from previous selection');
  await browser('click', `[data-task="${older.id}"]`);
  await waitFor('document.querySelector("#task-heading")?.textContent === "Another queued task"');
  assert.equal(await evaluate('document.querySelector("main").textContent.includes("Delayed response from previous selection")'), false);
  slowDetail = false;
  console.log('Switching tasks ignores stale responses.');

  await evaluate(`document.querySelector('[aria-label="Actions for Verify activity updates"]').click(); true`);
  await waitFor('[...document.querySelectorAll("[role=menuitem], [role=menuitemradio]")].some(node => node.textContent.includes("Automatic, full access"))');
  assert.equal(await evaluate('[...document.querySelectorAll("[role=menuitem]")].some(node => node.textContent === "Stop")'), true);
  await evaluate('[...document.querySelectorAll("[role=menuitem]")].find(node => node.textContent === "Open").click(); true');
  await waitFor('document.querySelector("#task-heading")?.textContent === "Verify activity updates" && !document.querySelector("[role=menu]")');
  console.log('Sidebar task actions open from the three-dot menu and act on that task.');

  await browser('hover', `[data-task="${older.id}"]`);
  await waitFor('["Another queued task", "Not started", "Codex · test-model"].every(text => document.querySelector("#task-peek")?.textContent.includes(text))');
  assert.equal(await evaluate('getComputedStyle(document.querySelector("#task-peek")).pointerEvents'), 'none');
  await browser('hover', '#task-search');
  await waitFor('!document.querySelector("#task-peek")');
  console.log('Hovering a sidebar task shows its details beside the sidebar, and they hide when the pointer leaves.');

  await browser('click', '#change-repo');
  await evaluate('[...document.querySelectorAll("[role=menuitem]")].find(node => node.textContent.includes("Add repository")).click(); true');
  await waitFor('document.querySelector("dialog[open] #connect") && document.querySelector("#task-heading")');
  await browser('press', 'Escape');
  await waitFor('!document.querySelector("dialog[open]") && !document.querySelector("#connect")');
  console.log('Add repository opens a modal over the current task, and Escape closes it.');

  await browser('set', 'viewport', '390', '844');
  await browser('click', '#back-tasks');
  await browser('click', `[data-task="${task.id}"]`);
  await waitFor('document.querySelector("#task-heading")?.textContent === "Verify activity updates"');
  assert.equal(await evaluate(noOverflow), true);
  assert.equal(await evaluate('document.querySelector("#task-list").offsetParent === null'), true);
  await browser('screenshot', join(screenshots, 'factory-mobile.png'));
  await browser('click', '#back-tasks');
  await browser('click', '#new-task');
  await waitFor('document.querySelector("[name=criteria]")');
  await browser('fill', '[name=criteria]', 'Keep this task draft');
  await evaluate('document.querySelector("[aria-label^=Permissions]").click(); true');
  await waitFor('document.querySelector("[role=option]")');
  await evaluate('[...document.querySelectorAll("[role=option]")].find(node => node.textContent.includes("full access")).click(); true');
  assert.equal(await evaluate('document.querySelector("#autonomy-note").textContent.includes("outside the worktree")'), true);
  await browser('click', '#retry-agent');
  await waitFor('document.querySelector("#agent-status").textContent.includes("Ready")');
  assert.equal(await evaluate('document.querySelector("[name=criteria]").value'), 'Keep this task draft');
  assert.equal(await evaluate('document.querySelector("[aria-label^=Permissions]").getAttribute("aria-label").includes("full access")'), true);
  assert.equal(await evaluate(noOverflow), true);
  await browser('screenshot', join(screenshots, 'factory-form-mobile.png'));
  console.log('Mobile navigation, task drafts, permission choices, and agent re-probing pass.');

  await browser('set', 'viewport', '640', '450');
  assert.equal(await evaluate(noOverflow), true);
  console.log('Narrow viewport and 200% zoom equivalent have no horizontal overflow.');

  await browser('press', 'Escape');
  await waitFor('!document.querySelector("#task-form")');
  console.log('Escape closes the task form.');

  const merged = store.create({ title: 'Merged work', criteria: 'Merge it', harness: 'codex', model: 'test-model', check: [], setup: [], repo });
  store.update(merged.id, { status: 'handoff', commit: { sha: 'aaaaaaaaaaaa1111', branch: 'factory/merged' }, merge: { sha: 'bbbbbbbbbbbb2222', branch: 'main' }, worktreeRemoved: true });
  await browser('set', 'viewport', '1440', '1000');
  await waitFor(`document.querySelector('[data-task="${merged.id}"]')`);
  await browser('click', `[data-task="${merged.id}"]`);
  await waitFor('document.querySelector("#task-heading")?.textContent === "Merged work"');
  await waitFor('document.querySelector("[data-command=revert]")?.textContent.includes("git revert -m 1 --no-edit bbbbbbbbbbbb2222")');
  assert.equal(await evaluate('Boolean(document.querySelector("[data-run-command=revert]"))'), true);
  await browser('screenshot', join(screenshots, 'factory-merged.png'));
  console.log('A merged task shows its revert command with Copy and Run.');

  store.event(merged.id, 'message', 'To try it, run `npm run ui` in the project folder.');
  await waitFor('document.querySelector("[data-run-shell]")');
  await evaluate('document.querySelector("[data-run-command=revert]").click(); true');
  await waitFor('document.querySelector("dialog[open] #confirm-dialog")?.textContent.includes("git revert -m 1 --no-edit bbbbbbbbbbbb2222")');
  await browser('screenshot', join(screenshots, 'factory-confirm.png'));
  await evaluate('[...document.querySelectorAll("#confirm-dialog button")].find(node => node.textContent === "Cancel").click(); true');
  await waitFor('!document.querySelector("dialog[open]")');
  assert.equal(store.require(merged.id).revert, undefined);
  console.log('Agent commands get Run buttons, and Run asks in a modal that Cancel dismisses without running anything.');

  const shotPath = join(screenshots, 'factory-preview-fixture.png');
  await Bun.write(shotPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  const previewed = store.create({ title: 'Previewed work', criteria: 'Show the page', harness: 'codex', model: 'test-model', check: [], setup: [], repo, worktree: { path: '/tmp/browser-test-previewed', branch: 'factory/previewed' } });
  store.update(previewed.id, { status: 'handoff', candidate: 'tree-preview', preview: { status: 'captured', candidate: 'tree-preview', command: ['npm', 'run', 'dev'], source: 'detected', url: 'http://127.0.0.1:5173', shots: [{ name: 'desktop', width: 1280, height: 800, path: shotPath, bytes: 70 }], errors: ['ReferenceError: chart is not defined'], at: new Date().toISOString(), durationMs: 1200 } });
  await waitFor(`document.querySelector('[data-task="${previewed.id}"]')`);
  await browser('click', `[data-task="${previewed.id}"]`);
  await waitFor('document.querySelector("#task-heading")?.textContent === "Previewed work"');
  await browser('click', '#tab-preview');
  await waitFor('document.querySelector("#panel-preview img")?.complete && document.querySelector("#panel-preview img").naturalWidth > 0');
  assert.equal(await evaluate('["Screenshots captured", "npm run dev", "1 page error", "chart is not defined", "Retake screenshots"].every(text => document.querySelector("#panel-preview").textContent.includes(text))'), true);
  console.log('The Preview tab shows captured screenshots, page errors, and Retake.');

  store.update(previewed.id, { liveApp: { url: 'http://127.0.0.1:5173', command: ['npm', 'run', 'dev'], startedAt: new Date().toISOString() } });
  await waitFor('document.querySelector("#open-app") && document.querySelector("#panel-preview")?.textContent.includes("App running")');
  console.log('A running app shows Open app in the header and its address in the Preview tab.');

  store.event(previewed.id, 'screenshot', 'Desktop screenshot', { images: [{ name: 'desktop', width: 1280, height: 800, path: shotPath }] });
  await browser('click', '#tab-activity');
  await waitFor('[...document.querySelectorAll("#panel-activity img")].some(img => img.complete && img.naturalWidth > 0)');
  assert.equal(await evaluate('document.querySelector("#panel-activity").textContent.includes("Desktop screenshot")'), true);
  await browser('click', '#panel-activity button[aria-label^="View"]');
  await waitFor('document.querySelector("dialog[open] img")?.complete && document.querySelector("dialog[open] img").naturalWidth > 0');
  await evaluate('[...document.querySelectorAll("dialog[open] button")].find(node => node.textContent === "Close").click(); true');
  await waitFor('!document.querySelector("dialog[open]")');
  console.log('Screenshots the agent takes show in Activity and open full size in a modal that Close dismisses.');

  for (const item of store.list()) if (!item.merge) store.update(item.id, { status: 'canceled', requests: [], settled: true });
  await browser('open', base);
  await waitFor('document.querySelector("#task-form") && !document.querySelector("#task-heading")');
  await browser('click', '#cancel-task');
  await waitFor('!document.querySelector("#task-form")');
  console.log('With every task settled, the app opens New task, and Cancel dismisses it.');

  store.setting('repository', null);
  await waitFor('document.querySelector("#connect")');
  assert.equal(await evaluate(noOverflow), true);
  console.log('Repository setup shows when no repository is connected.');
} finally {
  await browser('close').catch(() => undefined);
  server.stop(true);
  store.close();
}
