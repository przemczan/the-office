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

Order accepted by the user on 2026-10-31. As in tier 2, a task's file is written when it becomes current, after the [open questions](../spec/8-open-questions-and-risks.md) it needs are settled with the user. Task 28, the phone, waits until after tier 3 (the user, 2026-10-31). Task 46, a Project from a git repository, was added on 2026-10-31 to come right after task 36; it keeps its number so the others keep theirs. Task 47, engines as a list with a cascade of defaults and overrides, was added on 2026-11-01 to come right after task 37. Task 48, the Task page redesign, was put ahead of task 38 on 2026-11-04 so that task 39 builds on its Attachments tab. Task 49, for questions to an Agent at a Gate or after a Task ended (which session answers, whose budget, whether it can change code, whether it holds the Gate), was added the same day; it needs a spec change. Later that day the user folded it into task 51, which comes right after task 48 and takes the user's notes on the page task 48 built: one Thread per person on the Task, written in at any time, so task 49's questions are settled there. Task 50, Office instructions (a working name for what the user asked for as a global `agents.md`), was added the same day to come right after task 48: one text the user writes in Settings, for general guidelines, that every person's session gets with their Role's instructions. A Skill can't do this: on the user's Office only 23 of the 60 sessions that mentioned a `global-instructions` Skill opened it, and 29 others edited files or ran commands without it. Task 50 needs a spec change and a Glossary term. Settled with the user on 2026-11-06, in [its file](50-office-instructions.md): the name; which wins when it disagrees with a Role's instructions or a Project's `CLAUDE.md`; whether a changed text reaches running sessions or only new ones; whether it joins the Office settings the Office Manager can draft as a Proposal. Both session starts need it (`thread-runner.ts`, `stage-threads.ts`), on every engine. The `global-instructions` Skill's text moves in, without its LSP lines (sessions have no LSP tool), and the Skill goes. Task 38 has no file: it is run in The Office itself as an Initiative, whose Tasks carry its plan, and its "Close build task 38" Task sets it to done (the user, 2026-11-07). Task 39, Attachment versions, waits until after tier 3 (the user, 2026-11-08): the rounds a Task's Attachments are shown by, built in task 48, are enough for now. Task 40, Stage templates, was postponed the same day and brought back as the next task; settled in [spec 2.3](../spec/2.3-pipelines.md#defaults): templates live in Settings › Pipelines, are made from scratch or with Save as template, are added to a Pipeline or a Task's Stages as a copy, and the built-in Stages are seeded once as templates. Like task 38, it has no file: it is run in The Office itself as an Initiative, whose Tasks carry its plan, and its "Close build task 40" Task sets it to done. Task 41 is run as the Initiative `d2d253ac-1328-46be-ad7d-74a8ddfff267` too, but unlike tasks 38 and 40 it has a file, each of its steps being one of the Initiative's Tasks.

| # | Task | Surface | Status |
| --- | --- | --- | --- |
| 34 | [Telemetry: the bundled `otel-lgtm` optional, the user's own Grafana or collector](34-telemetry-own-grafana.md) | Foundation | done |
| 35 | [The OpenAI-compatible API engine, for local LLMs](35-api-based-engine.md) | Foundation | done |
| 36 | [MCP servers for Agents](36-mcp-servers.md) | People | done |
| 46 | [A Project from a git repository, and Sign in with GitHub](46-project-from-git-repository.md) | Projects | done |
| 37 | [Usage estimates](37-usage-estimates.md) | Now | done |
| 47 | [Engines as a list: Claude Code per account with a simple sign-in, and the engine cascade (Office, Project, Role)](47-engines-as-a-list.md) | Settings and Projects | done |
| 48 | [The Task page redesign](48-task-page-redesign.md) | Work and the Task page | done |
| 51 | [The Task page, round 2: the user's notes on task 48's page, with task 49](51-task-page-round-2.md) | Work and the Task page | done |
| 52 | [The Task page, round 3: the user's notes on task 51's page](52-task-page-round-3.md) | Work and the Task page | done |
| 53 | [The Thread in Rows, and whole commands](53-thread-in-rows.md) | Conversations | done |
| 54 | [The Task's branch keeps up with the base](54-branch-keeps-up.md) | Work | done |
| 50 | [Office instructions: general guidelines for everyone](50-office-instructions.md) | Settings | done |
| 38 | Archive, and moving Tasks between Projects: run as the Initiative `145c5f3c-bf2b-4bf3-b3cb-760ad58655f8` | Work | done |
| 39 | Attachment versions | Work and the Task page | postponed |
| 40 | Stage templates in the Pipeline library: run as the Initiative `791c8082-e0b0-4043-85d0-596497ce7a24` | Projects | done |
| 41 | [The Graphite and Paper palettes, the densities, skill usage counts](41-palettes-densities-skill-usage-counts.md) | Settings | done |
| 42 | Email and chat-app Notifications | Now | todo |
| 43 | Talking to The Office from chat apps | Conversations | todo |
| 44 | Stack-specific checks for installs and publishing | Projects | todo |
| 45 | The tier 3 acceptance run | All | todo |

## After tier 3: the remaining fixes

As in tier 2 (the user, 2026-10-31): a fix is built where it is found only when it would be harder to make after the changes that come next. Every other fix or open check is listed here and done together once tier 3 is done; a task that builds one removes its line.

- **Spawn-and-end-tree code in two places:** `projects/adapters/shell/` and the engine's `adapters/openai-compatible-api/shell-command.ts` each start a command and end its process tree. Proposed: move the shared part into `platform/os/`.
- **An idle session and a background command's notice (task 35):** the pinned binary queues `<task-notification>` at priority `next`, but whether an idle SDK session starts a turn for it was not seen live; the OpenAI-compatible API engine lands it at the next turn. Check in the engine check, and match if they differ.
- **A skill loaded on a live API endpoint (task 35):** the Skill tool is tested on the fake server only; see it once on a live server.
- **A flaky board drag e2e test (found 2026-11-01):** `work.e2e.ts` "dragging a card reorders its column, and the order survives a reload" failed once under a full `npm run verify` (the Backlog's order polled unchanged) and passed on the rerun; again on 2026-11-04 (step 48 5b), the order polled changed but wrong. Half found in step 48 5c: the app sent the neighbours from every Project's Tasks in its last read, so another test's Task changing state under the drag got the drop refused and the order put back, which is the "unchanged" failure; `placementAmong` now names only cards on show. The "changed but wrong" failure isn't explained: the service can't produce it from those neighbours, so the drop must have landed on Order second. If it comes back, record the order it polled and what moved the board during the drag. Not seen again in the flake Task's 18 full e2e runs of 2026-11-07/08, one of them pinned to 2 CPUs.
- **Flakes not seen again on Linux (the flake Task, 2026-11-07):** none of these failed in 18 full e2e and 21 full vitest runs, one of each pinned to 2 CPUs (`taskset -c 0,1`), and no race showed in their code; each failed once in a loaded full run before. If one comes back, keep its trace or test output and the run's load.
  - `people.e2e.ts`'s "the user chats with the Planner, who reads but changes nothing" (the Planner's first answer not shown within 5 s) and "the user reads a Consultation on the Task, …": each waits on a scripted session's first turn.
  - EPERM renaming a `.writing-` folder into place (`skill-updates.test.ts`, `filesystem-library-folder.test.ts`'s prune test, and `skills.controller.test.ts`'s 500 on editing a skill, the same rename): a Windows scanner holding a file in the new folder, outside the code; `platform/os/move-when-free.ts` (a0cf9328) tries again for about 2 s. Linux never refuses that rename. Check on Windows.
  - `roles.controller.test.ts`'s MCP server review (a Node process start) and the fire alarm's tests in `tasks.controller.test.ts` were given 30 s and 15 s in a0cf9328, from their times in full runs; they wait on their answers, not on a margin.
- **`EngineSessions.readUsageWindows` is public only for tests (task 37):** step 7c left it public for Engine's four tests of it. Small cleanup: make it private and drive those tests through a rate-limit event.
- **Planning again after a Task left Ready (task 52, for the user):** a Task moved back to Backlog keeps its planning Thread, so Plan with… and Make a plan open a second one and `conversationTabs` shows the oldest; with Make a plan the Planner works in a Thread the page doesn't show. Decide whether planning again reuses the Thread.
- **Capture's "Where" list doesn't scroll (found during task 37):** Capture an Idea's "Where" list grows with every Project, so with enough Projects the Capture button is pushed out of the window (seen in `work.e2e.ts:103`). Fix: let the list scroll.
- **Task 46's live check and open boxes (marked done for now, 2026-11-01):** step 10, the live check on the Test Project, is not run, and the boxes for every git command on the Office identity, cloning by URL, and Devops reading by URL are not ticked. The task's State lists what is unverified in GitHub's docs and a trap in `gate-publish-test-project-check.test.ts`. The user has parts of the task to discuss first.
- **Engine check: a `--config-dir` option and `skills.user-scope` under an engine folder (task 47):** the engine check strips `CLAUDE_CONFIG_DIR` from its sessions and reads the user scope only from `~/.claude`, so `skills.user-scope` has not run under a Claude Code engine's own folder; the user dropped it from task 47's live check on 2026-11-03, their live run covering it. Add the option (setting `CLAUDE_CONFIG_DIR` on sessions, and reading that folder's user scope too), run the check under an engine's folder on Haiku and update [the engine check](../engine-check.md).
- **Publishing's lock lookup (task 47, a proposal):** `locked()`'s `rev-parse --git-common-dir` is 20% of Publishing's git starts; caching it per folder would change which repositories share a lock, so it was proposed, not done.
- **A stalled Source read holds later skill checks (task 47):** `SkillUpdates.check` has no pass guard, so a stalled `ls-remote` (120 s timeout) still holds the passes after it.
- **Task 47's choices for the user to review**, made while building and recorded in the task's [Read first and State](47-engines-as-a-list.md): Engine owns the engines and the Office default, People the Role override and the cascade (`EngineCascade`), Projects the Project levels, no new module; an override names an engine and a model together, or nothing; the Role card's line shows what applies outside any Project, with the Projects where something else applies listed under it; Stage runs keep the engine's id and name; the engine down Notification names the engine; engine folders lie in the Office data directory, with no new secret path; a moved Role override is the card's next version by the user, a let-go Role's too; a removed engine's usage is cleared, not moved, and its prices kept; a refused removal's preview answers 200 with `problems`.
- **Task 35's choices for the user to review**, made while building and recorded in [archive/35-api-based-engine.md](archive/35-api-based-engine.md):
  - WebFetch gives the page text to the session's own model under the call's prompt, with no second request; the page stays in the session's context.
  - Nothing is compacted; without a token count from the server, usage is estimated at 4 characters per token.
  - WebSearch and Skill are always offered, so the tool list stays fixed; without a Search endpoint a WebSearch call is refused after the Office rules allow it.
  - A turn that must give structured output and doesn't is reminded twice, then fails.
  - After a resume, Edit needs a fresh Read; nested `CLAUDE.md` files, `@` imports and nested skills are not loaded.
  - Settings › Engines has no click-through screen, so its wording and layout are new; "Search endpoint" is a new glossary term.
- **Processes checked by id alone after a slow end:** some tests still ask whether a process runs by its id after waiting (e.g. `openai-compatible-api-engine.test.ts`, about l. 705–878), and Windows hands an id to a new process within a second. Use `processMark` and `isMarkedRunning` from `platform/os/process-trees.fixtures.ts`, as 9ac6271 did for the MCP client.
- **A refused turn seen live (Task 3de35a58):** `engine.usage-window-refusal` and `fallback.usage-window-refusal` were written from the pinned binary's code, since no window ran out while the Task ran and no trace of a real refused turn was found. On a signed-in machine with a used-up window, run both (`npm run engine-check -- --only engine.usage-window-refusal --only fallback.usage-window-refusal --record`), write what they observe into [the engine check](../engine-check.md), and match the detection in `sdk-events.ts` and its recording to it.
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
