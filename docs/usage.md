# Using Local Factory

## Before you start

You need macOS, [Bun](https://bun.sh) 1.2.10 or newer, Git, and `codex-cli 0.154.0`. Setup and checks run in the Codex sandbox, so Codex has to be installed even if you only use Claude or OpenCode.

Sign in to the agents you plan to use:

- Codex: `codex login`
- Claude: `claude auth login`
- OpenCode: `bunx opencode auth login`. Its free models work without signing in.

```sh
bun install
bun run dev
```

Open http://localhost:4310. Set `PORT` to use a different port. If you're working on the interface itself, keep the service running and start `bun run ui` for hot reload.

## Connect a repository

Point Local Factory at a Git repository and confirm you trust it, since setup and checks run its scripts. Add more from the repository menu at the top of the sidebar and switch between them there. Every task gets its own worktree in `.factory/worktrees/<repository>/<task id>`, so your working copy stays as it is.

## Create a task

Press N or click New. Describe the change and what done looks like, then pick the repository, agent, model, and permissions. You can leave Options empty: setup comes from the lockfile, the title from your first line, and the agent writes tests and tells the factory which command checks them.

Permissions decide how much the agent does on its own:

- **Ask me.** Questions and permission requests wait for you.
- **Automatic, sandboxed.** The agent answers its own questions, and anything outside the sandbox is declined.
- **Automatic, full access.** Same, except requests outside the sandbox are approved.

Automatic tasks retry a failed check up to 3 times, with 45 minutes of working time per attempt. Tasks that ask you get 15 minutes, and the clock pauses while a question waits for you. You can change permissions from the task header at any time, even mid-run.

## Watch it work

The sidebar groups tasks by what they need from you: Needs you, Working, Ready for review, Not started, and Settled. Hover a task to see its status, check, branch, and changes without opening it. J and K move between tasks, and / searches.

Inside a task:

- **Activity** shows the agent's messages, tool calls folded into short summaries, and the factory's own steps. Switch to Everything to see every event. Questions and permission requests appear at the bottom.
- **Changes** shows the diff for each file.
- **Preview** shows desktop and phone screenshots of the app after the check, along with any page errors. Retake captures them again. Start app runs it from the worktree so you can click around yourself with Open app, and it stops when you merge or settle the task.
- **Details** has the brief, run settings, the instruction files the agent received, an estimated cost, rollback, and cleanup.

## Finish a task

The agent's files stay in the task's worktree until you finish. Show files in Finder opens that folder.

- **Open pull request** appears when the repository has a GitHub `origin`. It commits the work, pushes the task branch, and opens a pull request with GitHub CLI (run `gh auth login` first). While it's open, the check bar has `gh pr merge` and `gh pr close` with Run buttons.
- **Merge** commits the work, merges it into your repository's current branch, and removes the worktree. It refuses when you have uncommitted changes and backs out cleanly on conflicts.
- **Commit to branch only**, in the ⋯ menu, leaves the merge to you: `git merge factory/<task id>`.

Not what you wanted? Write what to change and run another attempt. The agent continues in the same worktree with the last check output and your note.

A task that passed stays in Ready for review until you settle it, commit or merge it, or remove its worktree. Nothing is pushed unless you open a pull request.

## Undo things

- **Roll back** restores the worktree to any earlier attempt or to the original code.
- **Undo commit** takes the commit off the task branch and keeps the changes.
- **Revert** shows up after a merge as `git revert -m 1 --no-edit <merge commit>` with Copy and Run. It only runs on the branch the merge landed on, with no uncommitted changes.

Anything that changes your files or branches asks first.

## Run commands the agent suggests

When an agent's message tells you to run something, shell code blocks and inline commands for common tools, like `npm run ui`, get a Run button. Commands with placeholders such as `...` or `<file>` stay copy only. Run asks first, then runs the command with your login shell in the task's worktree, or in the repository once the worktree is gone. Output streams into a panel above the follow-up box, with Stop while it runs and an Open link when it prints a local address. Commands wait until the agent run ends, and each task runs one at a time. If a command changes tracked files, Commit asks for another attempt so the check runs again.

## What agents get

Agents don't load your personal settings, hooks, plugins, or MCP servers. They do get your global `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, and `~/.config/opencode/AGENTS.md`, plus the repository's root `CLAUDE.md` and `AGENTS.md`, each included once even when files are identical. Details lists the files a run used. A failed run never switches to a different agent.

Everything lives in `.factory/`: the SQLite database, worktrees, package caches, and patches. Worktrees and `factory/*` branches stay until you remove them.

## Checks

```sh
bun run check
bun run test
bun run probe
bun run test:browser
```

- `check` typechecks the service, tests, and interface, then builds the interface.
- `test` runs the runner, delivery, and API against real Git, with fake Codex, Claude, and OpenCode sessions and a stand-in GitHub CLI, so it needs no sign-in.
- `probe` checks your installed Codex version, sign-in, and sandbox without starting a model turn.
- `test:browser` builds the interface and walks through it in a real browser with the [`agent-browser`](https://github.com/vercel-labs/agent-browser) CLI. It never runs a model or touches your repositories.
