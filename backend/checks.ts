import { readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseCommand } from '../shared/commands';
import type { CheckSource, PromptAttachment, Task } from '../shared/types';
import { detectRecipe } from './git';
import { readScripts } from './manifest';

const commandsThatCannotFail = ['true', ':', 'echo', 'printf', 'exit', 'test', '[', 'sleep', 'pwd', 'ls', 'cat', 'yes'];
const shells = ['sh', 'bash', 'zsh', 'dash'];
const interpreters = ['node', 'bun', 'deno', 'python', 'python3', 'ruby', 'perl'];
const inlineCode = ['-e', '--eval', '-p', '--print', '-c', 'eval'];

// Anything past a plain && chain can mask a failing exit code.
const maskingShell = /[;|&\n`]|\$\(/;

// Inline code that calls nothing, or only exits cleanly, cannot fail.
const trivialCode = /^[^(]*$|^[\s;]*(?:(?:process|sys|os|Deno)\.)?exit\s*\(\s*0?\s*\)[\s;]*$/;
const testFile = /(^|\/)tests?\/.+\.[cm]?js$|\.test\.[cm]?js$/;
const outputTail = 4000;

// The agent picks its own check, so one that cannot fail is not a check, however it is wrapped.
function canFail([program = '', ...args]: string[]): boolean {
  const name = basename(program);

  if (name === 'env') {
    const start = args.findIndex(arg => !arg.includes('=') && !arg.startsWith('-'));

    return start !== -1 && canFail(args.slice(start));
  }

  if (commandsThatCannotFail.includes(name)) return false;
  const inline = interpreters.includes(name) ? args.findIndex(arg => inlineCode.includes(arg)) : -1;

  if (inline !== -1) return !trivialCode.test(args[inline + 1] ?? '');
  const script = shells.includes(name) && args.includes('-c') ? (args[args.indexOf('-c') + 1] ?? '') : null;

  if (script === null) return Boolean(name);

  if (maskingShell.test(script.replaceAll('&&', ''))) return false;

  return script.split('&&').some(part => canFail(parseCommand(part)));
}

export function namedCheck(message = '') {
  const named = [...message.matchAll(/^CHECK:\s*`?([^`\n]+?)`?\s*$/gm)].at(-1);
  const command = named ? parseCommand(named[1]) : [];

  return canFail(command) ? command : [];
}

async function detectCheck(path: string) {
  const script = (await readScripts(path)).test;

  if (script !== undefined && !script.includes('no test specified'))
    return (await detectRecipe(path))?.check ?? ['npm', 'test'];
  const entries = await readdir(path, { recursive: true }).catch((): string[] => []);

  const hasTests = entries.some(
    entry => !entry.includes('node_modules') && !entry.startsWith('.git') && testFile.test(entry),
  );

  return hasTests ? ['node', '--test'] : [];
}

export async function resolveCheck(
  task: Pick<Task, 'check'>,
  agentMessage: string | undefined,
  path: string,
): Promise<{ check: string[]; source: CheckSource }> {
  if (task.check.length) return { check: task.check, source: 'owner' };
  const named = namedCheck(agentMessage);

  if (named.length) return { check: named, source: 'agent' };

  return { check: await detectCheck(path), source: 'detected' };
}

function checkInstructions(task: Task) {
  if (task.check.length) return `The factory will run this check after you finish: ${task.check.join(' ')}`;

  return [
    'No check command was given. Add or update automated tests that prove this change works, run them, and end your final message with one line naming the single offline command that runs them, for example:',
    'CHECK: npm test',
    task.resolvedCheck ? `The previous attempt used: CHECK: ${task.resolvedCheck.join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function followUpNote(task: Task) {
  const check = task.checkResult;
  const output = check ? `${check.stdout ?? ''}${check.stderr ?? ''}`.slice(-outputTail) : '';

  return [
    `This is attempt ${task.attempt}. Your earlier changes are already in this worktree, so build on them.`,
    check ? `The last check exited with ${check.exitCode}.${output ? ` Its output ended with:\n${output}` : ''}` : '',
    task.feedback
      ? `${task.feedbackSource === 'factory' ? 'Note from the factory' : 'Owner feedback'}:\n${task.feedback}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const previewInstructions = [
  'If this project has an interface you can start locally, also end your final message with one line naming the command that starts it, for example:',
  'PREVIEW: npm run dev',
  'The factory starts it after the check and captures desktop and phone screenshots.',
].join('\n');

const previewToolInstructions =
  'To check interface changes before you finish, use the preview tools: preview_open starts the app in a sandbox and returns a screenshot, preview_screenshot captures desktop or phone size, preview_logs reads console output, page errors, and failed requests, and preview_interact clicks, fills, presses keys, runs JavaScript, or reads the page structure.';

export function taskPrompt(task: Task, setupRan: string[], followUp: boolean) {
  const setupNote = setupRan.length ? `Setup already ran in this worktree: ${setupRan.join(' ')}\n` : '';
  const tools = task.harness === 'opencode' ? '' : `\n${previewToolInstructions}`;

  const attached = task.attachments?.length
    ? `Attached to this message: ${task.attachments.map(attachment => attachment.name).join(', ')}.\n`
    : '';

  const brief = `Task: ${task.title}\nWhat done looks like:\n${task.criteria}\n${attached}${setupNote}${checkInstructions(task)}\n${previewInstructions}${tools}`;

  return followUp ? `${brief}\n\n${followUpNote(task)}` : brief;
}

// Images ride along as parts of the message, and text files are quoted into it, since no agent here can open a file the factory holds.
export function withAttachments(prompt: string, attachments: PromptAttachment[]) {
  const files = attachments.filter(attachment => attachment.kind === 'text');

  if (!files.length) return prompt;

  return [prompt, ...files.map(file => `Attached file ${file.name}:\n\`\`\`\n${file.text}\n\`\`\``)].join('\n\n');
}

export const combineInstructions = (role: string, context: string) =>
  [role.trim(), context].filter(Boolean).join('\n\n');

export const developerInstructions = (instructions: string) =>
  `${instructions}\n\nKeep every message short: lead with what you did, in direct sentences, and skip preamble and recaps. Do not push, create a PR, merge, deploy, or change Git history.`;
