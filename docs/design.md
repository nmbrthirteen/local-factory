# Interface

Components come from [Beautiful UI](https://www.beautifului.dev/). Tokens live in `web/src/styles/app.css`. Inter for text, JetBrains Mono for code. Light and dark follow the system.

## Layout

- **Sidebar:** repository menu, search, and tasks grouped by Needs you, Working, Ready for review, Not started, and Settled. Hover a task for a summary.
- **Panel:** the composer, a task, or an empty state.
- **Task:** header actions, the check strip, and tabs for Activity, Changes, Preview, and Details.

## Behavior

- One primary finish action: Open pull request with an `origin` remote, otherwise Merge.
- Actions that change files or branches share one confirm dialog that shows the exact command.
- Commands in agent messages get a Run button and stream output into a panel.
- Toasts confirm actions. Desktop notifications fire while the tab is hidden.

## Copy

Short, direct, sentence case: "Check passed", "Merged into main". Paths and output sit behind expand.
