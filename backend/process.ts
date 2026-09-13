import type { ChildProcess } from 'node:child_process';

export type Env = Record<string, string>;
type RunOptions = { cwd?: string; env?: Env; timeoutMs?: number };

export const pickEnv = (keys: string[]): Env =>
  Object.fromEntries(keys.flatMap(key => (process.env[key] ? [[key, process.env[key]]] : [])));

export const safeEnv = () => pickEnv(['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'SYSTEMROOT']);

const firstLine = (text: string) => text.split('\n').find(line => line.trim())?.trim() ?? '';

class CommandError extends Error {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(command: string, exitCode: number | null, stdout: string, stderr: string, timedOut: boolean) {
    super(timedOut ? `${command} timed out` : firstLine(stderr) || firstLine(stdout) || `${command} exited with ${exitCode}`);
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export class MissingCommandError extends Error {
  readonly command: string;

  constructor(command: string) {
    super(`${command} is not installed`);
    this.command = command;
  }
}

export async function run([command, ...args]: string[], { cwd, env = safeEnv(), timeoutMs = 30_000 }: RunOptions = {}) {
  const executable = command.includes('/') ? command : Bun.which(command, { PATH: env.PATH ?? '' });
  if (!executable) throw new MissingCommandError(command);
  const child = Bun.spawn([executable, ...args], { cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exitCode !== 0 || timedOut) throw new CommandError(command, exitCode, stdout, stderr, timedOut);
    return stdout;
  } finally {
    clearTimeout(timer);
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

export function stopProcessGroup(child: ChildProcess | undefined, graceMs = 1500) {
  const pid = child?.pid;
  if (!pid) return;
  signalGroup(pid, 'SIGTERM');
  setTimeout(() => signalGroup(pid, 'SIGKILL'), graceMs).unref();
}
