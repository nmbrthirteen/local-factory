import type { Database } from 'bun:sqlite';
import { activeStates, finishedStates } from '../shared/domain';
import type { TaskPage, TaskSummary } from '../shared/types';

export type TaskPageOptions = { query?: string; filter?: string; before?: number; repository?: string };

const pageSize = 50;

export const statusIn = (states: readonly string[]) => `status IN (${states.map(state => `'${state}'`).join(', ')})`;

const groups = {
  all: '1',
  active: statusIn(['queued', ...activeStates]),
  attention: statusIn(['awaiting_approval']),
  finished: statusIn(finishedStates),
} satisfies Record<string, string>;

const isGroup = (name: string): name is keyof typeof groups => Object.hasOwn(groups, name);

const search = `instr(lower(coalesce(json_extract(data, '$.title'), '') || ' ' || coalesce(json_extract(data, '$.repo.path'), '') || ' ' || coalesce(json_extract(data, '$.harness'), '')), lower(?)) > 0
  AND (? = '' OR json_extract(data, '$.repo.path') = ?)`;

type SummaryRow = Omit<
  TaskSummary,
  'committed' | 'merged' | 'reverted' | 'unchecked' | 'worktreeRemoved' | 'settled'
> & {
  cursor: number;
  committed: number;
  merged: number;
  reverted: number;
  unchecked: number;
  worktreeRemoved: number;
  settled: number | null;
};

export function taskPage(
  db: Database,
  { query = '', filter = 'all', before = 0, repository = '' }: TaskPageOptions = {},
): TaskPage {
  if (query.length > 200) throw new Error('Search must be under 200 characters');

  if (!isGroup(filter)) throw new Error('Invalid task filter');

  if (!Number.isSafeInteger(before) || before < 0) throw new Error('Invalid task cursor');
  const scope = [query.trim(), repository, repository];

  const counts =
    db
      .query<Record<string, number>, string[]>(
        `SELECT ${Object.entries(groups)
          .map(([key, where]) => `count(CASE WHEN ${where} THEN 1 END) AS "${key}"`)
          .join(', ')} FROM tasks WHERE ${search}`,
      )
      .get(...scope) ?? {};

  const rows = db
    .query<SummaryRow, (string | number)[]>(`SELECT rowid AS cursor, id, status,
      json_extract(data, '$.title') AS title,
      json_extract(data, '$.createdAt') AS createdAt,
      json_extract(data, '$.model') AS model,
      json_extract(data, '$.harness') AS harness,
      json_extract(data, '$.repo.path') AS repository,
      json_extract(data, '$.commit') IS NOT NULL AS committed,
      json_extract(data, '$.merge') IS NOT NULL AS merged,
      json_extract(data, '$.revert') IS NOT NULL AS reverted,
      json_extract(data, '$.pullRequest.state') AS pullRequestState,
      coalesce(json_extract(data, '$.unchecked'), 0) AS unchecked,
      coalesce(json_extract(data, '$.worktreeRemoved'), 0) AS worktreeRemoved,
      json_extract(data, '$.settled') AS settled
    FROM tasks
    WHERE ${search} AND ${groups[filter]} AND (? = 0 OR rowid < ?)
    ORDER BY rowid DESC
    LIMIT ${pageSize + 1}`)
    .all(...scope, before, before);

  const tasks = rows.slice(0, pageSize).map(row => ({
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt,
    model: row.model,
    harness: row.harness,
    repository: row.repository,
    pullRequestState: row.pullRequestState,
    committed: Boolean(row.committed),
    merged: Boolean(row.merged),
    reverted: Boolean(row.reverted),
    unchecked: Boolean(row.unchecked),
    worktreeRemoved: Boolean(row.worktreeRemoved),
    settled: row.settled === null ? null : Boolean(row.settled),
  }));

  return {
    tasks,
    page: {
      counts: { ...counts },
      total: counts[filter] ?? 0,
      next: rows.length > pageSize ? rows[pageSize - 1].cursor : null,
    },
  };
}
