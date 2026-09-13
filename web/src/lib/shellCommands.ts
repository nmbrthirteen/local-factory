const shellLanguages = new Set(['sh', 'bash', 'zsh', 'shell']);
const transcriptLanguages = new Set(['console', 'terminal']);
const knownTools = new Set([
  'bun', 'bunx', 'npm', 'npx', 'pnpm', 'yarn', 'node', 'deno', 'git', 'gh', 'make', 'cargo', 'go', 'python', 'python3',
  'pip', 'uv', 'docker', 'brew', 'ollama', 'open', 'curl', 'cd', 'ls', 'cp', 'mv', 'mkdir', 'chmod', 'cat',
]);
const promptPrefix = /^\s*\$\s+/;
const placeholder = /\.\.\.|…|<[^>]+>/;

const firstWord = (line: string) => line.trim().split(/\s+/)[0] ?? '';
const isComment = (line: string) => line.trim().startsWith('#');

export function commandFromBlock(language: string, body: string) {
  const lines = body.split('\n').filter(line => line.trim());
  if (!lines.length) return null;
  const prompted = lines.filter(line => promptPrefix.test(line));
  if (prompted.length) return prompted.map(line => line.replace(promptPrefix, '')).join('\n');
  if (transcriptLanguages.has(language)) return null;
  if (shellLanguages.has(language)) return lines.join('\n');
  const looksLikeShell = !language && lines.every(line => isComment(line) || knownTools.has(firstWord(line)));
  return looksLikeShell && lines.some(line => !isComment(line)) ? lines.join('\n') : null;
}

export function commandFromInline(code: string) {
  const words = code.trim().split(/\s+/);
  return knownTools.has(words[0]) && words.length > 1 && !placeholder.test(code) ? code.trim() : null;
}
