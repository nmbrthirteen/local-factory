import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCommand } from '../shared/commands';
import type { CheckSource, Task } from '../shared/types';

const commandsThatCannotFail = ['true', ':', 'echo', 'printf', 'exit'];
const testFile = /(^|\/)tests?\/.+\.[cm]?js$|\.test\.[cm]?js$/;
const outputTail = 4000;

export function namedCheck(message = '') {
  const named = [...message.matchAll(/^CHECK:\s*`?([^`\n]+?)`?\s*$/gm)].at(-1);
  const command = named ? parseCommand(named[1]) : [];
  return command.length && !commandsThatCannotFail.includes(command[0]) ? command : [];
}

async function detectCheck(path: string) {
  const manifest = await Bun.file(join(path, 'package.json')).json().catch(() => null);
  const script: unknown = manifest?.scripts?.test;
  if (typeof script === 'string' && !script.includes('no test specified')) return ['npm', 'test'];
  const entries = await readdir(path, { recursive: true }).catch(() => [] as string[]);
  const hasTests = entries.some(entry => !entry.includes('node_modules') && !entry.startsWith('.git') && testFile.test(entry));
  return hasTests ? ['node', '--test'] : [];
}

export async function resolveCheck(task: Task, agentMessage: string | undefined, path: string): Promise<{ check: string[]; source: CheckSource }> {
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
  ].filter(Boolean).join('\n');
}

function followUpNote(task: Task) {
  const check = task.checkResult;
  const output = check ? `${check.stdout ?? ''}${check.stderr ?? ''}`.slice(-outputTail) : '';
  return [
    `This is attempt ${task.attempt}. Your earlier changes are already in this worktree, so build on them.`,
    check ? `The last check exited with ${check.exitCode}.${output ? ` Its output ended with:\n${output}` : ''}` : '',
    task.feedback ? `${task.feedbackSource === 'factory' ? 'Note from the factory' : 'Owner feedback'}:\n${task.feedback}` : '',
  ].filter(Boolean).join('\n');
}

const previewInstructions = [
  'If this project has an interface you can start locally, also end your final message with one line naming the command that starts it, for example:',
  'PREVIEW: npm run dev',
  'The factory starts it after the check and captures desktop and phone screenshots.',
].join('\n');

const previewToolInstructions = 'To check interface changes before you finish, use the preview tools: preview_open starts the app in a sandbox and returns a screenshot, preview_screenshot captures desktop or phone size, preview_logs reads console output, page errors, and failed requests, and preview_interact clicks, fills, presses keys, runs JavaScript, or reads the page structure.';

export function taskPrompt(task: Task, setupRan: string[], followUp: boolean) {
  const setupNote = setupRan.length ? `Setup already ran in this worktree: ${setupRan.join(' ')}\n` : '';
  const tools = task.harness === 'opencode' ? '' : `\n${previewToolInstructions}`;
  const brief = `Task: ${task.title}\nWhat done looks like:\n${task.criteria}\n${setupNote}${checkInstructions(task)}\n${previewInstructions}${tools}`;
  return followUp ? `${brief}\n\n${followUpNote(task)}` : brief;
}

export const combineInstructions = (role: string, context: string) => [role.trim(), context].filter(Boolean).join('\n\n');

export const developerInstructions = (instructions: string) =>
  `${instructions}\n\nKeep every message short: lead with what you did, in direct sentences, and skip preamble and recaps. Do not push, create a PR, merge, deploy, or change Git history.`;
