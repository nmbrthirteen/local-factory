const commandTimeoutMs = 60_000;

export function agentBrowser(session: string) {
  async function browser(...args: string[]) {
    const child = Bun.spawn(['agent-browser', '--session', session, ...args], { stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => child.kill(), commandTimeoutMs);
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    clearTimeout(timer);
    if (exitCode !== 0) throw new Error(`agent-browser ${args.join(' ')} failed: ${stderr.trim() || stdout.trim()}`);
    return stdout.trim();
  }

  return {
    browser,
    evaluate: async (script: string) => JSON.parse(await browser('eval', '-b', Buffer.from(script).toString('base64'))),
    waitFor: (script: string) => browser('wait', '--fn', `Boolean(${script})`),
  };
}
