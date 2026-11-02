# Build tasks

[The spec](../spec/3-capabilities-by-tier.md)'s tiers, sliced into tasks in build order. The current task is the first row that is neither `done` nor `postponed`. How a session works through a task is in [CLAUDE.md](../../CLAUDE.md).

## Tier 1: the base

Done 2026-10-27. The problems its acceptance run surfaced are in [archive/17-settings-acceptance.md](archive/17-settings-acceptance.md); task 18 fixes them.

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
| 10 | [Work: Ideas, Tasks, the board and Attachments](10-work.md) | Work and the Task page | done |
| 11 | [Planning a Task with the Planner](11-planning.md) | Work and the Task page | done |
| 12 | [The Stage interpreter: Start, Agent and Script Stages, loops](12-stage-interpreter.md) | Work and the Task page | done |
| 13 | [A running Task: barge-in, Stop, Pause, Decisions, Office tools](13-running-task.md) | Work and the Task page | done |
| 14 | [Gates, the Changes tab and Publish](14-gates-publish.md) | Work and the Task page | done |
| 15 | [Edit for this Task: the Stage editor](15-stage-editor.md) | Work and the Task page | done |
| 16 | [Now, the status strip and Notifications](16-now-notifications.md) | Now | done |
| 17 | [Settings, and the tier 1 acceptance run](17-settings-acceptance.md) | Settings | done |

## Tier 2: the all-day workspace

Done 2026-10-30, the phone left out (task 28, postponed). The user's verdict: they would run all their Projects' work through The Office all day from the desk once the problems its acceptance run surfaced are fixed; those are in the after-tier-2 list below, from [archive/30-tier-2-acceptance.md](archive/30-tier-2-acceptance.md).

Order accepted by the user on 2026-10-27. A task's file is written when it becomes current, after the [open questions](../spec/8-open-questions-and-risks.md) it needs are settled with the user; a row without a link has no file yet. Task 28, the phone, is postponed by the user (2026-10-29) and left out of the rest of tier 2, the acceptance run included, until they decide; its file keeps the answers settled so far.

| # | Task | Surface | Status |
|---|---|---|---|
| 18 | [Tier 1 fixes: the acceptance run's problems](18-tier-1-fixes.md) | Work and the Task page | done |
| 19 | [Shared memory and the Memory tab](19-shared-memory.md) | People | done |
| 20 | [People: hiring from scratch, letting go, editable profiles, Consultants, mentions](20-people-tier-2.md) | People | done |
| 21 | [The Office Manager and Proposals](21-office-manager.md) | People | done |
| 22 | [The CTO, Initiatives and dependencies](22-cto-initiatives.md) | Work | done |
| 23 | [Tags, search, saved views and the Project filter](23-tags-search-views.md) | Work | done |
| 24 | [Devops: the Pipeline library, Project commands by Proposal, onboarding](24-devops-pipeline-library.md) | Projects | done |
| 25 | [Skills from a source, and update Proposals](25-skills-from-a-source.md) | Settings | done |
| 26 | [Parallel work in a Project, and a queue for Start](26-parallel-work-and-start-queue.md) | Work and the Task page | done |
| 27 | [Notifications: the kinds × channels grid, quiet hours, batching; the fire alarm](27-notifications-and-fire-alarm.md) | Now | done |
| 28 | [The phone: HTTPS on the LAN, the PIN, the installed app, phone views and push](28-the-phone.md) | Phone | postponed |
| 29 | [Running: the `-p` fallback adapter](29-the-p-fallback.md) | Foundation | done |
| 30 | [The tier 2 acceptance run](30-tier-2-acceptance.md) | All | done |

Carried into task 30 (the user's word, 2026-10-29): from task 25, installing one skill from github.com/anthropics/skills on the running app, and the user's look at installing, updating and a drafted skill there.

## After tier 2: the remaining fixes

Decided with the user on 2026-10-27: a fix is built where it is found only when it would be harder to make after the changes that come next. Every other fix is listed here, and they are done together once tier 2 is done and before tier 3, each spec amendment agreed with the user then. The numbers are the tier 1 run's problems in [archive/17-settings-acceptance.md](archive/17-settings-acceptance.md), each with its proposed fix there. Task 31 builds them all (the user's word, 2026-10-30) and removes each line once it is built.

| # | Task | Surface | Status |
| --- | --- | --- | --- |
| 31 | [The after-tier-2 fixes](31-after-tier-2-fixes.md) | All | done |
| 32 | [The fixes task 31's run found](32-after-task-31-fixes.md) | All | done |
| 33 | [The read fence in the hook, and what onboarding reads](33-read-fence-and-onboarding-reads.md) | All | done |

## Tier 3: on need

Order accepted by the user on 2026-10-31. As in tier 2, a task's file is written when it becomes current, after the [open questions](../spec/8-open-questions-and-risks.md) it needs are settled with the user. Task 28, the phone, waits until after tier 3 (the user, 2026-10-31). Task 46, a Project from a git repository, was added on 2026-10-31 to come right after task 36; it keeps its number so the others keep theirs. Task 47, engines as a list with a cascade of defaults and overrides, was added on 2026-11-01 to come right after task 37.

| # | Task | Surface | Status |
| --- | --- | --- | --- |
| 34 | [Telemetry: the bundled `otel-lgtm` optional, the user's own Grafana or collector](34-telemetry-own-grafana.md) | Foundation | done |
| 35 | [The OpenAI-compatible API engine, for local LLMs](35-api-based-engine.md) | Foundation | done |
| 36 | [MCP servers for Agents](36-mcp-servers.md) | People | done |
| 46 | [A Project from a git repository, and Sign in with GitHub](46-project-from-git-repository.md) | Projects | done |
| 37 | [Usage estimates](37-usage-estimates.md) | Now | done |
| 47 | [Engines as a list: Claude Code per account with a simple sign-in, and the engine cascade (Office, Project, Role)](47-engines-as-a-list.md) | Settings and Projects | in progress |
| 38 | Archive, and moving Tasks between Projects | Work | todo |
| 39 | Attachment versions | Work and the Task page | todo |
| 40 | Stage templates in the Pipeline library | Projects | todo |
| 41 | The Graphite and Paper palettes, the densities, skill usage counts | Settings | todo |
| 42 | Email and chat-app Notifications | Now | todo |
| 43 | Talking to The Office from chat apps | Conversations | todo |
| 44 | Stack-specific checks for installs and publishing | Projects | todo |
| 45 | The tier 3 acceptance run | All | todo |

## After tier 3: the remaining fixes

As in tier 2 (the user, 2026-10-31): a fix is built where it is found only when it would be harder to make after the changes that come next. Every other fix or open check is listed here and done together once tier 3 is done; a task that builds one removes its line.

- **Spawn-and-end-tree code in two places:** `projects/adapters/shell/` and the engine's `adapters/openai-compatible-api/shell-command.ts` each start a command and end its process tree. Proposed: move the shared part into `platform/os/`.
- **An idle session and a background command's notice (task 35):** the pinned binary queues `<task-notification>` at priority `next`, but whether an idle SDK session starts a turn for it was not seen live; the OpenAI-compatible API engine lands it at the next turn. Check in the engine check, and match if they differ.
- **A skill loaded on a live API endpoint (task 35):** the Skill tool is tested on the fake server only; see it once on a live server.
- **`devops-proposals.test.ts` still flaky (found 2026-11-01):** after `99258d1` gave each test its own engine, "applied again after its Onboard Task failed" stopped once with "Still drafting." under `verify:linux` and passed on the rerun. Find what is still load-sensitive.
- **A flaky token count in `now-service.test.ts` (found 2026-11-01):** "counts today's tokens" expected 2 to be 1 once under a full `npm run verify` and passed alone. Find what it shares with other tests.
- **A flaky "Conflicts at Publish" test (found 2026-11-01):** `tasks.controller.test.ts` failed once under a full `npm run test` and passed on the rerun; cause not looked into. Find why it is load-sensitive and make it independent.
- **A flaky board drag e2e test (found 2026-11-01):** `work.e2e.ts` "dragging a card reorders its column, and the order survives a reload" failed once under a full `npm run verify` (the Backlog's order polled unchanged) and passed on the rerun. Find what it races.
- **A flaky clone e2e test (found 2026-11-02):** `projects.e2e.ts` "the user adds a Project by its git URL: cloned first, then the form opens from the clone" failed once under a full `npm run verify` in task 47's step 1c3 (the dialog's Name field not found after Clone) and passed alone. Find what it races.
- **A flaky skill update test (found 2026-11-02):** `skill-updates.test.ts` "finds no update while the pinned version is the Source's newest" failed once under a full `npm run verify` in task 47's step 1e4 with EPERM on the rename in `skill-file-folders.ts` `writeWhole` (Windows, a file held open meanwhile) and passed alone. Find what holds it.
- **A flaky upload e2e test (found 2026-11-02):** `skills.e2e.ts:105` "the user uploads a .md and a zipped folder; each arrives off" failed once under a full `npm run verify` in task 47's step 1e4 ("collect uploaded. It is off until you review it." not shown in 5 s) and passed alone. Find what it races.
- **A flaky Window caps test (found 2026-11-02):** `tasks.controller.test.ts` "Window caps > releases a Task the window holds an hour before the window resets" passed the 5 s test timeout once under a full `npm run verify` in task 47's step 1g and passed alone in 6.7 s total. Find what makes it slow under load.
- **A flaky tagging e2e test (found 2026-11-01):** `work.e2e.ts` "the user tags a Task in "+ Task" and on its page, and the board shows its Tags" failed once under a full `npm run verify` in task 37's step 2a and passed alone, and again (`work.e2e.ts:207`) later in task 37 and in task 47's step 1c. Find what it races.
- **Tests that fail only under heavy load (found during task 37):** `projects.e2e.ts:109`, `people.e2e.ts:1469` and `roles.controller.test.ts` (a timeout); in step 7c also `tasks.controller.test.ts` (5 s timeouts of a different test in each of three full runs: the fire alarm's all clear, an Overlap, the queue's order), `openai-compatible-api-engine.test.ts`'s shell test and `skills.e2e.ts:105` each failed under a loaded machine and passed alone; `people.e2e.ts:2019` (no "→ v1.1.0" within 15 s, one skill in the library) once in step 7b; in task 47's step 1b, the Window caps test "releases a Task the window holds an hour before the window resets" (its margin is `HOUR + 500` ms, and 1b added an engines read on the Start path), again once in step 1e; in step 1c3b, `people.e2e.ts:449` (the Planner's first answer not shown within 5 s) once in a full run; in step 1d, `work.e2e.ts:207` (the Task's Tag "firmware" not shown within 5 s) once in a full run, and `tasks.controller.test.ts`'s fire alarm all clear timing out again; in step 1e2, `filesystem-library-folder.test.ts`'s prune test (EPERM renaming a `.writing-` folder into place, Windows) and a `tasks.controller.test.ts` test, once each in a full run. In step 1e3, the Window caps test twice, `devops-proposals.test.ts` ("Still drafting." in a `vi.waitFor`, two different tests), `skills.controller.test.ts`'s "edits a written skill into its next version" (a 500) and `skill-updates.test.ts` (EPERM renaming a `.writing-` folder, Windows), each in one full run and passing alone. In step 1e4 the Window caps test failed in four of five full runs: making the Task used up its 500 ms margin before the Start, so it now reads the window after making the Task. Find what each races or waits on too briefly. (`mcp-servers.e2e.ts:27` was fixed in step 7b: turning a server on connects to it again, and the test gave that 5 s, not the review's 30.)
- **`EngineSessions.readUsageWindows` is public only for tests (task 37):** step 7c left it public for Engine's four tests of it. Small cleanup: make it private and drive those tests through a rate-limit event.
- **Capture's "Where" list doesn't scroll (found during task 37):** Capture an Idea's "Where" list grows with every Project, so with enough Projects the Capture button is pushed out of the window (seen in `work.e2e.ts:103`). Fix: let the list scroll.
- **A Stage edit lost during a Pipeline swap (found 2026-11-01):** in the Task's Stages dialog, the form is keyed by the Task's Pipeline (`edit-task-stages-dialog.tsx`), so an edit made while the swap's request is in flight is dropped without a word when it lands. Fix: disable the Stage editor while the swap is pending.
- **Task 46's live check and open boxes (marked done for now, 2026-11-01):** step 10, the live check on the Test Project, is not run, and the boxes for every git command on the Office identity, cloning by URL, and Devops reading by URL are not ticked. The task's State lists what is unverified in GitHub's docs and a trap in `gate-publish-test-project-check.test.ts`. The user has parts of the task to discuss first.
- **Task 35's choices for the user to review**, made while building and recorded in [archive/35-api-based-engine.md](archive/35-api-based-engine.md):
  - WebFetch gives the page text to the session's own model under the call's prompt, with no second request; the page stays in the session's context.
  - Nothing is compacted; without a token count from the server, usage is estimated at 4 characters per token.
  - WebSearch and Skill are always offered, so the tool list stays fixed; without a Search endpoint a WebSearch call is refused after the Office rules allow it.
  - A turn that must give structured output and doesn't is reminded twice, then fails.
  - After a resume, Edit needs a fresh Read; nested `CLAUDE.md` files, `@` imports and nested skills are not loaded.
  - Settings › Engines has no click-through screen, so its wording and layout are new; "Search endpoint" is a new glossary term.
- **Processes checked by id alone after a slow end:** some tests still ask whether a process runs by its id after waiting (e.g. `openai-compatible-api-engine.test.ts`, about l. 705–878), and Windows hands an id to a new process within a second. Use `processMark` and `isMarkedRunning` from `platform/os/process-trees.fixtures.ts`, as 9ac6271 did for the MCP client.
- **An unexplained `verify:linux` e2e failure (task 36):** once, `mcp-servers.e2e.ts:95` found the failing server's standard error missing from the review's problem; not reproduced in about 1800 runs. Proposed: `verify-linux.sh` copies `e2e-results` out on a failure, and the MCP failure reason names the exit code or signal.
- **A slow MCP server mid-session (task 36):** whether a server slow to start (as `npx -y`) arrives in a Claude Code session mid-way, as a `tool_addition`, was not seen live. Check it in the engine check.
- **Task 36's choices for the user to review**, made while building and recorded in the State of [36-mcp-servers.md](36-mcp-servers.md):
  - On the OpenAI-compatible API engine, a server that failed to start keeps its tools listed, and each call answers why; Claude Code drops them.
  - A server left out for a missing required value is told only in the Brief.
  - A local server's Server values are environment variables of its own process; on Linux they are readable to the same user, as any process's environment is.
  - Tools whose `mcp__<server>__<tool>` name runs over 64 characters are left out of sessions and flagged in the review.
  - Claude Code lists MCP tools as deferred, so the Agent loads them with ToolSearch before its first call (seen live with Haiku).

Read these only when a step needs them:

- [build-defaults.md](build-defaults.md): choices the spec leaves open (Windows and Linux, the workspace layout, the checks, the Office data directory, the scripted engine adapter). Change one only with the user.
- [test-project.md](test-project.md): the Project a task's check runs on.
- [coverage.md](coverage.md): every spec item of a tier and the task that builds it, for slicing a tier and closing one.
- [archive/](archive/): the full Progress logs of finished tasks. A session reads one only to trace why something was done; the module maps hold what was built.
