# Usage

## Start

Sign in to the agents you use: `codex login`, `claude auth login`, or `bunx opencode auth login`. Codex must be installed either way.

```sh
bun install
bun run dev
```

Open http://localhost:4310. Set `PORT` to change it.

## Create a task

1. Connect a repository and confirm you trust it.
2. Press N, describe the change, and pick the agent, model, and permissions.
3. Leave Options empty to use the lockfile for setup and the check the agent names.

| Permissions | Behavior | Time per attempt |
| --- | --- | --- |
| Ask me | Questions and requests wait for you | 15 min |
| Automatic, sandboxed | Agent decides, requests outside the sandbox are declined | 45 min |
| Automatic, full access | Agent decides, requests are approved | 45 min |

Automatic tasks retry a failed check up to 3 attempts.

## Review

- **Activity:** messages, tool calls, questions, and live output while a run works
- **Changes:** the diff
- **Preview:** screenshots, page errors, Start app
- **Details:** settings, instruction files, cost, rollback

The bell next to the connection status picks sound, banner, both, or off. The tab icon counts tasks that need you.

## Keys

- **N:** new task
- **/:** search
- **J and K:** next and previous task
- **Cmd+K:** tasks, actions, and repositories
- **Up arrow** in an empty task box: earlier briefs
- **Cmd+Enter:** submit

## Finish

- **Open pull request:** needs an `origin` remote and `gh auth login`
- **Merge:** commits and merges into your current branch
- **Commit to branch only:** in the ⋯ menu
- **Another attempt:** write what to change and run again
- **Roll back, Undo commit, Revert:** undo at any stage

Anything that changes your files asks first.

## Commands

Commands in agent messages get a Run button. They run in your shell in the worktree, one at a time, after the agent finishes.

## Data

Everything lives in `.factory/`: the database, worktrees, caches, and patches. Agents get your global and repository `CLAUDE.md` and `AGENTS.md`, without your settings, hooks, or MCP servers.
