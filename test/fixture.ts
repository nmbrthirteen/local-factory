import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeQuery } from '../backend/agents/claude';
import { Codex } from '../backend/agents/codex';
import type { OpenOpencode } from '../backend/agents/opencode';
import { Delivery } from '../backend/delivery';
import { git, inspectRepo } from '../backend/git';
import { Runner } from '../backend/runner';
import { Store } from '../backend/store';
import type { NewTask } from '../shared/types';
import { until } from './support';

export const outputCheck = [process.execPath, '-e', "require('node:assert').equal(require('node:fs').readFileSync('output.txt','utf8'),'implemented\\n')"];
export const exitCheck = (code: number) => [process.execPath, '-e', `process.exit(${code})`];
export const fileCheck = (file: string, failCode = 3) => [process.execPath, '-e', `process.exit(require('node:fs').existsSync('${file}') ? 0 : ${failCode})`];

type Agents = { claude?: unknown; opencode?: unknown };

export async function createFixture(onCleanup: (cleanup: () => unknown) => void, agents: Agents = {}) {
  const root = await mkdtemp(join(tmpdir(), 'factory-test-'));
  await mkdir(join(root, 'agents'));
  await writeFile(join(root, 'agents/implementer.md'), 'Implement the task.');
  const home = join(root, 'home');
  await mkdir(join(home, '.claude'), { recursive: true });
  await writeFile(join(home, '.claude/CLAUDE.md'), 'Owner fixture rules');
  const repoPath = join(root, 'repo');
  await mkdir(repoPath);
  await git(repoPath, ['init']);
  await writeFile(join(repoPath, 'README.md'), 'fixture');
  await writeFile(join(repoPath, 'AGENTS.md'), 'Repository fixture rules');
  await git(repoPath, ['add', '.']);
  await git(repoPath, ['-c', 'user.name=Factory test', '-c', 'user.email=factory@example.invalid', 'commit', '-m', 'fixture']);

  const db = join(root, 'state.sqlite');
  const store = new Store(db);
  const runner = new Runner(store, root, {
    home,
    version: async () => '0.154.0',
    adapter: () => new Codex({ command: process.execPath, args: [join(import.meta.dir, 'fake-codex.ts')], cwd: root }),
    claudeQuery: agents.claude as ClaudeQuery | undefined,
    opencode: agents.opencode as OpenOpencode | undefined,
  });
  const delivery = new Delivery(store, id => runner.active?.id === id);
  onCleanup(async () => {
    await runner.shutdown();
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  const repo = await inspectRepo(repoPath);
  const create = (overrides: Partial<NewTask> = {}) => store.create({ title: 'Test task', criteria: 'Write output', setup: [], check: outputCheck, repo, model: 'test-model', ...overrides });

  return {
    root,
    db,
    store,
    runner,
    delivery,
    repo,
    repoPath,
    create,
    task: (criteria = 'Write output', check = outputCheck, setup: string[] = []) => create({ criteria, check, setup }),
    claudeTask: (model = 'sonnet') => create({ title: 'Claude task', harness: 'claude', model }),
    opencodeTask: (model = 'opencode/big-pickle') => create({ title: 'OpenCode task', harness: 'opencode', model }),
    async identity() {
      await git(repoPath, ['config', 'user.email', 'factory@example.invalid']);
      await git(repoPath, ['config', 'user.name', 'Factory test']);
    },
    async run(id: string, feedback?: string) {
      runner.start(id, feedback);
      await runner.active?.done;
      return store.require(id);
    },
    async settled(id: string) {
      await until(() => !runner.active && ['handoff', 'failed', 'canceled'].includes(store.require(id).status), { attempts: 400, delayMs: 50 });
      return store.require(id);
    },
  };
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;
