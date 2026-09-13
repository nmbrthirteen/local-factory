# Contributing

## Setup

Needs macOS, [Bun](https://bun.sh) 1.2.10+, Git, and `codex-cli 0.154.0`.

```sh
bun install
bun run dev   # http://localhost:4310
bun run ui    # hot reload, in a second terminal
```

## Before a pull request

```sh
bun run check          # lint, typecheck, build
bun run test           # real Git, fake agents, no sign-in
bun run test:browser   # interface changes, needs agent-browser
```

If the interface changed, refresh the README images with `bun run screenshots`.

## Layout

- `server.ts`: starts the service
- `backend/`: runner, delivery, API, agent adapters
- `shared/`: types, states, and commands used by both sides
- `web/`: React interface
- `test/`: tests, fake agents, browser check

## Code

- Share types through `shared/`.
- Match existing patterns and reuse helpers.
- Comment only constraints the code can't show.
- Sentence case copy, no em dashes.
- Trust what the factory verified, never an agent's message.

## Bugs

Open an issue with steps, expected, and actual result. Attach the task's activity download or `.factory/service.log`. Security issues go through [SECURITY.md](SECURITY.md).
