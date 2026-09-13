# Notes for coding agents

Read `docs/harness.md` before changing how runs work.

- TypeScript for Bun. Share types, states, and commands through `shared/`.
- Match existing patterns and reuse helpers.
- Comment only constraints the code can't show.
- Sentence case copy, no em or en dashes.
- A check, pull request, or merge counts only when the factory saw it happen.
- Update `docs/product-gaps.md` when you close or find a gap.
- Run `bun run check` and `bun run test` before finishing, plus `bun run test:browser` for interface changes.
