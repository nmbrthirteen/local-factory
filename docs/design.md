# Interface design

## System

Components come from the [Beautiful UI](https://www.beautifului.dev/) shadcn registry, adapted to real data. `web/src/styles/app.css` holds the tokens: cool near-white canvas, white surfaces, hairline borders, layered shadows, a neutral ink ramp, and color reserved for state. Inter for interface text, JetBrains Mono for commands, paths, and diffs. Light and dark follow the system.

Shared pieces are in `web/src/components/atoms` and `web/src/components/primitives` (GlideMenu, LoadingState, Modal), with syntax highlighting in `web/src/lib/highlight.tsx`. App components are in `web/src/components/app`.

## Layout

A sidebar on the canvas and one floating panel. Below 768px the window shows the list or the task, with a Tasks back button.

### Sidebar

`Sidebar.tsx` starts with the repository menu (`RepositoryMenu.tsx`: known repositories, an uncommitted changes marker, Add repository) and the connection state. Search and New sit below.

Tasks that need you or are working show as cards at the top. Ready for review, Not started, and Settled follow as collapsible sections that remember their state, 8 rows each before Show more. The list holds the latest 50 tasks, and search finds older ones. Each state has its own icon shape, so color is never the only signal.

Hovering a row for 400 ms opens `TaskPeek.tsx`, a card with state, age, agent and model, repository, attempt, permissions, check, branch, change summary, and your last note. It is off on touch screens and closes on scroll. Each row also has a ⋯ menu (`TaskMenu.tsx`) with Open, the actions the task allows, Permissions, roll back targets, Show files in Finder, Download activity, and Remove worktree.

### Panel

The panel shows the composer, one task, or an empty state. After an interrupted run, a banner asks you to stop leftover processes and acknowledge.

The composer (`NewTask.tsx`) has a description, menus for Repository, Agent, Model, and Permissions, and Create task. Under it, the agent's sign-in state shows Ready or the sign-in command, and clicking checks again. Options holds title, setup, and check, each picked automatically when empty. The draft survives reloads, and the composer opens on its own when every task is settled.

Connecting a repository (`ConnectRepo.tsx`) is a full page on first launch and the Add repository modal after. It needs the folder path and a checked "I trust this repository and the scripts it runs."

### Task

The header shows title, state, repository, agent, model, attempt, and branch, then the actions: Permissions, Stop, Undo commit, Start run, Open app while the app runs, Open pull request or Merge, and ⋯. The header ⋯ menu holds Merge locally when a pull request is offered, Commit to branch only, Settle, roll back targets, Show files in Finder, Download activity, and Remove worktree.

The check strip (`CheckStrip.tsx`) carries the outcome: running, passed with command and duration, failed with output open, no check ran with a warning, committed with a `git merge` row to copy, merged with its revert command, pull request open with its link and merge and close commands, or reverted. Before delivery it notes the files are in the worktree until you merge, with Show files in Finder. Command rows have Copy and Run.

Four tabs, switchable with arrow keys:

1. Activity (`Activity.tsx`): agent messages as Markdown, consecutive tool calls folded into a summary such as "1 read, 2 edits, 1 command", and service events as one-line rows. Failed rows show the exit code and expand to output, and screenshots show inline. Summary hides bookkeeping events and Everything shows all. Requests, the command panel, and the follow-up composer sit at the bottom.
2. Changes (`Changes.tsx`): totals, a chip per file, and a collapsible diff per file with old and new line numbers and syntax highlighting. Diffs over 800 lines start collapsed.
3. Preview (`Preview.tsx`): the screenshot result with its command, Take or Retake screenshots, and Start app. A running app gets a bar with its URL, Stop, and Open app. Page errors, desktop and phone screenshots, and app output follow.
4. Details (`Details.tsx`): the description, run settings, instruction files, usage, a Roll back list with Restore for each attempt and the original code, Download activity, and Remove worktree.

Clicking any screenshot (`Screenshot.tsx`) opens it full size in a modal.

## Behavior

Finishing is one primary action: Open pull request when the repository has an `origin` remote, otherwise Merge. Merge commits, merges into the current branch, and removes the worktree.

Consequential actions share one confirm dialog (`ConfirmProvider.tsx`): pull requests, merges, delivery commands, suggested commands, restores, and worktree removal. It shows a question, what will happen, the exact command when there is one, and a button named for the action. Restore and Remove worktree use the danger style and say what survives, such as "The branch keeps your commit."

Permission requests (`Requests.tsx`) show the reason, command, and any path outside the worktree, with Decline and Allow once. Questions step through one at a time, and picking an option advances.

Once a run finishes, shell blocks and inline commands in agent messages get a Run button. After confirming, `CommandPanel.tsx` shows status, live output, a link to the first local URL, and Stop or Run again.

Successful actions confirm in a toast that clears after 5 seconds, and errors stay until dismissed. While the tab is hidden, a task that needs you, is ready for review, or failed raises a desktop notification. The tab title counts tasks that need you.

Activity follows new events until you scroll up, and Jump to latest resumes. The newest agent message streams in once. A working task shows a pixel loader with elapsed time.

Keyboard: N new task, / search, J and K next and previous task, Esc closes the composer, Cmd or Ctrl with Enter submits.

## Copy

Visible text is a direct action or a short sentence: "Check passed", "Merged into main", "Allowed Bash automatically". Activity rows are one line with the one detail that matters, such as a command, branch, or exit code. Paths, output, and links sit behind expand. The service writes event text this way at the source, and agents are told to keep their messages short.
