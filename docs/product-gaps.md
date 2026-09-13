# Status

Local Factory works for one person running one task at a time on macOS. `bun run test` covers the backend against real Git with fake agents, and `test/browser.ts` covers the interface.

## Built

- Codex, Claude, and OpenCode in isolated worktrees with a verified sandbox and approval policy
- Setup, offline checks run by the factory, automatic retries
- Questions and permission requests
- Screenshots, a running app to try, and preview tools for agents
- Merge, pull requests, revert, rollback, another attempt
- Run buttons for commands in agent messages
- Search, notifications, command palette, recovery after restart

## Partial

- Cost is an estimate for Claude and OpenCode, and missing for Codex
- Setup and checks need Codex installed for every agent
- Logs are not redacted
- Base branch changes are checked only at start
- Pull requests open ready for review, not as drafts

## Not built

- Independent reviewer and repair loop
- Patch download and disk usage reporting
- Parallel tasks
- Linux and Windows
- Local models
- Schedules, webhooks, reusable recipes
- Remote and team use

When you ship something here or find a gap, update this list.
