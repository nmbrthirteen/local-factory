import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { supportedClaudeVersion } from '../backend/agents/claude';

type Script = { approval?: boolean; question?: boolean; wait?: boolean; plugins?: object[]; factoryTool?: boolean };
type Options = Record<string, any> & { canUseTool: (tool: string, input: object, options: object) => Promise<any> };

const requestOptions = (toolUseID: string) => ({ signal: new AbortController().signal, toolUseID, requestId: `request-${toolUseID}` });

export function fakeClaude(script: Script = {}) {
  const calls: Record<string, any> = { closed: 0, interrupted: 0 };

  const query = ({ prompt, options }: { prompt: AsyncIterable<any>; options: Options }) => {
    calls.options = options;
    let closed = false;
    const messages = (async function* () {
      for await (const message of prompt) {
        const content = message.message.content;
        calls.content = content;
        calls.prompt = content.filter((block: { type: string }) => block.type === 'text').map((block: { text: string }) => block.text).join('\n');
        yield { type: 'system', subtype: 'init', claude_code_version: supportedClaudeVersion, cwd: options.cwd, model: 'claude-sonnet-5', permissionMode: options.permissionMode, tools: [...options.tools, ...Object.keys(options.mcpServers).map(name => `mcp__${name}__preview_open`)], mcp_servers: Object.keys(options.mcpServers).map(name => ({ name, status: 'connected' })), plugins: script.plugins ?? [] };
        if (script.factoryTool) calls.factoryDecision = await options.canUseTool('mcp__factory__preview_logs', {}, requestOptions('tool-3'));
        if (script.wait) {
          await new Promise(resolve => { calls.release = resolve; });
          if (closed) return;
        }
        if (script.approval) calls.decision = await options.canUseTool('Bash', { command: 'curl https://example.invalid' }, { ...requestOptions('tool-1'), title: 'Claude wants to run curl' });
        if (script.question) {
          const questions = [{ question: 'Which output?', header: 'Output', options: [{ label: 'implemented', description: 'Expected text' }, { label: 'other', description: 'Anything else' }], multiSelect: false }];
          calls.answer = await options.canUseTool('AskUserQuestion', { questions }, requestOptions('tool-2'));
        }
        await writeFile(join(options.cwd, 'output.txt'), 'implemented\n');
        yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Implemented with Claude' }, { type: 'tool_use', name: 'Write', input: { file_path: 'output.txt' } }] } };
        yield { type: 'result', subtype: 'success', is_error: false, result: 'Done', total_cost_usd: 0.0123, num_turns: 2, duration_ms: 5, modelUsage: {}, permission_denials: [] };
      }
    })();
    return Object.assign(messages, {
      initializationResult: async () => ({ models: [{ value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet' }], account: { email: 'fixture@example.invalid', subscriptionType: 'Fixture plan' }, pid: 999_999 }),
      interrupt: async () => { calls.interrupted++; },
      close: () => {
        closed = true;
        calls.closed++;
        calls.release?.();
      },
    });
  };

  return { query, calls };
}
