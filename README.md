# Local Factory

Run coding agents on your real repos, and only merge what passed a check you can see.

Local Factory is a small app that runs on your Mac. You describe a change, Codex, Claude, or OpenCode builds it in its own Git worktree, and the factory runs your tests itself before you look at the diff. When the agent has a question or wants permission for something, it asks you in the same window.

![A finished task with its activity and a passing check](docs/images/activity.png)

![An agent asking how to handle a leftover cent](docs/images/question.png)

![The diff for the finished task](docs/images/changes.png)

## Why use it

- **Checks it runs itself.** The factory runs the check offline and ties the result to the exact files the agent produced. Change a file afterwards and it won't let you commit until the check runs again. A task with no check shows as unchecked, never as passed.
- **See it before you merge.** For apps with a dev or start script, the factory captures desktop and phone screenshots after the check and can start the app from the worktree so you can open it and click around.
- **Same controls for every agent.** Codex, Claude, and OpenCode work with the same sandbox, approvals, and time limits. If an agent starts with different settings than the factory asked for, the run stops.
- **You decide what lands.** Answer questions, roll back to any attempt, merge or open a pull request, and revert later, all from the task.
- **Nothing hosted.** It uses the agent sign-ins you already have and keeps tasks in SQLite on your machine.

## What it uses

- Bun and TypeScript for the local service, with `bun:sqlite` for tasks and events
- React, Tailwind, and Vite for the interface, built on [Beautiful UI](https://www.beautifului.dev/) primitives
- Git worktrees, one per task, so your working copy stays untouched
- Codex app server, the Claude Agent SDK, and OpenCode as the agents
- Agent sandboxes and macOS `sandbox-exec`, so agents work offline and only write inside their worktree
- GitHub CLI for pull requests, if you want them

## Run it locally

You need macOS, [Bun](https://bun.sh) 1.2.10 or newer, Git, and `codex-cli 0.154.0`. Setup and checks run in the Codex sandbox, so install Codex even if you plan to use Claude or OpenCode. Then sign in to the agents you want: `codex login`, `claude auth login`, or `bunx opencode auth login`.

```sh
git clone https://github.com/nmbrthirteen/local-factory.git
cd local-factory
bun install
bun run dev
```

Open http://localhost:4310, connect a repository, and create your first task.

## Good to know

- It runs one task at a time.
- It's macOS only for now, because OpenCode's commands run under `sandbox-exec`.
- Codex has to be installed for every agent, since setup and checks use its sandbox.
- No second agent reviews the work yet. You're the reviewer.

## More

- [Using it](docs/usage.md): the full workflow, shortcuts, and checks
- [How runs work](docs/harness.md): sandboxing, approvals, and delivery
- [What's built](docs/product-gaps.md): the requirement list and what's still missing
- [Interface notes](docs/design.md)
- [Contributing](CONTRIBUTING.md) and [security](SECURITY.md)

Found a bug or have an idea? [Open an issue](https://github.com/nmbrthirteen/local-factory/issues).

## License

[MIT](LICENSE)
