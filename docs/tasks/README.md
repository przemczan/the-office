# Build tasks: tier 1

Tier 1 of [the spec](../spec.md#tier-1-the-base), sliced into tasks in build order. The current task is the first row that is not `done`. How a session works through a task is in [CLAUDE.md](../../CLAUDE.md).

**Test Project:** `notnullsoft-admin` at `D:\Projects\notnullsoft-admin`, chosen by the user in task 04. Base branch `main`, remote `https://github.com/przemczan/notnullsoft-admin.git`; an npm workspace on Node 22 with `npm install`, `npm run build`, `npm run lint` and `npm test`. A push to its `main` deploys production (`.github/workflows/deploy-production.yml`), so a Publish check uses push + PR on a throwaway branch, never merge. It is never this repository or `D:\Projects\software-factory`.

| # | Task | Surface | Status |
|---|---|---|---|
| 01 | [Engine spike: pinned versions and the engine check](01-engine-spike.md) | Spike | done |
| 02 | [Foundation: workspace, service, database, events, telemetry](02-foundation.md) | Projects | done |
| 03 | [Web shell: design system, themes and A3 · Desk](03-web-shell.md) | Projects | done |
| 04 | [Projects: the record, commands and the Projects page](04-projects.md) | Projects | done |
| 05 | [Git, worktrees and the environment check](05-git-worktrees.md) | Projects | done |
| 06 | [The Engine module: port, Agent SDK adapter and Office rules](06-engine.md) | People | done |
| 07 | [Skills: the library and each session's skills](07-skills.md) | People | done |
| 08 | [People: Role cards, presets and a person's page](08-people.md) | People | done |
| 09 | [Conversations and the Context policy: chat with the Planner](09-conversations.md) | People | done |
| 10 | [Work: Ideas, Tasks, the board and Attachments](10-work.md) | Work and the Task page | in progress |
| 11 | [Planning a Task with the Planner](11-planning.md) | Work and the Task page | todo |
| 12 | [The Stage interpreter: Start, Agent and Script Stages, loops](12-stage-interpreter.md) | Work and the Task page | todo |
| 13 | [A running Task: barge-in, Stop, Pause, Decisions, Office tools](13-running-task.md) | Work and the Task page | todo |
| 14 | [Gates, the Changes tab and Publish](14-gates-publish.md) | Work and the Task page | todo |
| 15 | [Edit for this Task: the Stage editor](15-stage-editor.md) | Work and the Task page | todo |
| 16 | [Now, the status strip and Notifications](16-now-notifications.md) | Now | todo |
| 17 | [Settings, and the tier 1 acceptance run](17-settings-acceptance.md) | Settings | todo |

## Build defaults

Choices the spec leaves open, made when tier 1 was sliced. Change one only with the user, and update this list in the same commit.

- **Windows and Linux:** The Office runs on both ([spec §5.1](../spec.md#51-shape)). Operating-system differences live only in the service's `src/platform/os/`. `npm run verify` passes on both: on the Windows workstation, Linux is checked with `npm run verify:linux`, which runs the same checks in a `node:22` container. A task's check with real sessions runs on Linux too when a Linux system with the user signed in to Claude Code is available (a WSL distribution or another machine); the task asks the user.
- **Workspace:** npm workspaces; Node 22 pinned in `.nvmrc` and `engines`. Layout:
  - `apps/service`: the NestJS service. Each module of [spec §5.3](../spec.md#53-modules) is `src/modules/<module>/` with `domain/`, `application/`, `ports/` and `adapters/`; shared plumbing (config, database, domain events, telemetry, WebSocket) is `src/platform/`.
  - `apps/web`: React + Vite, `src/shell/`, `src/surfaces/<surface>/` and `src/api/` (the service's API and event stream).
  - `packages/contracts`: the HTTP and WebSocket contract (zod schemas and their types), the one thing the service and the web share.
  - `packages/ui`: the design system for React. A typed barrel over `design-system/components/**` (the `.jsx` files with their `.d.ts`), plus the theme layers. `design-system/` itself stays as exported, so it can be re-exported from claude.ai.
  - `tools/engine-check`: the engine check from task 01, re-run on every SDK bump.
  - `tools/lint-rules`: the oxlint plugin that enforces the module and workspace boundaries ([apps/service/README.md](../../apps/service/README.md)) and keeps `process.platform` in the platform layer.
  - `tools/verify-linux`: the script `npm run verify:linux` runs in compose's `verify-linux` container (a folder, not a workspace).
- **Checks:** TypeScript strict everywhere; oxlint, with `design-system/_adherence.oxlintrc.json` applied to `apps/web` except its prop-name lists, which reject the HTML attributes a component's `.d.ts` inherits (TypeScript checks every prop against the `.d.ts`); Prettier; Vitest (with SWC for Nest's decorator metadata); Playwright for the web. `npm run verify` runs all of them.
- **Office data directory:** `OFFICE_DATA_DIR`, default `%LOCALAPPDATA%\the-office` on Windows and `$XDG_DATA_HOME/the-office` (or `~/.local/share/the-office`) on Linux, holding `worktrees/`, `bases/` (each Project's base branch checked out read-only, which chat sessions read), `sessions/`, `skills/` (the library) and `attachments/`. Kept short for Windows `MAX_PATH`.
- **The scripted engine adapter** replays recorded engine output, so every test of Conversations and Pipelines runs without model calls ([research §11.9](../../.scratch/the-office/research/factory-reference.md#119-agentstagerunner-seam-and-scripted-end-to-end-tests)). Real model calls happen only in the engine check and in each task's check on the Test Project.
- **Settings → Skills is built with People** (task 07), because the Planner's chat needs the skill library; task 17 adds limits and appearance to Settings.
- **The click-through is built tier 1 only.** Each task names the prototype parts it builds; the tier 2 and 3 parts of the same screens are left out, with no placeholders or disabled controls.

## Coverage

Every tier 1 item of the spec and the task that builds it. A row with no task is a gap; a tier 2 item in a task is scope creep.

| Spec | Item | Task |
|---|---|---|
| §5.4, §5.6, §6 | The "Could not confirm" checks and permission build rules on pinned versions | 01 |
| §5.1, §5.2 | One Node service on `localhost`; Postgres and `otel-lgtm` in Docker; WebSocket push | 02 |
| §5.1 | Windows and Linux: the platform layer; `verify` on both | 02 (layer, Linux check), 05 and 06 (their platform parts), 17 (a run on Linux) |
| §5.3 | Modules as bounded contexts; domain events for every state change | 02 (pattern), each module's task |
| §5.2 | OpenTelemetry: a trace per Task, spans per Stage and engine call with tokens; metrics; logs | 02 (setup), 06 (engine calls), 12 (Stages) |
| §4 | A3 · Desk: rail, top bar with Idea, status strip frame, panels; theme layers with Light and Dark; brand lockup | 03 |
| §4 | Chat modal; Needs you panel | 09; 16 |
| §2.1, §3 | Projects added by hand: path, commands, publishing mode, default Pipeline | 04 |
| §2.3 | Full, Quick fix, Document as data | 04 |
| §5.5 | Worktree per Task; Office-owned git; serialized ref operations | 05 |
| §5.5 | Environment as data; the environment check in a fresh worktree | 05 |
| §5.4 | `AgentEngine` port with capability flags; Agent SDK adapter; scripted adapter | 06 |
| §5.1 | Lean harness and a stable cached prefix | 06 |
| §6 | The `PreToolUse` hook; profiles; git deny; secrets; PowerShell twins on Windows; protected paths; reads fenced | 06 |
| §6 | Leftover processes ended | 06 (mechanism), 12 (at Stage end) |
| §5.4 | The 5-hour and 7-day windows from the usage query on each `rate_limit_event`; usage per call | 06 |
| §2.6, §5.6 | Skill library, uploads and skills written in place, off until reviewed, "everyone"; per-session plugin folder; the start check | 07 |
| §3 | The Project's skills listed with their switch | 07 |
| §2.2 | Planner, Developer, Reviewer from presets; the Role card form; Hard switches; Task limit; preset profiles shown | 08 |
| §4 | The People grid; a person's page (Overview, Work, Conversations, Role card) | 08 (Work tab: 10) |
| §2.4 | Threads; renaming; a fresh Thread; the Office's message log | 09 |
| §2.5 | The Context policy: resume, fresh, hand off, Brief, label, tokens per Thread, overrides, no compaction | 09 (Threads), 12 (Stage boundaries) |
| §6 | Chats only read; Office tools for chats | 09 (records), 10 (Ideas, Tasks) |
| §2.1 | Ideas captured and shaped into Tasks; Task states; priority and manual order; the board | 10 |
| §2.1 | Attachments by the user | 10 |
| §2.1, §2.3 | Plan and Definition of Done with the Planner; the Planner proposing a Pipeline; Ready | 11 |
| §2.4 | Decisions with options, recommendation, follow-ups and free answers | 11 (planning), 13 (Stages) |
| §2.3 | Agent and Script Stages; result envelope with one correction; loops; round and budget limits; optional Stages | 12 |
| §2.3, §6 | Commit per Stage; HEAD and branch check; worktree restore after tests; output filtering; flake re-run | 12 |
| §9 | Start refused with the reason; waiting Tasks count; Office-wide limit 3; one Task in progress per Project | 12 |
| §2.4 | Barge-in, Stop, Pause; interrupted edits discarded | 13 |
| §2.4, §6 | Office tools for Agents: open a Decision, consult (to the user in tier 1), attach, handover note | 13 |
| §2.3 | Failures and exhausted loops to the user (the CTO is tier 2); budgets to the user | 13 |
| §2.3, §4 | Gates; the Changes tab; screenshots listed by the Agent and kept across test runs | 14 |
| §2.3 | Publish as push + PR or merge; credentials used only by Office code | 14 |
| §2.3 | "Edit for this Task"; started Stages locked; the editor's flags | 15 |
| §1, §4 | Now: Needs you, Running, Since you left, today's tokens | 16 |
| §4 | Status strip: needs you, desks in use, tokens today, 5-hour window, Tasks touched, done since you left | 16 |
| §2.7 | Notifications in-app and desktop; the kinds tree; desktop only when the tab is not focused; Office kinds without a person | 16 |
| §3 | Settings: Office limits, appearance | 17 |
| §3 | The tier 1 test, end to end on the Test Project | 17 |
