import { Codex, isolatedConfig } from '../backend/agents/codex';

const client = new Codex({ cwd: process.cwd() });
const report = (value: object) => console.log(JSON.stringify(value));

try {
  console.log('Version:', await Codex.version());
  await client.connect();
  const account = await client.request('account/read', { refreshToken: false });
  const models = await client.request('model/list', { limit: 100 });
  const { config } = await client.request('config/read', { includeLayers: false });
  report({
    connected: true,
    signedIn: Boolean(account.account),
    modelCount: models.data.length,
    configuredMcpServers: Object.values(config.mcp_servers ?? {}).filter((server: any) => server.enabled !== false).length,
    hooksEnabled: config.features?.hooks,
    appsEnabled: config.features?.apps,
    pluginsEnabled: config.features?.plugins,
  });
  const result = await client.request('command/exec', { command: ['/usr/bin/printf', 'sandbox-probe'], cwd: process.cwd(), sandboxPolicy: { type: 'readOnly', networkAccess: false }, timeoutMs: 10_000 });
  report({ sandboxCheckExit: result.exitCode, expectedOutput: result.stdout === 'sandbox-probe', stderr: result.stderr });
  const defaultModel = models.data.find((model: { isDefault: boolean }) => model.isDefault).model;
  const thread = await client.request('thread/start', { cwd: process.cwd(), model: defaultModel, sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user', config: isolatedConfig(config), ephemeral: true });
  report({ threadCreated: Boolean(thread.thread.id), sandbox: thread.sandbox, approvalPolicy: thread.approvalPolicy, approvalsReviewer: thread.approvalsReviewer });
} finally {
  client.close();
}
