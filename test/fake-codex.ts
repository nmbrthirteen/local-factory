import { appendFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

type Message = { id?: string | number; method?: string; params?: Record<string, any>; result?: Record<string, any> };

let cwd = '';
let waiting = false;

const send = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
const notify = (method: string, params: object) => send({ method, params });
const complete = () => notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } });

function handoffFor(input: string) {
  if (input.includes('NAME_CHECK')) return 'Implemented the fixture\nCHECK: node -e "process.exit(require(\'node:fs\').existsSync(\'output.txt\') ? 0 : 1)"';
  if (input.includes('TRIVIAL_CHECK')) return 'Implemented the fixture\nCHECK: true';
  return 'Implemented the fixture';
}

async function startTurn(input: string) {
  notify('turn/started', { threadId: 'thread-1', turn: { id: 'turn-1' } });
  if (input.includes('WAIT_FOREVER')) return;
  await writeFile(`${cwd}/output.txt`, 'implemented\n');
  if (input.includes('RECORD_PROMPT')) await appendFile(`${cwd}.prompts`, `${input}\n---\n`);
  if (input.includes('Owner feedback') || input.includes('Note from the factory')) await writeFile(`${cwd}/fixed.txt`, 'fixed\n');
  if (input.includes('LARGE_DIFF')) await writeFile(`${cwd}/large.txt`, 'x'.repeat(3 * 1024 * 1024));
  if (input.includes('LIVE_PROGRESS')) {
    for (const delta of ['Streaming ', 'reply']) notify('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', itemId: 'msg-1', delta });
  }
  notify('item/completed', { threadId: 'thread-1', item: { type: 'agentMessage', text: handoffFor(input) } });
  if (input.includes('PREVIEW_TOOL')) return send({ id: 'tool-call', method: 'item/tool/call', params: { threadId: 'thread-1', turnId: 'turn-1', callId: 'call-1', tool: 'preview_logs', arguments: {} } });
  if (!input.includes('REQUEST_APPROVAL')) return complete();
  waiting = true;
  send({ id: '001', method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'tool-1', command: 'fixture-command', cwd } });
}

async function execute({ command: [command, ...args], cwd: directory, env }: Record<string, any>) {
  const child = Bun.spawn([command, ...args], { cwd: directory, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill(), 3000);
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearTimeout(timer);
  return { stdout, stderr, exitCode };
}

createInterface({ input: process.stdin }).on('line', async line => {
  const message: Message = JSON.parse(line);
  const reply = (result: object) => send({ id: message.id, result });
  if (!message.method) {
    if (message.id === 'tool-call') {
      await writeFile(`${cwd}.tool`, JSON.stringify(message.result));
      notify('item/completed', { threadId: 'thread-1', item: { type: 'dynamicToolCall', id: 'call-1', tool: 'preview_logs', success: message.result?.success, contentItems: message.result?.contentItems } });
      return complete();
    }
    if (waiting) {
      waiting = false;
      complete();
    }
    return;
  }
  const params = message.params ?? {};
  switch (message.method) {
    case 'initialize':
      return reply({ userAgent: 'test' });
    case 'account/read':
      return reply({ account: { type: 'chatgpt' } });
    case 'config/read':
      return reply({ config: {} });
    case 'model/list':
      return reply({ data: [{ model: 'test-model', displayName: 'Test model', isDefault: true }] });
    case 'thread/start':
      cwd = params.cwd;
      await writeFile(`${cwd}.tools`, JSON.stringify(params.dynamicTools ?? []));
      return reply({ thread: { id: 'thread-1' }, cwd, model: params.model, sandbox: { type: 'workspaceWrite', networkAccess: false }, approvalPolicy: 'on-request', approvalsReviewer: 'user' });
    case 'turn/start':
      reply({ turn: { id: 'turn-1' } });
      return startTurn(params.input[0].text);
    case 'command/exec': {
      const result = await execute(params);
      if (!params.streamStdoutStderr) return reply(result);
      for (const stream of ['stdout', 'stderr'] as const) {
        if (result[stream]) notify('command/exec/outputDelta', { processId: params.processId, stream, deltaBase64: Buffer.from(result[stream]).toString('base64'), capReached: false });
      }
      return reply({ ...result, stdout: '', stderr: '' });
    }
    case 'turn/interrupt':
      reply({});
      return notify('turn/completed', { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } });
  }
});
