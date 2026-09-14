import { createSdkMcpServer, query as sdkQuery, tool, type AccountInfo, type CanUseTool, type McpServerConfig, type ModelInfo, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentProbe, PromptImage } from '../../shared/types';
import { previewTools, type ToolResult } from '../browser';
import { safeEnv } from '../process';

export type { CanUseTool, McpServerConfig, ModelInfo, PermissionResult, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export const supportedClaudeVersion = '2.1.268';
const modelSuffix = /\s*\([^)]*\)\s*$/;
export const claudeTools = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'AskUserQuestion'];
export const claudeSandbox = { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: true, network: { allowedDomains: [] as string[] } };

export type ClaudeQuery = typeof sdkQuery;
export type ToolRequestOptions = Parameters<CanUseTool>[2];

type Turn = { text: string; images: PromptImage[] };

export type ClaudeSession = {
  messages: AsyncIterable<SDKMessage>;
  info: () => Promise<{ account: AccountInfo; models: ModelInfo[]; pid?: number }>;
  send: (text: string, images?: PromptImage[]) => void;
  interrupt: () => Promise<unknown>;
  close: () => void;
};

type OpenClaudeOptions = { query?: ClaudeQuery; cwd: string; model?: string; instructions?: string; canUseTool: CanUseTool; mcpServers?: Record<string, McpServerConfig> };

export const factoryServerName = 'factory';
export const isFactoryTool = (name: string) => name.startsWith(`mcp__${factoryServerName}__`);

export function factoryServer(handle: (name: string, input: unknown) => Promise<ToolResult>) {
  return createSdkMcpServer({
    name: factoryServerName,
    version: '1.0.0',
    alwaysLoad: true,
    timeout: 120_000,
    tools: Object.entries(previewTools).map(([name, spec]) => tool(name, spec.description, spec.shape, async input => {
      const result = await handle(name, input);
      return {
        isError: Boolean(result.error),
        content: result.content.map(item => item.type === 'text' ? { type: 'text' as const, text: item.text } : { type: 'image' as const, data: item.data, mimeType: 'image/png' }),
      };
    })),
  });
}

export function openClaude({ query = sdkQuery, cwd, model, instructions, canUseTool, mcpServers = {} }: OpenClaudeOptions): ClaudeSession {
  const prompt = Promise.withResolvers<Turn | null>();
  const finished = Promise.withResolvers<void>();
  let closed = false;

  async function* input() {
    const turn = await prompt.promise;
    if (turn) {
      const content = [
        ...turn.images.map(image => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: image.mediaType, data: image.base64 } })),
        { type: 'text' as const, text: turn.text },
      ];
      yield { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null } as SDKUserMessage;
    }
    await finished.promise;
  }

  const session = query({
    prompt: input(),
    options: {
      cwd,
      canUseTool,
      env: { ...safeEnv(), CLAUDE_AGENT_SDK_CLIENT_APP: 'local-factory/0.3.0' },
      settingSources: [],
      strictMcpConfig: true,
      mcpServers,
      persistSession: false,
      includePartialMessages: true,
      permissionMode: 'acceptEdits',
      tools: claudeTools,
      sandbox: claudeSandbox,
      ...(model && model !== 'default' ? { model } : {}),
      ...(instructions ? { systemPrompt: { type: 'preset', preset: 'claude_code', append: instructions } as const } : {}),
    },
  });

  return {
    messages: session,
    async info() {
      const init = await session.initializationResult();
      return { account: init.account, models: init.models, pid: (init as { pid?: number }).pid };
    },
    send: (text, images = []) => prompt.resolve({ text, images }),
    interrupt: () => session.interrupt().catch(() => undefined),
    close() {
      if (closed) return;
      closed = true;
      prompt.resolve(null);
      finished.resolve();
      session.close();
    },
  };
}

export async function probeClaude(query?: ClaudeQuery): Promise<AgentProbe> {
  const session = openClaude({ query, cwd: process.cwd(), canUseTool: async () => ({ behavior: 'deny', message: 'Connection check only' }) });
  try {
    const { account, models } = await session.info();
    // An alias row such as 'default' names itself and nothing else, so it carries the name of the model it resolves to.
    const named = new Map(models.filter(model => model.resolvedModel === model.value).map(model => [model.value, model.displayName]));
    return {
      harness: 'claude',
      version: supportedClaudeVersion,
      authenticated: Boolean(account.email || account.apiKeySource),
      account: account.subscriptionType,
      models: models.map(model => {
        const resolved = model.resolvedModel && model.resolvedModel !== model.value ? named.get(model.resolvedModel) ?? model.resolvedModel : undefined;
        return { id: model.value, name: model.displayName.replace(modelSuffix, ''), isDefault: model.value === 'default', detail: resolved };
      }),
    };
  } finally {
    session.close();
  }
}
