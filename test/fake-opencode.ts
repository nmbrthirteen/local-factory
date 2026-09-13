import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Script = { permission?: boolean; question?: boolean; wait?: boolean };

export function fakeOpencode(script: Script = {}) {
  const calls: Record<string, any> = { closed: 0, interrupted: 0 };

  const open = async (options: { cwd: string }) => {
    calls.options = options;
    const prompt = Promise.withResolvers<string | null>();
    let answer: (value: unknown) => void = () => {};
    const reply = () => new Promise(resolve => { answer = resolve; });

    const events = (async function* () {
      calls.prompt = await prompt.promise;
      if (calls.prompt === null) return;
      if (script.permission) {
        yield { type: 'permission', id: 'per_1', permission: 'external_directory', patterns: ['/etc/hosts'], metadata: {} };
        calls.permissionReply = await reply();
      }
      if (script.question) {
        yield { type: 'question', id: 'que_1', questions: [{ question: 'Which output?', header: 'Output', options: [{ label: 'implemented', description: 'Expected text' }] }] };
        calls.questionReply = await reply();
      }
      if (script.wait) {
        await new Promise(resolve => { calls.stop = resolve; });
        return;
      }
      await writeFile(join(options.cwd, 'output.txt'), 'implemented\n');
      yield { type: 'tool_started', tool: 'write', text: 'write: output.txt' };
      yield { type: 'message', text: 'Implemented with OpenCode' };
      yield { type: 'idle', error: null, costUsd: 0.01, turns: 2 };
    })();

    return {
      pid: 999_998,
      models: [{ id: 'opencode/big-pickle', name: 'OpenCode · Big Pickle', isDefault: true }],
      policy: { version: '1.18.30', directory: options.cwd, shell: '/sandbox/zsh' },
      events,
      send: async (text: string) => prompt.resolve(text),
      replyPermission: async (_id: string, value: unknown) => answer(value),
      replyQuestion: async (_id: string, value: unknown) => answer(value),
      interrupt: async () => { calls.interrupted++; },
      close: () => {
        calls.closed++;
        calls.stop?.();
        prompt.resolve(null);
      },
    };
  };

  return { open, calls };
}
