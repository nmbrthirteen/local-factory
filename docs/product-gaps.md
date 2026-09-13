# Requirements and gaps

This is the requirement register for Local Factory, a single-user local app that runs coding agents on real repositories and helps you review and deliver their work. Each requirement has an ID, a status, a release gate, and acceptance criteria. Evidence for partial work is listed below the tables. The register tracks known gaps; it does not prove there are no others.

## Where things stand

Built: a Bun and TypeScript service (`server.ts`, `backend/`, with types in `shared/`) behind an authenticated loopback API, SQLite storage for tasks and events, and a React interface in `web/`. Three agents are supported through pinned adapters in `backend/agents/`: Codex App Server 0.154.0, Claude through the Claude Agent SDK, and OpenCode 1.18.30 with its shell commands under `sandbox-exec`. Each task gets its own Git worktree and branch, an optional setup command with network access, one agent turn with a verified sandbox and approval policy, and an offline check the factory runs itself. Approvals and questions come to you, or the task can decide on its own. After the check, the factory captures screenshots of the app the agent built and can keep it running for you to open. From the task you can run another attempt, roll back, commit, merge, open a pull request, revert a merge, and run suggested commands inline. `bun run test` covers the runner, delivery, previews, live apps, inline commands, and the API against real Git, with fake Codex, Claude, and OpenCode sessions and a stand-in GitHub CLI. `bun run test:browser` runs the interface checks in `test/browser.ts`.

Not built: an independent reviewer, stable finding IDs, patch download, disk reporting, usage reporting for Codex, and everything past R2 below. `agents/reviewer.md` exists, but only `agents/implementer.md` is loaded.

Real runs: on 2026-09-11 a Claude run completed a task on a fixture repository (worktree, `npm ci` setup, implementation, `npm test` exiting 0, handoff) for an estimated $0.09 over 4 model turns, and a Codex run stopped on the account usage limit. On 2026-09-13 the same fixture passed with OpenCode on `opencode/big-pickle` in 18 seconds and with Codex 0.154.0 in 50 seconds, and a second Codex attempt applied feedback in the same worktree and passed again. On a repository with two modules, the whole-repository check failed an OpenCode task that fixed only one module, and another attempt with feedback fixed both. Claude and Codex also passed clamp-only tasks there.

## Status legend

- **Partial:** real behavior exists with evidence below, but acceptance is incomplete.
- **Draft:** a UI or document exists without the production behavior.
- **Missing:** no implementation.
- **Deferred:** beyond the first local release.

No requirement is marked complete.

## Release gates

- **R1:** one real local task with human control.
- **R2:** verified review and delivery.
- **R3:** recovery, budgets, and repeatability.
- **R4:** reusable automations and more providers.
- **R5:** optional remote and team use.

Gates order the milestones. Safety prerequisites still apply before any execution.

## Onboarding and workspace

| ID | Requirement | Status | Gate | Acceptance criteria |
| --- | --- | --- | --- | --- |
| W01 | First-run setup and prerequisite diagnosis | Partial | R1 | Missing Git, agent, sign-in, or writable storage gets a specific repair action. |
| W02 | Repository selection and trust | Partial | R1 | You select a real repo; root, remote, base branch, and trust decision are shown. |
| W03 | Dirty repo and existing work handling | Partial | R1 | Uncommitted work in your repository stays unchanged during start, cancel, and cleanup. |
| W04 | Dependency and environment setup recipe | Partial | R1 | Pinned setup command, working directory, secret references, and failures are recorded. |
| W05 | OS and tool compatibility | Missing | R1 | Supported OS is declared; unsupported setups are rejected with actionable diagnostics. |
| W06 | Local service lifecycle | Partial | R1 | Start, stop, reconnect, port conflict, and unavailable service have visible states. |

## Tasks and orchestration

| ID | Requirement | Status | Gate | Acceptance criteria |
| --- | --- | --- | --- | --- |
| T01 | Validated briefs and acceptance criteria | Partial | R1 | Task creation validates blank input, size limits, repo, and task version. |
| T02 | Explicit run lifecycle | Partial | R1 | UI distinguishes queued, preparing, running, awaiting input, checking, reviewing, ready, failed, interrupted, canceled, and delivered. |
| T03 | Task edit, archive, duplicate, and retry | Partial | R1 | Editing a running brief creates a revision or a deliberate steering event. |
| T04 | Task decomposition and dependencies | Missing | R4 | Parent criteria map to subtasks; cycles and failed dependencies block dispatch. |
| T05 | Queue claims and concurrency limits | Partial | R1 | Simultaneous start requests create one active attempt; resource ceilings are enforced. |
| T06 | Stage-specific progress and failure | Partial | R1 | Actual events and failures are shown; progress never advances on a timer or guessed success. |

## Agent definitions and harness

| ID | Requirement | Status | Gate | Acceptance criteria |
| --- | --- | --- | --- | --- |
| A01 | Versioned reusable role definitions | Partial | R1 | Run records include immutable instructions, tools, model settings, and schema versions. |
| A02 | Harness install, probe, and version support | Partial | R1 | Installed binary and protocol version are detected; incompatible versions are blocked. |
| A03 | Session and turn lifecycle | Partial | R1 | Start, events, completion, failure, and interrupt link to a durable run ID. |
| A04 | Real tools and enforced grants | Partial | R1 | Tool calls run inside approved filesystem and network boundaries. |
| A05 | Structured agent outputs | Missing | R1 | Malformed or incomplete output cannot advance a stage and has a bounded repair path. |
| A06 | Context assembly and precedence | Partial | R1 | A run shows effective project instructions, role version, brief, and context sources. |
| A07 | Context limits and compaction | Missing | R3 | Long tasks keep criteria and open findings; truncated output is marked. |
| A08 | Agent editor, duplication, and rollback | Missing | R4 | Role edits are validated and never change snapshots of active runs. |
| A09 | Agent tool environment parity | Missing | R1 | Commands the agent runs get the same writable temp and cache locations as setup and checks, verified with a real turn. |
| A10 | Harness upgrade path | Missing | R3 | A new Codex or Claude Agent SDK release regenerates or rechecks protocol types, reruns adapter tests, and moves the pin in one step. |
| A11 | Repository instructions for every agent | Partial | R1 | Codex, Claude, and OpenCode runs receive the repository's root AGENTS.md and CLAUDE.md without running its hooks or settings. |
| A12 | Personal instructions for every agent | Partial | R1 | Codex, Claude, and OpenCode runs receive your global CLAUDE.md and AGENTS.md files exactly once, without loading agent settings. |

## Inference and usage

| ID | Requirement | Status | Gate | Acceptance criteria |
| --- | --- | --- | --- | --- |
| I01 | Provider authentication and health | Partial | R1 | Expired auth, rate limits, unavailable provider, and quota exhaustion have distinct states. |
| I02 | Effective model selection per role | Partial | R1 | UI uses discovered models and records the settings that actually applied. |
| I03 | Local model compatibility | Draft | R4 | Endpoint, model availability, tool calls, context limit, and cancellation pass a smoke test. |
| I04 | Explicit data destination and fallback | Partial | R1 | It is clear what runs locally and what goes to cloud inference; fallback never switches provider silently. |
| I05 | Time, retry, and usage limits | Partial | R1 | Limits stop new work and interrupt or wait safely on work in flight under a defined policy. |
| I06 | Usage attribution and honest cost reporting | Partial | R3 | Provider usage is reported when available; unknown prices or missing tokens stay unknown. |

## Isolation, permissions, and credentials

| ID | Requirement | Status | Gate | Acceptance criteria |
| --- | --- | --- | --- | --- |
| S01 | Worktree and branch ownership | Partial | R1 | Each task owns its worktree; simultaneous tasks never share a writable worktree. |
| S02 | Process and filesystem isolation | Partial | R1 | Enforced permissions back up worktree separation; escape attempts fail. |
| S03 | Human approval inbox | Partial | R1 | Exact command, directory, scope, reason, and run are reviewable before a decision. |
| S04 | Approval identity and revocation | Partial | R1 | Stale, duplicate, cross-run, or revoked approvals cannot authorize work. |
| S05 | Scoped credentials and environment | Partial | R1 | Repository commands cannot inherit unrelated credentials; logs and exports redact secrets. |
| S06 | Local API security | Partial | R1 | The API authenticates requests and validates origins; loopback alone is insufficient. |
| S07 | Untrusted content and external tool policy | Partial | R1 | Repo text, dependencies, web output, and MCP results cannot change permissions. |
| S08 | External mutations and audit trail | Partial | R2 | Push, PR, merge, deploy, and external messaging are distinct, policy-controlled actions. |

## Work environment and artifacts

| ID | Requirement | Status | Gate | Acceptance criteria |
| --- | --- | --- | --- | --- |
| E01 | Owned child processes and ports | Partial | R1 | Server and test processes are registered; collisions and cancellation clean up owned resources. |
| E02 | Real diff and file inspection | Partial | R2 | The complete diff is shown, including untracked, deleted, renamed, and binary files. |
| E03 | Build and preview lifecycle | Partial | R2 | You can open the actual preview, inspect failure logs, and stop its server. |
| E04 | Artifact provenance and retention | Partial | R2 | Logs, screenshots, patches, and reports identify their run and candidate revision. |
| E05 | Worktree cleanup and disk limits | Partial | R3 | Cleanup keeps unexported work, leaves your other resources alone, and reports disk pressure. |
| E06 | Submodules, large files, and monorepos | Missing | R3 | Support is defined; unsupported repository shapes stop at preflight. |
| E07 | Shared package cache integrity and size | Missing | R3 | One task's setup cannot tamper with another task's dependencies; cache size is reported and bounded. |
| E08 | Agent-independent sandbox executor | Missing | R3 | Setup and checks run without Codex installed when another agent is selected, under the same verified isolation. |

## Checks, review, and delivery

| ID | Requirement | Status | Gate | Acceptance criteria |
| --- | --- | --- | --- | --- |
| V01 | Deterministic check recipes | Partial | R1 | Commands, exit codes, duration, and output are recorded per revision. |
| V02 | Independent reviewer | Draft | R2 | A separate session inspects the candidate and evidence with enforced source-write limits. |
| V03 | Findings and bounded repair loop | Partial | R2 | Findings have stable IDs; repairs are checked and reviewed again; a retry cap stops loops. |
| V04 | Missing, flaky, or failing checks | Partial | R2 | A missing test suite or an infrastructure failure is never presented as passing evidence. |
| V05 | Evidence invalidation | Partial | R2 | Code or base changes invalidate earlier checks and approval before delivery. |
| V06 | Real PR and local patch delivery | Partial | R2 | Authenticated push and draft PR URL are verified; a local-only repo can export a patch. |
| V07 | Remote conflicts and duplicate delivery | Missing | R2 | Diverged base, rejected push, and a timeout after PR creation reconcile safely. |
| V08 | Human decision and post-delivery state | Partial | R2 | Request changes, approve, and observed merge or close are distinct; default delivery stops at a draft PR. |

## Durability and recovery

| ID | Requirement | Status | Gate | Acceptance criteria |
| --- | --- | --- | --- | --- |
| D01 | Persistent task, run, and event store | Partial | R1 | Reload keeps all tasks, attempts, configuration, approvals, and artifacts without browser storage. |
| D02 | Reconnection and ordered event replay | Partial | R1 | UI recovers missed events once; bounded logs never freeze rendering. |
| D03 | Crash, sleep, and orphan recovery | Partial | R3 | Restart reconciles live agents and worktrees before launching new work. |
| D04 | Pause, interrupt, cancel, and resume | Partial | R1 | Stop controls have distinct meanings and keep evidence; canceled children cannot keep running. |
| D05 | Idempotent side effects | Missing | R2 | Repeating delivery or retrying after a timeout cannot duplicate external actions. |
| D06 | Backup, export, migrations, and restore | Missing | R3 | Task history and artifacts restore and verify; schema upgrades keep a rollback or repair path. |

## Knowledge and software reuse

| ID | Requirement | Status | Gate | Acceptance criteria |
| --- | --- | --- | --- | --- |
| K01 | Project and personal memory separation | Missing | R3 | Scope and provenance keep unrelated project information out of a run. |
| K02 | Memory edit, delete, expiry, and conflicts | Missing | R3 | You can inspect stored facts; obsolete or conflicting facts never become authoritative silently. |
| K03 | Versioned deterministic recipes | Missing | R4 | Reusable scripts expose validated inputs, outputs, permissions, and check contracts. |
| K04 | Reuse saved software without inference | Missing | R4 | Repeated runs call published code directly; any model stage is explicit. |
| K05 | Workflow composition and dependency versions | Missing | R4 | Recipes and agents are pinned; cycles, missing dependencies, and incompatible versions are rejected. |
| K06 | Import, export, and sharing | Missing | R4 | Imported definitions are inspected before they get credentials or tool access. |

## Triggers and integrations

| ID | Requirement | Status | Gate | Acceptance criteria |
| --- | --- | --- | --- | --- |
| G01 | Manual trigger and reusable parameters | Partial | R1 | Validated inputs start one durable task with a visible result. |
| G02 | Schedules and missed runs | Missing | R4 | Timezone, daylight saving, overlap, sleep, and catch-up policy are explicit. |
| G03 | Webhooks and event deduplication | Missing | R4 | Authenticated events use delivery IDs and enforce source and payload limits. |
| G04 | MCP and service integrations | Missing | R4 | Tool discovery, credentials, health, grants, and disconnect behavior are visible. |
| G05 | Notifications and action inbox | Missing | R3 | You are notified of required input, blocked work, and delivery, without duplicate alerts. |
| G06 | Always-on, remote access, and email | Deferred | R5 | Host, authentication, connectivity, and delivery contracts are defined before enabling. |

## Interface, accessibility, and operations

| ID | Requirement | Status | Gate | Acceptance criteria |
| --- | --- | --- | --- | --- |
| U01 | Task queue and agent screens | Partial | R1 | Screens show only service data, and actions match what the service can do. |
| U02 | Setup, approvals, failures, and blocked states | Partial | R1 | Every blocking state has a reason and one actionable recovery path. |
| U03 | Keyboard, screen reader, and narrow layouts | Partial | R1 | The full task workflow works with focus restoration, named controls, and status announcements. |
| U04 | Contrast, zoom, reduced motion, long content | Partial | R1 | 200% zoom, long titles, large logs, contrast, and reduced-motion preferences are verified. |
| U05 | Search, filters, and run history | Partial | R3 | Queries run against real history; counts stay consistent with filters and live updates. |
| U06 | Diagnostics and redacted support export | Missing | R3 | Version, health, and run errors export without credentials or unrelated source. |
| U07 | Agent quality evaluation | Missing | R3 | Fixed representative tasks measure acceptance, regressions, retries, and usage by role version. |
| U08 | Installer, updates, and version migration | Missing | R3 | Install and uninstall keep your repositories intact and handle running jobs. |
| U09 | Team ownership, access, and billing | Deferred | R5 | Roles, audit scope, resource ownership, isolation, and cost responsibility are defined. |

## Implementation evidence

Quoted names are tests in `test/*.test.ts`. Interface checks live in [`test/browser.ts`](../test/browser.ts).

- **W01:** `Runner.probe` reports each agent's version, sign-in, and models, and caches only signed-in results (test "agent checks are cached per agent, and signed-out results are not"). A missing Codex CLI or GitHub CLI gets an install message. Missing Git and unwritable storage surface raw errors.
- **W02:** `inspectRepo` requires the repository root and records the base commit, uncommitted changes, whether `origin` exists, and a lockfile recipe. Connecting a new repository requires a trust confirmation. The repository menu flags uncommitted changes and Details shows the base commit. Remote and base branch are not shown.
- **W03:** test "real worktree and real check evidence survive reopening the database" leaves an untracked file and tracked files in your repository unchanged. Merge and revert refuse to run over uncommitted tracked changes. Cancel and cleanup paths are unverified.
- **W04:** setup records command, output, exit code, duration, and network access, with a 10-minute limit. Without a setup command, a root lockfile picks one (test "repository inspection suggests a recipe from its lockfile"). Tests "setup runs before the agent with caches in a writable root" and "failed or file-changing setup stops before the agent starts" cover success, failure, and changed files. Real Codex on 2026-09-11: `npm ci` exited 0 with network through the sandbox, caching in `.factory/cache`. Secret references are missing.
- **W06:** the sidebar shows the connection state, and browser checks cover reconnecting after a restart with a new session cookie. Shutdown stops the active run, inline commands, and the running app. Port conflicts are unhandled.
- **T01:** `backend/api.ts` and `backend/validation.ts` reject blank text, oversized input, bad command arrays, and unknown repositories. Task revisions are missing.
- **T02:** queued, preparing, running, awaiting approval, checking, canceling, handoff, failed, interrupted, and canceled are distinct. Commit, merge, pull request, and settled are recorded as task fields. There is no reviewing or delivered status.
- **T03:** a finished task can run another attempt with optional feedback, and settling moves it out of the active list (test "settling moves a finished task and refuses a running one"). Editing a brief and duplicating a task are missing.
- **T05:** `Store.claim` uses an immediate transaction and allows one active task (test "cancel and duplicate start preserve a single attempt"). Resource ceilings are missing.
- **T06, G01:** the interface starts one validated task and renders recorded events only.
- **A01, A06:** each run stores the instruction text, its digest, the instruction files used, and Codex's reported instruction sources. Details lists the instruction files. Tool grants and schema versions are unversioned, and the full effective context is not shown.
- **A02:** Codex must report 0.154.0 before probe and run, Claude's init report must show `claude_code_version` 2.1.268, and OpenCode must report 1.18.30. On 2026-09-13 Codex updated itself from 0.153.4 and the pin blocked it. The regenerated schemas only added optional fields for the methods the adapter uses, so the pin moved to 0.154.0 and `allowProviderModelFallback` is now sent as false. No test covers a rejected version.
- **A03:** thread and turn IDs are recorded. Completion, failure, disconnect, and interrupt end the run. Tests cover completion and cancel for all three agents. The real Claude run on 2026-09-11 completed a turn and reached handoff.
- **A04, S02:** Codex's sandbox, approval policy, working directory, and model are verified from the `thread/start` response. Real Codex: an offline check could not reach the network and got `EPERM` writing to the home directory. Claude runs use the SDK sandbox with no network domains and no unsandboxed commands, and fail when the init report differs (test "claude run fails closed on a policy mismatch or unavailable model"). Real Claude: `curl` raised a network approval that timed out while pending, and `touch ~/lf-claude-escape-test` failed with `Operation not permitted`.
- **A09:** OpenCode's sandboxed shell gets `.factory/cache` and a per-run temp directory. Codex and Claude turns do not.
- **A11, A12:** `backend/instructions.ts` reads `~/.claude/CLAUDE.md`, Codex's and OpenCode's global `AGENTS.md`, and the repository's root `CLAUDE.md` and `AGENTS.md`, caps each at 64 KB, and drops duplicate content. Codex loads its own `AGENTS.md` files, so those are skipped for Codex (tests "global and repository instruction files reach every agent exactly once" and "identical owner files are delivered once, and native Codex files suppress their copies"). The real Codex run on 2026-09-13 recorded its `AGENTS.md` in `instructionSources`. Nested instruction files and `@` imports are not expanded, and no real run has confirmed the combined context.
- **OpenCode (A04, S02, S05, S07):** checked on 2026-09-13 without a model call. The server rejected requests without its password (401). A planted repository plugin ran in a control start and was blocked with project config disabled. Through the `sandbox-exec` shell, a worktree write succeeded while a home directory write, a child process write outside the worktree, and network access failed. The adapter reads back the shell, permissions, and directory before prompting (tests "opencode run ends in a checked handoff with usage", "opencode permissions and questions go to the owner", "opencode fails on an unavailable model and stops on cancel"). File edits through OpenCode's edit tool follow its permission rules and are outside the OS sandbox.
- **I01:** Codex runs stop when no account is signed in. Real run on 2026-09-11: an exhausted usage limit failed the task with the provider message 4 seconds after the turn started, with no success state. The UI shows a generic failure; a quota state with its reset time is missing.
- **I02:** models come from Codex `model/list`, the Claude SDK, and OpenCode's connected providers. Codex and Claude verify the resolved model from the thread response or init report.
- **I04:** Codex runs send `allowProviderModelFallback: false`. The selected agent is saved as a preference, recorded on each task, and never switched after a failure.
- **I05:** a run gets 15 minutes of working time when it asks you and 45 when it decides on its own, and the clock pauses while a request waits (test "the run limit counts working time and pauses while a request waits for the owner"). Setup gets 10 minutes and the check 2. Usage limits are missing.
- **I06:** Claude and OpenCode runs record cost and model turns, and Details labels the cost an estimate. Codex runs report no usage.
- **S01:** each task gets its own worktree and `factory/<task id>` branch.
- **S03:** pending requests show the reason and command, plus the blocked path for Claude, with allow once or decline. Directory and scope are not always shown. A task set to decide on its own declines every request when sandboxed and allows it with full access (tests "independent tasks decide permission requests without the owner" and "permissions change on a waiting task, and switching to automatic answers what is pending").
- **S04:** answers must match the active run and request key (tests "approval remains bound to its request and rejects replay" and "claude approvals and questions go to the owner and reject replay"). Connection generation is not tracked.
- **S05:** agents, Git, previews, and inline commands start from an allowlisted environment (`safeEnv` in `backend/process.ts`), and a test asserts an unrelated variable never reaches Claude. Push and GitHub CLI calls also get the SSH agent and GitHub token variables. Logs are not redacted.
- **S06:** session cookie plus Host and Origin checks (test "local API rejects cross-origin, unauthenticated and malformed requests, and serves real repositories"). Any local process can still get a session by sending matching headers.
- **S07:** Codex runs disable hooks, apps, plugins, MCP servers, and web search (`isolatedConfig`). Claude runs load no user or project settings or plugins, and only the factory's own preview server, confirmed from the init report. Preview pages can reach loopback only. Repository text reaches the model unfiltered.
- **E01:** agents, apps, and inline commands run in their own process groups and stop on cancel or shutdown. Apps get a free port and cannot reach the service port. Ports are not registered.
- **E02:** patches include untracked, deleted, and binary files and are written with `git diff --output` (test "diff larger than the process output buffer is exported as a patch"). The Changes tab parses them per file (test "patches parse per file with counts and line numbers"). The API returns the first 1 MB.
- **E03:** after the check, `backend/preview.ts` starts the app from the agent's `PREVIEW:` line, the previous preview, or a package script, in a loopback-only sandbox, captures desktop and phone screenshots and page errors, and stops it (tests "the start command comes from the agent, the previous preview, or a package script", "the app starts in a loopback-only sandbox, is captured at the address it prints, and stops afterwards", "an app that exits or never answers records a failed preview with its output"). During the turn, Codex and Claude can drive the app through the preview tools in `backend/browser.ts` (tests "codex gets the preview tools, and the factory answers their calls" and "agent preview tools run the app with the factory port blocked and drive the browser"). `backend/live.ts` then keeps one app running for you to open and stops it when the task settles, merges, rolls back, or loses its worktree (test "a task app keeps running for review, one at a time, and stops when the task settles"). OpenCode runs get no preview tools during the turn.
- **E04:** patches are stored per candidate under `.factory/artifacts/<task id>/`, and post-check screenshots under the candidate's `preview` folder. Screenshots the agent takes are stored per task only. Retention is missing.
- **E05:** removing a worktree keeps a committed branch and deletes an uncommitted one (test "removing an uncommitted worktree deletes its branch and ends the task"). Merge removes the worktree. Disk reporting is missing.
- **V01:** checks run offline and record command, exit code, output, duration, and the candidate tree. The command comes from you, the agent's `CHECK:` line, or tests found in the repository (tests "without a check command the factory runs the check the agent names" and "without a named check the factory uses tests it finds, or marks the task unchecked"). Real Codex: `npm test` exited 0 offline after setup.
- **V03:** another attempt reuses the worktree, skips setup, and sends the last check's exit code, output tail, and your note (test "another attempt reuses the worktree with the last check output and owner feedback"). Tasks that decide on their own retry a failed check up to three attempts (test "independent tasks retry a failed check on their own, up to three attempts"). Real Codex on 2026-09-13: attempt 2 added the requested JSDoc and passed. Stable finding IDs are missing.
- **V04:** test "failed check cannot produce a successful handoff". A task with no check shows "No check ran" (test "check summaries explain the outcome and offer runnable delivery commands"), though it can still be committed. Flaky and infrastructure failures look the same as real failures.
- **V05:** test "check that changes the candidate invalidates the result", and commit refuses a worktree that changed after the check. Base changes are checked only at start.
- **V06:** commit requires a task in handoff and an unchanged candidate tree (test "commit lands on the task branch and refuses a worktree changed after the check"). Merge commits if needed, merges into the repository's current branch, and removes the worktree (test "merge brings the work into the current branch, and the revert command undoes it inline"). A pull request pushes the task branch and opens through GitHub CLI; without `origin` you are pointed to Merge (test "a pull request pushes the task branch, and gh commands merge or close it inline"). Real OpenCode run on 2026-09-13: committed `f6ef9ae` on its branch, removed the worktree, left main unchanged, and the branch merged in a fresh clone with all 5 tests passing. No real GitHub pull request is recorded yet. Patch download is missing.
- **S08, V08:** commit, merge, pull request, revert, rollback, and pull request merge and close are separate actions confirmed by you and recorded as events. Revert and GitHub commands come from `shared/commands.ts`; the API takes a command ID and rebuilds the command from task state. Revert refuses when another branch is checked out and aborts on conflicts. Rollback restores an earlier attempt or the original code (test "rollback restores an earlier attempt or the original code, after undoing a commit"). Pull requests open as ready for review. Deploy, external messaging, request changes, and approval are missing.
- **Inline commands (S08, U02):** `backend/terminal.ts` runs a command you confirm in the worktree, or the repository once the worktree is gone, through `zsh` with an allowlisted environment and no sandbox. It streams output, picks up a local URL, allows one command per task, and waits for the agent run (tests "a command runs in the worktree, streams its output, and finds the local URL it prints" and "a long-running command stops on request, and commands wait for the agent run"). Commands come from shell blocks and complete inline commands in agent messages (tests "shell blocks in agent messages become runnable commands" and "inline code is runnable when it is a complete command for a known tool").
- **D01:** tasks, events, and settings survive reopening the database. Attempts are snapshots inside the task record; separate attempt and artifact records are missing.
- **D02:** [the event stream](../backend/api.ts) signals persisted changes, and [client sync](../web/src/lib/live.ts) serializes refreshes, drains cursor pages, deduplicates events, renews sessions, and keeps the latest 200 events. [Stream tests](../test/events.test.ts) cover authenticated access, replay, full-log download, and listener cleanup. Browser checks cover a 430-event burst, a restart with a new cookie, stable reply focus, and history scrolling. Token and command-output deltas are missing.
- **D03:** after a restart, new runs stay blocked until the recorded agent processes are gone and you acknowledge recovery. Stale live-app state is cleared (test "an app that exits clears its state, apps wait for the run, and a restart clears stale state"). Reconciliation and adoption are missing.
- **D04:** cancel interrupts the turn, terminates the running command, and stops the agent. Pause and resume are missing.
- **U01, U02:** every screen state comes from the service, and task errors, setup failures, and recovery each show a reason. The agent connection is checked automatically and can be retried. A task has Activity, Changes, Preview, and Details tabs; the brief, run configuration, rollback, and cleanup live in Details, while activity and pending decisions stay in view.
- **U03:** the [interface](../web/src/components/app/App.tsx) keeps reply fields, drafts, expanded rows, and the selected task stable during live updates. Controls have accessible names, task and connection states use status regions, and mobile uses list and detail navigation. Browser checks cover 390px, 640px, and 1440px widths. A full screen reader walkthrough is unverified.
- **U04:** motion is limited to short enter, expand, and progress animations, and `prefers-reduced-motion` turns them off. Long content wraps and activity rendering is bounded. Browser checks cover long logs and a 640px layout equal to 1280px at 200% zoom. Contrast and assistive technology audits are open.
- **U05:** sidebar search matches title, repository, and agent in SQLite, with counts for all, active, waiting on you, and finished tasks from the same query, 50 tasks per page (`backend/task-list.ts`). Count consistency during live updates is unverified.

## UI gaps

Token deltas and partial command output from agents are missing, so a quiet feed only means no new persisted event. Still needed: per-test check results beyond command, exit code, and output; recovery controls beyond acknowledgement, rollback, and another attempt; and reusable recipe management.

## Data model

Use SQLite for repositories, task revisions, immutable agent versions, runs, stage attempts, ordered events, pending approvals, findings, checks, artifacts, provider configuration references, and delivery records. Add knowledge, recipes, schedules, and trigger deliveries in later gates. Store secret references, never secret values. Keep large artifacts outside the database with content hashes and a retention policy.

Task, run, stage attempt, agent thread, model turn, and remote PR each need their own identity. A task can have several attempts, and a completed model turn does not make the task successful. Every check, review, and delivery record carries the candidate commit or content digest.

## Required walkthroughs

Before relying on real execution: cancel during a tool call, decline an approval, restart with a pending request, disconnect the UI, send a duplicate start, load malicious task text, point at an untrusted repo, exceed a limit, lose provider auth, and run a command that starts a child process. Disk and permission failures must keep your work intact. Covered by tests so far: cancel during a turn, declined approval, duplicate start, failing check, a check that changes the candidate, failing setup, the run limit pausing on a pending request, and an app that exits before it is ready.

Before relying on delivery: fail a test, omit the test suite, return malformed review output, change the diff after approval, diverge the base branch, interrupt after push, and time out after the PR is created. None may produce a false success or a duplicate PR. Covered so far: a second pull request for the same task is refused.

Before relying on automation: sleep through a schedule, replay a webhook, crash the runner, fill the disk, restore a backup, update the harness protocol, exhaust a local model's resources, and revoke a tool grant. Record the expected recovery and what actually happened.

## Build order

1. **R1, real local run:** every R1 requirement. One repository with task input, enforced permissions, live events, questions and approvals, real checks, cancel, and durable state.
2. **R2, reviewed delivery:** a separate reviewer, evidence tied to the diff, bounded repairs, PR and patch delivery, and remote reconciliation. Show a failing change that cannot pass the gate.
3. **R3, reliable repeated use:** crash and sleep recovery, resource accounting, history, memory, diagnostics, installation, and quality regression fixtures.
4. **R4, reuse:** versioned scripts and workflows, verified alternate and local providers, integrations, and durable triggers. Show a recurring deterministic recipe with no model calls.
5. **R5, expansion:** remote hosting, phone access, email workflows, and teams, once their contracts are designed and verified.

## Working defaults

- Scope: a personal macOS service with a local browser UI.
- Agents: Codex, Claude, and OpenCode behind pinned adapters. Setup and checks currently require Codex.
- Concurrency: one active task and one running app.
- Delivery: local merge or a pull request, each confirmed by you. The planned default of a draft PR is not implemented.
- Fallback: disabled.
- Schedules missed while the laptop sleeps: report them and apply an explicit catch-up rule.

These defaults never approve an external action on your behalf. Still to learn from real use: which alternate agents matter, local model hardware and quality, target repository setup, required check suites, acceptable usage and time limits, retention, and whether remote or team use belongs in the first release.

## Keeping this file current

When a change affects a requirement, update its status and link the source and the test that proves it. Run `bun run check`, `bun run test`, and `bun run test:browser` for interface changes. A finished screen cannot close a backend requirement. Add failure paths you find while testing, review the whole task lifecycle at each gate, and mark deferrals explicitly instead of dropping scope.
