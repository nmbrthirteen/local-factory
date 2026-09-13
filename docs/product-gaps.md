# Requirements and gaps

The requirement register for Local Factory: each requirement has an ID, status, release gate, and acceptance criteria, with evidence for partial work below the tables. It tracks known gaps and does not prove there are no others.

## Where things stand

Built: a Bun and TypeScript service (`server.ts`, `backend/`, types in `shared/`) with an authenticated loopback API, SQLite storage, and a React interface in `web/`. Codex App Server 0.154.0, Claude through the Claude Agent SDK, and OpenCode 1.18.30 run through pinned adapters in `backend/agents/`. Each task gets its own worktree and branch, optional setup with network access, one agent turn under a verified sandbox and approval policy, and an offline check the factory runs itself. After the check it screenshots the app the agent built and can keep it running for you. You can run another attempt, roll back, commit, merge, open a pull request, revert a merge, and run suggested commands inline. `bun run test` covers the backend against real Git with fake agents and a stand-in GitHub CLI; `bun run test:browser` runs [`test/browser.ts`](../test/browser.ts).

Not built: an independent reviewer, stable finding IDs, patch download, disk reporting, Codex usage reporting, and most of R3 and later. `agents/reviewer.md` exists, but only `agents/implementer.md` is loaded.

Real runs: on 2026-09-11 Claude completed a fixture task (worktree, `npm ci`, implementation, `npm test` exiting 0, handoff) for an estimated $0.09 over 4 model turns, and Codex stopped on the account usage limit. On 2026-09-13 the fixture passed with OpenCode on `opencode/big-pickle` in 18 seconds and Codex 0.154.0 in 50 seconds, and a second Codex attempt applied feedback and passed. On a two-module repository, the whole-repository check failed an OpenCode task that fixed one module until another attempt fixed both; Claude and Codex passed clamp-only tasks there.

## Statuses and gates

**Partial:** real behavior with evidence below, acceptance incomplete. **Draft:** a UI or document without the production behavior. **Missing:** no implementation. **Deferred:** beyond the first local release. No requirement is complete.

**R1** one real local task with human control. **R2** verified review and delivery. **R3** recovery, budgets, and repeatability. **R4** reusable automations and more providers. **R5** optional remote and team use. Safety prerequisites apply before any execution, whatever the gate.

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

Quoted names are tests in `test/*.test.ts`; browser checks are in `test/browser.ts`.

- **W01, W06:** `Runner.probe` reports each agent's version, sign-in, and models. A missing Codex or GitHub CLI gets an install message; missing Git and unwritable storage surface raw errors. The sidebar shows connection state, browser checks cover reconnecting after a restart, and shutdown stops the run, inline commands, and the running app. Port conflicts are unhandled.
- **W02, W03:** `inspectRepo` requires the repository root and records base commit, uncommitted changes, `origin`, and a lockfile recipe; a new repository needs a trust confirmation. Remote and base branch are not shown. "real worktree and real check evidence survive reopening the database" leaves your files unchanged, and merge and revert refuse uncommitted tracked changes. Cancel and cleanup paths are unverified.
- **W04:** setup records command, output, exit code, duration, and network access, with a 10-minute limit, and a root lockfile picks the command when none is given ("failed or file-changing setup stops before the agent starts"). Real Codex on 2026-09-11: `npm ci` exited 0 through the sandbox with caches in `.factory/cache`. Secret references are missing.
- **T01, T05, T06, G01:** `backend/api.ts` and `backend/validation.ts` reject blank, oversized, and malformed input and unknown repositories. `Store.claim` allows one active task ("cancel and duplicate start preserve a single attempt"). The interface renders recorded events only. Revisions and resource ceilings are missing.
- **T02, T03:** statuses are queued, preparing, running, awaiting approval, checking, canceling, handoff, failed, interrupted, and canceled; commit, merge, pull request, and settled are task fields. A finished task can run another attempt or be settled ("settling moves a finished task and refuses a running one"). Reviewing, delivered, editing, and duplicating are missing.
- **A01, A06:** runs store instruction text, digest, instruction files, and Codex's instruction sources; Details lists the files. Tool grants and schema versions are unversioned.
- **A02, A03:** Codex must report 0.154.0, Claude's init report 2.1.268, and OpenCode 1.18.30. On 2026-09-13 Codex updated itself from 0.153.4 and the pin blocked it; the regenerated schemas only added optional fields, so the pin moved and `allowProviderModelFallback` is sent as false. No test covers a rejected version. Thread and turn IDs are recorded, and tests cover completion and cancel for all three agents.
- **A04, A09, S02:** Codex's sandbox, approval policy, directory, and model are verified from `thread/start`; real Codex got `EPERM` writing to the home directory and no network during the check. Claude uses the SDK sandbox with no network domains and fails on a mismatched init report ("claude run fails closed on a policy mismatch or unavailable model"); in the real run `curl` raised an approval that timed out and `touch ~/lf-claude-escape-test` got `Operation not permitted`. Only OpenCode's shell gets `.factory/cache` and a per-run temp directory.
- **A11, A12:** `backend/instructions.ts` reads `~/.claude/CLAUDE.md`, Codex's and OpenCode's global `AGENTS.md`, and the repository's root `CLAUDE.md` and `AGENTS.md`, caps each at 64 KB, drops duplicates, and skips files Codex loads natively ("global and repository instruction files reach every agent exactly once"). Nested files and `@` imports are not expanded, and no real run has confirmed the combined context.
- **OpenCode (A04, S02, S05, S07):** checked on 2026-09-13 without a model call. The server rejected requests without its password, and a planted repository plugin was blocked with project config disabled. Through the `sandbox-exec` shell, a worktree write succeeded while home directory writes, child process writes outside the worktree, and network access failed. The adapter reads back shell, permissions, and directory before prompting ("opencode permissions and questions go to the owner"). Its edit tool follows OpenCode's permission rules outside the OS sandbox.
- **I01, I02, I04:** Codex runs stop without a signed-in account. On 2026-09-11 an exhausted usage limit failed the task with the provider message, shown as a generic failure; a quota state with reset time is missing. Models come from each agent, Codex and Claude verify the resolved model, and the selected agent is never switched after a failure.
- **I05, I06:** runs get 15 minutes of working time when asking you and 45 when deciding alone, paused while a request waits ("the run limit counts working time and pauses while a request waits for the owner"); setup gets 10 minutes and the check 2. Claude and OpenCode costs show in Details as estimates. Usage limits and Codex usage are missing.
- **S01, S03, S04:** each task gets a worktree and `factory/<task id>` branch. Requests show reason and command, plus blocked path for Claude; directory and scope are not always shown. Tasks deciding alone decline everything when sandboxed and allow everything with full access ("independent tasks decide permission requests without the owner"). Answers must match the active run and request key ("approval remains bound to its request and rejects replay").
- **S05, S06, S07:** agents, Git, previews, and inline commands start from `safeEnv` in `backend/process.ts`; push and GitHub CLI also get SSH agent and GitHub token variables. Logs are not redacted. The API uses a session cookie plus Host and Origin checks ("local API rejects cross-origin, unauthenticated and malformed requests, and serves real repositories"), though any local process can get a session with matching headers. Codex runs disable hooks, apps, plugins, MCP servers, and web search; Claude loads no settings or plugins and only the factory's preview server. Repository text reaches the model unfiltered.
- **E01, E02:** agents, apps, and inline commands run in their own process groups and stop on cancel or shutdown; apps cannot reach the service port. Ports are not registered. Patches include untracked, deleted, and binary files ("diff larger than the process output buffer is exported as a patch"), and the API returns the first 1 MB.
- **E03:** after the check, `backend/preview.ts` starts the app from the agent's `PREVIEW:` line, the last preview, or a package script in a loopback-only sandbox, captures desktop and phone screenshots and page errors, and stops it ("an app that exits or never answers records a failed preview with its output"). Codex and Claude can also drive the app during the turn through `backend/browser.ts`; OpenCode cannot. `backend/live.ts` keeps one app running for you until the task settles, merges, rolls back, or loses its worktree ("a task app keeps running for review, one at a time, and stops when the task settles").
- **E04, E05:** patches and post-check screenshots are stored per candidate under `.factory/artifacts/<task id>/`. Removing a worktree keeps a committed branch and deletes an uncommitted one ("removing an uncommitted worktree deletes its branch and ends the task"). Retention and disk reporting are missing.
- **V01, V04, V05:** checks run offline and record command, exit code, output, duration, and candidate tree. The command comes from you, the agent's `CHECK:` line, or tests found in the repository ("without a named check the factory uses tests it finds, or marks the task unchecked"). A failed check or one that changes the candidate never reaches handoff ("failed check cannot produce a successful handoff"). A task with no check can still be committed, flaky failures look like real ones, and base changes are checked only at start.
- **V03:** another attempt reuses the worktree with the last check output and your note, and tasks deciding alone retry a failed check up to three attempts ("independent tasks retry a failed check on their own, up to three attempts"). Real Codex on 2026-09-13: attempt 2 added the requested JSDoc and passed. Stable finding IDs are missing.
- **V06:** commit needs a task in handoff and an unchanged candidate tree. Merge commits if needed, merges into the current branch, and removes the worktree. A pull request pushes the branch and opens through GitHub CLI; without `origin` you are pointed to Merge. Real OpenCode run on 2026-09-13: committed `f6ef9ae`, left main unchanged, and the branch merged in a fresh clone with all 5 tests passing. No real GitHub pull request is recorded yet, and patch download is missing.
- **S08, V08:** merge, pull request, revert, rollback, worktree removal, and pull request merge and close each ask for confirmation and are recorded as events. Revert and GitHub commands come from `shared/commands.ts`, rebuilt from task state by ID ("a pull request pushes the task branch, and gh commands merge or close it inline"). Revert refuses another checked-out branch and aborts on conflicts. Pull requests are not drafts. Deploy, messaging, request changes, and approval are missing.
- **Inline commands (S08, U02):** `backend/terminal.ts` runs a confirmed command from an agent message through `zsh` in the worktree, with `safeEnv` and no sandbox, one per task and only after the run ("a long-running command stops on request, and commands wait for the agent run").
- **D01, D03, D04:** tasks, events, and settings survive reopening the database; attempts are snapshots inside the task record. After a restart, new runs wait until recorded agent processes are gone and you acknowledge recovery. Cancel interrupts the turn, the running command, and the agent. Separate attempt records, reconciliation, pause, and resume are missing.
- **D02:** [the event stream](../backend/api.ts) signals persisted changes and [client sync](../web/src/lib/live.ts) drains cursor pages, deduplicates, renews sessions, and keeps the latest 200 events ("authenticated event stream wakes clients, replays persisted events, and releases subscriptions"). Browser checks cover a 430-event burst, restart with a new cookie, reply focus, and history scrolling. Token and command-output deltas are missing.
- **U01-U05:** [the interface](../web/src/components/app/App.tsx) shows only service data, gives errors and recovery a reason, and keeps drafts and selection stable during live updates. It uses named controls, status regions, mobile list and detail navigation, and turns off animation under `prefers-reduced-motion`. Browser checks cover 390px, 640px (200% zoom equivalent), and 1440px widths and long logs. Search and filter counts come from one SQLite query in `backend/task-list.ts`. Screen reader, contrast, and live count consistency are unverified.

## UI gaps

Agent token deltas and partial command output are missing, so a quiet feed only means no new persisted event. Still needed: per-test check results, recovery beyond acknowledgement, rollback, and another attempt, and reusable recipe management.

## Data model

SQLite should hold repositories, task revisions, immutable agent versions, runs, stage attempts, ordered events, pending approvals, findings, checks, artifacts, provider configuration references, and delivery records, adding knowledge, recipes, schedules, and trigger deliveries later. Store secret references only, and keep large artifacts outside the database with content hashes and a retention policy. Task, run, stage attempt, agent thread, model turn, and remote PR each need their own identity; a completed model turn does not make a task successful. Every check, review, and delivery record carries the candidate commit or content digest.

## Required walkthroughs

Before relying on real execution: cancel during a tool call, decline an approval, restart with a pending request, disconnect the UI, send a duplicate start, load malicious task text, point at an untrusted repo, exceed a limit, lose provider auth, and run a command with a child process. Disk and permission failures must keep your work intact. Tested so far: cancel during a turn, declined approval, duplicate start, failing check, a check that changes the candidate, failing setup, and the run limit pausing on a request.

Before relying on delivery: fail a test, omit the test suite, return malformed review output, change the diff after approval, diverge the base branch, interrupt after push, and time out after PR creation. None may produce a false success or a duplicate PR. Tested so far: a second pull request for the same task is refused.

Before relying on automation: sleep through a schedule, replay a webhook, crash the runner, fill the disk, restore a backup, update the harness protocol, exhaust a local model, and revoke a tool grant. Record expected recovery and actual evidence.

## Build order

1. **R1, real local run:** all R1 requirements on one repository: task input, enforced permissions, live events, questions and approvals, real checks, cancel, and durable state.
2. **R2, reviewed delivery:** a separate reviewer, evidence tied to the diff, bounded repairs, PR and patch delivery, and remote reconciliation, shown with a failing change that cannot pass.
3. **R3, reliable repeated use:** crash and sleep recovery, resource accounting, history, memory, diagnostics, installation, and quality regression fixtures.
4. **R4, reuse:** versioned scripts and workflows, verified alternate and local providers, integrations, and durable triggers, shown with a recurring recipe that makes no model calls.
5. **R5, expansion:** remote hosting, phone access, email workflows, and teams, once their contracts are designed and verified.

## Working defaults

A personal macOS service with a local browser UI. Codex, Claude, and OpenCode behind pinned adapters, with Codex currently required for setup and checks. One active task and one running app. Delivery by local merge or pull request, each confirmed by you; the planned draft PR default is not implemented. Fallback disabled. Schedules missed during sleep are reported and follow an explicit catch-up rule. None of these approve an external action for you. Still to learn from real use: which agents matter, local model hardware and quality, repository setup, required check suites, acceptable usage and time limits, retention, and whether remote or team use belongs in the first release.

## Keeping this file current

When a change affects a requirement, update its status and link the source and the test that proves it. Run `bun run check` and `bun run test`, plus `bun run test:browser` for interface changes. A finished screen cannot close a backend requirement. Add failure paths you find, review the whole lifecycle at each gate, and mark deferrals instead of dropping scope.
