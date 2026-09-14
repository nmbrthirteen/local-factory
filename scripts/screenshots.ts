import type { Server } from 'bun';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createApi, type ApiServices } from '../backend/api';
import { serveAsset } from '../backend/assets';
import { Store } from '../backend/store';
import type { NewTask, Task } from '../shared/types';
import { agentBrowser } from '../test/agent-browser';

const root = join(import.meta.dir, '..');
const dist = join(root, 'dist');
const output = join(root, 'docs/images');
const animationSettleMs = 700;

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

if (!Bun.env.SKIP_BUILD) await Bun.$`bun --bun vite build --logLevel warn`.cwd(root);

const repo = { path: '/Users/you/projects/pocket-ledger', base: '4f9c2a17d3b8e6015a2c9d4e7f10b3a6c58d2e91', dirty: false, remote: true };
const worktreeFor = (id: string) => ({ path: `/Users/you/local-factory/.factory/worktrees/pocket-ledger/${id}`, branch: `factory/${id}` });

const store = new Store(':memory:');
store.setting('repository', repo);
store.setting('repositories', [repo]);
store.setting('preferences', { implementer: 'claude' });

function seed(input: Pick<NewTask, 'title' | 'criteria' | 'model'> & Partial<NewTask>, state: (task: Task) => Partial<Task>, age: number) {
  const task = store.create({ setup: [], check: [], repo, harness: 'claude', ...input });
  return store.update(task.id, { createdAt: minutesAgo(age), ...state(task) });
}

const patch = `diff --git a/src/import/csv.ts b/src/import/csv.ts
new file mode 100644
index 0000000..8b1d2c4
--- /dev/null
+++ b/src/import/csv.ts
@@ -0,0 +1,33 @@
+import type { Transaction } from '../transactions';
+
+const requiredColumns = ['date', 'description', 'amount'];
+
+export function parseCsv(text: string): Transaction[] {
+  const [header, ...rows] = text.trim().split(/\\r?\\n/);
+  const columns = splitRow(header).map(name => name.toLowerCase());
+  if (!requiredColumns.every(name => columns.includes(name))) {
+    throw new Error(\`Expected columns: \${requiredColumns.join(', ')}\`);
+  }
+  return rows
+    .filter(row => row.trim())
+    .map(row => {
+      const values = splitRow(row);
+      const field = (name: string) => values[columns.indexOf(name)] ?? '';
+      return { date: field('date'), description: field('description'), amount: toCents(field('amount')) };
+    });
+}
+
+function splitRow(row: string) {
+  const values: string[] = [];
+  let current = '';
+  let quoted = false;
+  for (const char of row) {
+    if (char === '"') quoted = !quoted;
+    else if (char === ',' && !quoted) {
+      values.push(current.trim());
+      current = '';
+    } else current += char;
+  }
+  return [...values, current.trim()];
+}
+
+const toCents = (value: string) => Math.round(Number(value.replace(/[^\\d.-]/g, '')) * 100);
diff --git a/src/cli.ts b/src/cli.ts
index 3a7e019..c52f8d1 100644
--- a/src/cli.ts
+++ b/src/cli.ts
@@ -1,4 +1,5 @@
 import { addTransaction, listTransactions } from './commands';
+import { parseCsv } from './import/csv';
 import { ledger } from './ledger';
 import { printSummary } from './summary';

@@ -12,6 +13,11 @@ const commands = {
   add: addTransaction,
   list: listTransactions,
+  async import(file: string) {
+    const rows = parseCsv(await Bun.file(file).text());
+    const added = await ledger.addMany(rows, { skipDuplicates: true });
+    console.log(\`Imported \${added} of \${rows.length} rows\`);
+  },
   summary: printSummary,
 };

diff --git a/test/csv.test.ts b/test/csv.test.ts
new file mode 100644
index 0000000..e41f0b7
--- /dev/null
+++ b/test/csv.test.ts
@@ -0,0 +1,15 @@
+import { expect, test } from 'bun:test';
+import { parseCsv } from '../src/import/csv';
+
+test('reads quoted fields and negative amounts', () => {
+  const rows = parseCsv('Date,Description,Amount\\n2026-09-01,"Coffee, oat milk",-4.50');
+  expect(rows).toEqual([{ date: '2026-09-01', description: 'Coffee, oat milk', amount: -450 }]);
+});
+
+test('skips blank lines', () => {
+  expect(parseCsv('date,description,amount\\n\\n2026-09-02,Rent,-1200\\n')).toHaveLength(1);
+});
+
+test('rejects files without the expected columns', () => {
+  expect(() => parseCsv('when,what\\n2026-09-03,Lunch')).toThrow(/Expected columns/);
+});
`;

const patchPath = join(root, '.factory/screenshots/csv-import.patch');
await mkdir(join(root, '.factory/screenshots'), { recursive: true });
await Bun.write(patchPath, patch);

seed({ title: 'Dark mode for the ledger table', criteria: 'Follow the system color scheme in the ledger table.', harness: 'codex', model: 'gpt-5-codex', check: ['bun', 'test'] }, task => ({
  status: 'handoff',
  worktree: worktreeFor(task.id),
  worktreeRemoved: true,
  commit: { sha: '9d41c07be25f3a18c6e0d2b7a4f19c3e8b605d21', branch: `factory/${task.id}` },
  merge: { sha: 'e17b3c9a04d6f2851bc7a9e03d4f6a2c19e8b750', branch: 'main', at: minutesAgo(240) },
}), 300);

seed({ title: 'Recurring transactions', criteria: 'Let me mark a transaction as monthly so it is added automatically.', harness: 'codex', model: 'gpt-5-codex' }, () => ({}), 55);

seed({ title: 'Export the ledger to JSON', criteria: 'Add `ledger export --json` that writes every transaction.', harness: 'opencode', model: 'opencode/big-pickle', check: ['bun', 'test'] }, task => ({
  status: 'failed',
  worktree: worktreeFor(task.id),
  candidate: 'a61f0e2',
  error: 'Project check failed. Inspect its output and the preserved worktree.',
  checkResult: { command: ['bun', 'test'], exitCode: 1, durationMs: 2140, stdout: 'test/export.test.ts:\n✗ keeps amounts in cents\n  Expected: -450\n  Received: -4.5\n\n 14 pass\n 1 fail' },
}), 40);

const csv = seed({ title: 'Import bank statements from CSV', criteria: 'Add `ledger import <file>` for CSV exports from my bank.\n\n- Columns: date, description, amount\n- Skip rows that are already in the ledger\n- Print how many rows were imported', model: 'sonnet' }, task => ({
  status: 'handoff',
  startedAt: minutesAgo(21),
  worktree: worktreeFor(task.id),
  candidate: '7c2e91a',
  checkSource: 'agent',
  resolvedCheck: ['bun', 'test'],
  checkResult: { command: ['bun', 'test'], exitCode: 0, durationMs: 1840, candidate: '7c2e91a' },
  patch: { path: patchPath, bytes: Buffer.byteLength(patch) },
  history: [{ attempt: 1, candidate: '7c2e91a', exitCode: 0, command: ['bun', 'test'], patch: { path: patchPath, bytes: Buffer.byteLength(patch) }, at: minutesAgo(9) }],
  usage: { costUsd: 0.2134, turns: 9 },
  instructionFiles: [{ scope: 'global', path: '~/.claude/CLAUDE.md', label: '~/.claude/CLAUDE.md', native: false, bytes: 1840 }, { scope: 'repository', path: 'AGENTS.md', label: 'AGENTS.md', native: false, bytes: 612 }],
}), 22);

const worktree = worktreeFor(csv.id).path;
const tool = (id: string, text: string, output: string) => {
  store.event(csv.id, 'tool_started', text, { tool: text.split(':')[0], toolId: id });
  store.event(csv.id, 'tool_result', 'Tool completed', { toolId: id, output });
};
store.event(csv.id, 'prepared', `Worktree created: ${worktree}`);
store.event(csv.id, 'setup', 'Running setup with network access (found from the lockfile): bun install --frozen-lockfile');
store.event(csv.id, 'setup_result', 'Setup exited with 0', { exitCode: 0, durationMs: 1420 });
store.event(csv.id, 'running', 'Implementer session started', { harness: 'claude', model: 'sonnet' });
store.event(csv.id, 'message', "I'll check how transactions are stored first, then add the importer with tests.");
tool('t1', `Read: ${worktree}/src/transactions.ts`, 'export type Transaction = { date: string; description: string; amount: number };');
tool('t2', `Read: ${worktree}/src/cli.ts`, 'const commands = { add: addTransaction, list: listTransactions, summary: printSummary };');
tool('t3', 'Grep: addMany', 'src/ledger.ts:41:  async addMany(rows: Transaction[], { skipDuplicates = false } = {}) {');
tool('t4', `Write: ${worktree}/src/import/csv.ts`, 'File created');
tool('t5', `Edit: ${worktree}/src/cli.ts`, 'Updated 2 places');
tool('t6', `Write: ${worktree}/test/csv.test.ts`, 'File created');
tool('t7', 'Bash: bun test', ' 15 pass\n 0 fail\nRan 15 tests across 4 files.');
store.event(csv.id, 'message', 'Added `ledger import <file>`. It reads the date, description, and amount columns, skips rows already in the ledger, and prints how many it imported.\n\n- `src/import/csv.ts` handles quoted fields and negative amounts\n- `test/csv.test.ts` covers quotes, blank lines, and missing columns\n\nCHECK: bun test');
store.event(csv.id, 'usage', 'Estimated cost $0.2134 across 9 model turns');
store.event(csv.id, 'checking', 'Running check chosen by the agent: bun test');
store.event(csv.id, 'check_result', 'Check exited with 0', { exitCode: 0, durationMs: 1840, stdout: ' 15 pass\n 0 fail\nRan 15 tests across 4 files.' });
store.event(csv.id, 'handoff', 'Implementation and check completed. Independent review and PR delivery have not run.');

const budget = seed({ title: 'Show monthly budget progress', criteria: 'Show how much of each monthly budget is spent in `ledger summary`.', harness: 'codex', model: 'gpt-5-codex' }, task => ({
  status: 'running',
  startedAt: minutesAgo(4),
  worktree: worktreeFor(task.id),
}), 5);
store.event(budget.id, 'message', 'Reading the summary command to see where budgets are loaded.');

const rounding = seed({ title: 'Fix rounding when splitting expenses', criteria: 'Splitting $10 three ways should add back up to $10.', harness: 'opencode', model: 'opencode/big-pickle', check: ['bun', 'test'] }, task => ({
  status: 'awaiting_approval',
  startedAt: minutesAgo(2),
  worktree: worktreeFor(task.id),
  requests: [{
    key: 'que_1',
    kind: 'question',
    params: {
      questions: [{
        id: '0',
        question: 'Who should get the leftover cent when an amount does not split evenly?',
        options: [
          { label: 'The person who paid', description: 'Their share rounds up, everyone else rounds down' },
          { label: 'Rotate between people', description: 'Fair over many expenses, harder to predict' },
          { label: 'The first person in the list', description: 'Simplest, matches the current order' },
        ],
      }],
    },
  }],
}), 3);
store.event(rounding.id, 'message', 'The split rounds each share on its own, so $10 / 3 becomes $3.33 three times. I need one decision before fixing it.');
store.event(rounding.id, 'request', 'Agent needs your input', { tool: 'question' });

const runner = {
  runs: new Map([[budget.id, { id: budget.id }]]),
  recovery: [],
  probe: async (harness: string) => ({ harness, version: 'demo', authenticated: true, models: [] }),
} as unknown as ApiServices['runner'];
const api = createApi({ store, root, runner });

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request: Request, server: Server) {
    const { pathname } = new URL(request.url);
    return pathname.startsWith('/api/') ? api(request, server) : serveAsset(dist, pathname);
  },
});

const { browser, waitFor } = agentBrowser('factory-screenshots');
const capture = async (name: string) => {
  await Bun.sleep(animationSettleMs);
  await browser('screenshot', join(output, name));
  console.log(`Saved docs/images/${name}`);
};

await mkdir(output, { recursive: true });
try {
  // agent-browser keeps the current page when only the hash changes, so the query string forces a fresh load.
  const openTask = (id: string) => browser('open', `http://127.0.0.1:${server.port}/?task=${id}#task=${id}`);
  await openTask(csv.id);
  await browser('set', 'viewport', '1440', '900');
  await waitFor('document.querySelector("#task-heading")?.textContent === "Import bank statements from CSV"');
  await capture('activity.png');

  await browser('click', '#tab-changes');
  await waitFor('document.querySelector("#panel-changes section")');
  await capture('changes.png');

  await openTask(rounding.id);
  await waitFor('document.querySelector("[data-request]")');
  await capture('question.png');
} finally {
  await browser('close').catch(() => undefined);
  server.stop(true);
  store.close();
}
