# Notes for coding agents

Read `docs/harness.md` and `docs/product-gaps.md` before changing how runs work.

- Write TypeScript for Bun. Share task types, states, and delivery commands through `shared/` instead of redefining them in `backend/` or `web/`.
- Match the patterns in the files you touch, and reuse existing components and helpers before adding new ones.
- Skip comments unless they explain a constraint the code can't show.
- Interface copy uses sentence case and no em or en dashes.
- Never treat an agent's message as proof. A check passed, a pull request opened, or a merge happened only when the factory saw it happen.
- When you implement a requirement from `docs/product-gaps.md`, update its status and link the test that proves it. Add any new gap you run into.
- Before you finish, run `bun run check` and `bun run test`. For interface changes, also run `bun run test:browser`, which covers desktop and phone widths.
