# Contributing

Thanks for helping. Local Factory is small on purpose, so most changes are a module or two plus tests.

## Setup

You need macOS, [Bun](https://bun.sh) 1.2.10 or newer, Git, and `codex-cli 0.154.0`.

```sh
bun install
bun run dev
```

The service runs at http://localhost:4310. For hot reload on the interface, keep it running and start `bun run ui` in a second terminal.

## Before you open a pull request

```sh
bun run check
bun run test
```

`check` typechecks everything, lints, and builds the interface. `test` runs the runner, delivery, and API against real Git with fake agents, so it needs no sign-in and makes no model calls.

If you changed the interface, also run `bun run test:browser` (it needs the [`agent-browser`](https://github.com/vercel-labs/agent-browser) CLI) and refresh the README images with `bun run screenshots`.

## Where things live

- `server.ts` starts the local service
- `backend/` holds the runner, delivery, the local API, and the Codex, Claude, and OpenCode adapters in `backend/agents/`
- `shared/` holds task types, states, and delivery commands used by both sides
- `web/` is the React interface
- `test/` has the Bun tests, fakes for each agent, and the browser check
- `docs/` explains how runs work and tracks what is built in `docs/product-gaps.md`

## How we write code

- TypeScript for Bun. Share types and states through `shared/` instead of redefining them.
- Match the patterns already in the file you're touching, and reuse existing components and helpers before adding new ones.
- Keep modules small and single-purpose.
- Skip comments unless they explain a constraint the code can't show.
- Interface copy uses sentence case and no em dashes.
- Never treat an agent's message as proof. Checks, merges, and pull requests count only when the factory verified them itself.

If your change implements or affects a requirement in `docs/product-gaps.md`, update its status and link the test that proves it.

`AGENTS.md` repeats these rules for coding agents, so you can point Codex or Claude at this repo and get the same results.

## Reporting bugs

Open an issue with what you did, what you expected, and what happened. The activity download from a task's ⋯ menu and `.factory/service.log` usually show the cause. For security problems, see [SECURITY.md](SECURITY.md).
