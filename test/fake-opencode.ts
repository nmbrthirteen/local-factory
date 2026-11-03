import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OpencodeEvent, OpenOpencode } from '../backend/agents/opencode';

type Script = { permission?: boolean; question?: boolean; wait?: boolean };

type PermissionReply = 'once' | 'reject';

type Calls = {
  closed: number;
  interrupted: number;
  options?: { cwd: string };
  prompt?: string | null;
  permissionReply?: PermissionReply;
  questionReply?: string[][];
  stop?: () => void;
};

export function fakeOpencode(script: Script = {}) {
  const calls: Calls = { closed: 0, interrupted: 0 };

  const open: OpenOpencode = async options => {
    calls.options = options;
    const prompt = Promise.withResolvers<string | null>();
    const permissionReply = Promise.withResolvers<PermissionReply>();
    const questionReply = Promise.withResolvers<string[][]>();

    const events = (async function* (): AsyncGenerator<OpencodeEvent> {
      calls.prompt = await prompt.promise;

      if (calls.prompt === null) return;

      if (script.permission) {
        yield {
          type: 'permission',
          id: 'per_1',
          permission: 'external_directory',
          patterns: ['/etc/hosts'],
          metadata: {},
        };
        calls.permissionReply = await permissionReply.promise;
      }

      if (script.question) {
        yield {
          type: 'question',
          id: 'que_1',
          questions: [
            {
              question: 'Which output?',
              options: [{ label: 'implemented', description: 'Expected text' }],
            },
          ],
        };
        calls.questionReply = await questionReply.promise;
      }

      if (script.wait) {
        await new Promise<void>(resolve => {
          calls.stop = resolve;
        });

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
      send: async text => prompt.resolve(text),
      replyPermission: async (_id, reply) => permissionReply.resolve(reply),
      replyQuestion: async (_id, answers) => questionReply.resolve(answers),
      interrupt: async () => {
        calls.interrupted++;
      },
      close: () => {
        calls.closed++;
        calls.stop?.();
        prompt.resolve(null);
      },
    };
  };

  return { open, calls };
}
