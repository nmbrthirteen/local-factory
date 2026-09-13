import type { ReactNode } from 'react';

const token = /(?<literal>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|\b\d+(?:\.\d+)?\b)|(?<keyword>\b(?:import|from|export|default|async|function|const|let|var|await|return|if|else|for|while|new|throw|try|catch|null|true|false|undefined)\b)|[A-Za-z_$][\w$]*(?=\s*\()/g;

const literal = { color: 'var(--orange)' };
const keyword = { color: 'var(--accent-ink)' };
const call = { color: 'var(--ink)', fontWeight: 500 };

export function highlight(text: string) {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(token)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(<span key={nodes.length}>{text.slice(last, index)}</span>);
    const style = match.groups?.literal ? literal : match.groups?.keyword ? keyword : call;
    nodes.push(<span key={nodes.length} style={style}>{match[0]}</span>);
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(<span key={nodes.length}>{text.slice(last)}</span>);
  return nodes;
}
