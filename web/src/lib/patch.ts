type DiffLine = { kind: 'hunk' | 'add' | 'del' | 'context'; text: string; oldLine?: number; newLine?: number };
export type DiffFile = { path: string; from: string; state: 'modified' | 'renamed' | 'added' | 'deleted'; additions: number; deletions: number; binary?: boolean; lines: DiffLine[] };

const fileHeader = /^diff --git a\/(.*) b\/(.*)$/;
const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parsePatch(text: string) {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let oldLine = 0;
  let newLine = 0;
  for (const line of text.split('\n')) {
    const header = line.match(fileHeader);
    if (header) {
      file = { path: header[2], from: header[1], state: header[1] === header[2] ? 'modified' : 'renamed', additions: 0, deletions: 0, lines: [] };
      files.push(file);
      continue;
    }
    if (!file) continue;
    if (line.startsWith('new file mode')) file.state = 'added';
    else if (line.startsWith('deleted file mode')) file.state = 'deleted';
    else if (line.startsWith('Binary files')) file.binary = true;
    else if (hunkHeader.test(line)) {
      const [, oldStart, newStart, context] = line.match(hunkHeader)!;
      oldLine = Number(oldStart);
      newLine = Number(newStart);
      file.lines.push({ kind: 'hunk', text: context.trim() });
    } else if (!file.lines.length) continue;
    else if (line.startsWith('+')) {
      file.additions++;
      file.lines.push({ kind: 'add', newLine: newLine++, text: line.slice(1) });
    } else if (line.startsWith('-')) {
      file.deletions++;
      file.lines.push({ kind: 'del', oldLine: oldLine++, text: line.slice(1) });
    } else if (line.startsWith(' ')) {
      file.lines.push({ kind: 'context', oldLine: oldLine++, newLine: newLine++, text: line.slice(1) });
    }
  }
  return files;
}
