import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  type ClaudeQuery,
  type PermissionResult,
  supportedClaudeVersion,
  type ToolRequestOptions,
} from '../backend/agents/claude';

type Script = { approval?: boolean; question?: boolean; wait?: boolean; plugins?: object[]; factoryTool?: boolean };

type Content = Exclude<SDKUserMessage['message']['content'], string>;

type Calls = {
  closed: number;
  interrupted: number;
  options?: Options;
  content?: Content;
  prompt?: string;
  factoryDecision?: PermissionResult | null;
  decision?: PermissionResult | null;
  answer?: PermissionResult | null;
  release?: () => void;
};

const requestOptions = (toolUseID: string): ToolRequestOptions => ({
  signal: new AbortController().signal,
  toolUseID,
  requestId: `request-${toolUseID}`,
});

export function fakeClaude(script: Script = {}) {
  const calls: Calls = { closed: 0, interrupted: 0 };

  const query: ClaudeQuery = ({ prompt, options }) => {
    calls.options = options;
    const { canUseTool, cwd } = options;

    if (!canUseTool || !cwd) throw new Error('The session must pass cwd and canUseTool');
    const tools = Array.isArray(options.tools) ? options.tools : [];
    const servers = Object.keys(options.mcpServers ?? {});
    let closed = false;

    // SAFETY: the fake yields only the SDKMessage fields the runner reads.
    const messages = (async function* () {
      for await (const message of prompt) {
        const content = Array.isArray(message.message.content) ? message.message.content : [];
        calls.content = content;
        calls.prompt = content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n');
        yield {
          type: 'system',
          subtype: 'init',
          claude_code_version: supportedClaudeVersion,
          cwd,
          model: 'claude-sonnet-5',
          permissionMode: options.permissionMode,
          tools: [...tools, ...servers.map(name => `mcp__${name}__preview_open`)],
          mcp_servers: servers.map(name => ({ name, status: 'connected' })),
          plugins: script.plugins ?? [],
        };

        if (script.factoryTool)
          calls.factoryDecision = await canUseTool('mcp__factory__preview_logs', {}, requestOptions('tool-3'));

        if (script.wait) {
          await new Promise<void>(resolve => {
            calls.release = resolve;
          });

          if (closed) return;
        }

        if (script.approval)
          calls.decision = await canUseTool(
            'Bash',
            { command: 'curl https://example.invalid' },
            { ...requestOptions('tool-1'), title: 'Claude wants to run curl' },
          );

        if (script.question) {
          const questions = [
            {
              question: 'Which output?',
              header: 'Output',
              options: [
                { label: 'implemented', description: 'Expected text' },
                { label: 'other', description: 'Anything else' },
              ],
              multiSelect: false,
            },
          ];

          calls.answer = await canUseTool('AskUserQuestion', { questions }, requestOptions('tool-2'));
        }

        await writeFile(join(cwd, 'output.txt'), 'implemented\n');
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Implemented with Claude' },
              { type: 'tool_use', name: 'Write', input: { file_path: 'output.txt' } },
            ],
          },
        };
        yield {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Done',
          total_cost_usd: 0.0123,
          num_turns: 2,
          duration_ms: 5,
          modelUsage: {},
          permission_denials: [],
        };
      }
    })() as AsyncGenerator<SDKMessage, void>;

    return Object.assign(messages, {
      initializationResult: async () => ({
        models: [
          { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet', description: 'Fixture model' },
        ],
        account: { email: 'fixture@example.invalid', subscriptionType: 'Fixture plan' },
        pid: 999_999,
      }),
      interrupt: async () => {
        calls.interrupted++;
      },
      close: () => {
        closed = true;
        calls.closed++;
        calls.release?.();
      },
    });
  };

  return { query, calls };
}
