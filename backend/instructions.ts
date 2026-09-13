import { join } from 'node:path';
import type { Harness } from '../shared/domain';
import type { InstructionFile } from '../shared/types';

const maxBytes = 64 * 1024;
const truncationNote = '\n\n[Truncated by Local Factory]';

type Options = { harness: Harness; worktree: string; home: string; env: Record<string, string | undefined> };
type Candidate = Omit<InstructionFile, 'bytes'>;
type Found = InstructionFile & { content: string };

function candidates({ harness, worktree, home, env }: Options): Candidate[] {
  const label = (path: string) => (path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);
  const global = (path: string, native = false): Candidate => ({ scope: 'global', path, label: label(path), native });
  const repository = (name: string, native = false): Candidate => ({ scope: 'repository', path: join(worktree, name), label: name, native });
  const codexReadsAgentsFiles = harness === 'codex';
  return [
    global(join(home, '.claude/CLAUDE.md')),
    global(join(env.CODEX_HOME ?? join(home, '.codex'), 'AGENTS.md'), codexReadsAgentsFiles),
    global(join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'opencode/AGENTS.md')),
    repository('CLAUDE.md'),
    repository('AGENTS.md', codexReadsAgentsFiles),
  ];
}

async function read(candidate: Candidate): Promise<Found | null> {
  const file = Bun.file(candidate.path);
  const text = await file.slice(0, maxBytes).text().catch(() => '');
  const content = text.trim();
  if (!content) return null;
  return { ...candidate, bytes: file.size, content: file.size > maxBytes ? `${content}${truncationNote}` : content };
}

export async function loadInstructions(options: Options) {
  const found = (await Promise.all(candidates(options).map(read))).filter(file => file !== null);
  // Codex reads its own AGENTS.md files, so their content counts as already delivered before anything else.
  const seen = new Set(found.filter(file => file.native).map(file => file.content));
  const kept = found.filter(file => {
    if (file.native) return true;
    if (seen.has(file.content)) return false;
    seen.add(file.content);
    return true;
  });
  const text = kept
    .filter(file => !file.native)
    .map(file => `## ${file.scope === 'global' ? 'Owner' : 'Repository'} instructions from ${file.label}\n\n${file.content}`)
    .join('\n\n');
  const files: InstructionFile[] = kept.map(({ content, ...file }) => file);
  return { text, files };
}
