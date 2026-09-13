import { Fragment, type ReactNode } from 'react';
import { CopyButton, smallAction } from '@/components/atoms/SmallAction';
import { commandFromBlock, commandFromInline } from '@/lib/shellCommands';

const inlinePattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\))/g;
const listPattern = /^(\s*)(?:([-*])|\d+\.)\s+(.*)$/;
const fencePattern = /^\s*```\s*([\w-]*)/;
const headingPattern = /^#{1,6}\s+(.*)$/;

type Item = { text: string; children: string[] };
type RunCommand = ((command: string) => void) | undefined;

function inline(text: string, onRun: RunCommand) {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    if (match[1]) {
      const code = match[1].slice(1, -1);
      const command = onRun && commandFromInline(code);
      nodes.push(
        <Fragment key={index}>
          <code className="rounded-[5px] bg-field px-1 py-px font-mono text-[12.5px] text-ink shadow-hairline">{code}</code>
          {command && <button type="button" data-run-shell onClick={() => onRun(command)} className="ml-1 rounded-[5px] px-1 align-baseline text-[12px] font-medium text-accent-ink transition-colors duration-100 hover:bg-hover">Run</button>}
        </Fragment>,
      );
    } else if (match[2]) {
      nodes.push(<strong key={index} className="font-semibold">{match[2].slice(2, -2)}</strong>);
    } else {
      nodes.push(<a key={index} href={match[5]} target="_blank" rel="noreferrer" className="text-accent-ink underline underline-offset-2">{match[4]}</a>);
    }
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function List({ ordered, items, onRun }: { ordered: boolean; items: Item[]; onRun: RunCommand }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag className={`flex flex-col gap-1 pl-5 marker:text-ink-3 ${ordered ? 'list-decimal' : 'list-disc'}`}>
      {items.map((item, position) => (
        <li key={position}>
          {inline(item.text, onRun)}
          {item.children.length > 0 && <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 marker:text-ink-3">{item.children.map((child, index) => <li key={index}>{inline(child, onRun)}</li>)}</ul>}
        </li>
      ))}
    </Tag>
  );
}

const codeBlock = 'scroll-thin overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-ink-2';

function CommandBlock({ body, command, onRun }: { body: string; command: string; onRun: (command: string) => void }) {
  return (
    <div className="overflow-hidden rounded-card bg-inset shadow-hairline">
      <pre className={codeBlock}>{body}</pre>
      <div className="flex items-center justify-end gap-1 border-t border-line px-2 py-1.5">
        <CopyButton text={command} />
        <button type="button" data-run-shell onClick={() => onRun(command)} className={`${smallAction} text-accent-ink`}>Run</button>
      </div>
    </div>
  );
}

const startsBlock = (line: string) => fencePattern.test(line) || headingPattern.test(line) || listPattern.test(line);

export default function Markdown({ text, onRunCommand }: { text: string; onRunCommand?: (command: string) => void }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const key = blocks.length;
    if (!line.trim()) {
      index++;
    } else if (fencePattern.test(line)) {
      const language = line.match(fencePattern)![1].toLowerCase();
      const body: string[] = [];
      for (index++; index < lines.length && !fencePattern.test(lines[index]); index++) body.push(lines[index]);
      index++;
      const command = onRunCommand && commandFromBlock(language, body.join('\n'));
      blocks.push(command
        ? <CommandBlock key={key} body={body.join('\n')} command={command} onRun={onRunCommand} />
        : <pre key={key} className={`${codeBlock} rounded-card bg-inset shadow-hairline`}>{body.join('\n')}</pre>);
    } else if (headingPattern.test(line)) {
      blocks.push(<p key={key} className="font-semibold text-ink">{inline(line.match(headingPattern)![1], onRunCommand)}</p>);
      index++;
    } else if (listPattern.test(line)) {
      const [, indent, bullet] = line.match(listPattern)!;
      const items: Item[] = [];
      for (; index < lines.length && listPattern.test(lines[index]); index++) {
        const [, depth, , content] = lines[index].match(listPattern)!;
        if (depth.length > indent.length && items.length) items.at(-1)!.children.push(content);
        else items.push({ text: content, children: [] });
      }
      blocks.push(<List key={key} ordered={!bullet} items={items} onRun={onRunCommand} />);
    } else {
      const paragraph: string[] = [];
      for (; index < lines.length && lines[index].trim() && !startsBlock(lines[index]); index++) paragraph.push(lines[index]);
      blocks.push(<p key={key}>{paragraph.map((part, position) => <Fragment key={position}>{position > 0 && <br />}{inline(part, onRunCommand)}</Fragment>)}</p>);
    }
  }
  return <div className="flex flex-col gap-2.5">{blocks}</div>;
}
