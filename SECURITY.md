# Security

Local Factory runs coding agents and shell commands on your machine, so security reports matter a lot here.

## Reporting a vulnerability

Please don't open a public issue. Use [private vulnerability reporting](https://github.com/nmbrthirteen/local-factory/security/advisories/new) on this repository instead, with steps to reproduce and the version you ran.

## What the factory protects

- **The local API** listens on 127.0.0.1 only and requires a session cookie plus matching Host and Origin headers, so other websites can't drive it.
- **Agent runs** work in their own Git worktree with network access off. Codex and Claude use their own sandboxes, and OpenCode's shell commands run under macOS `sandbox-exec`. Writes are limited to the worktree and a shared package cache.
- **Your settings** stay out of agent runs: no personal hooks, plugins, or MCP servers load, and agents get an allowlisted environment instead of yours.
- **Permission requests** from an agent come to you unless you chose an automatic mode for that task.
- **Delivery commands** such as revert or `gh pr merge` come from a fixed allowlist, and the browser sends only a command ID.

## What it doesn't protect against

- **Repository scripts** run during setup and checks. You confirm you trust a repository before connecting it, and that trust is what makes those scripts safe to run.
- **Commands you run from the interface** use your login shell outside the sandbox. The confirm dialog shows the exact command first.
- **Other local processes** running as your user can reach the loopback API.
- **Code sent to the model**: task text and repository context go to whichever model provider you picked.
