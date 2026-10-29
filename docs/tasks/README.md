# Build tasks

[The spec](../spec/3-capabilities-by-tier.md)'s tiers, sliced into tasks in build order. The current task is the first row that is not `done`. How a session works through a task is in [CLAUDE.md](../../CLAUDE.md).

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

Order accepted by the user on 2026-10-27. A task's file is written when it becomes current, after the [open questions](../spec/8-open-questions-and-risks.md) it needs are settled with the user; a row without a link has no file yet.

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
| 28 | The phone: HTTPS on the LAN, the PIN, the installed app, phone views and push | Phone | todo |
| 29 | Running: start at login, the `-p` fallback adapter | Foundation | todo |
| 30 | The tier 2 acceptance run | All | todo |

Carried into task 30 (the user's word, 2026-10-29): from task 25, installing one skill from github.com/anthropics/skills on the running app, and the user's look at installing, updating and a drafted skill there.

## After tier 2: the remaining fixes

Decided with the user on 2026-10-27: a fix is built where it is found only when it would be harder to make after the changes that come next. Every other fix is listed here, and they are done together once tier 2 is done and before tier 3, each spec amendment agreed with the user then. The numbers are the tier 1 run's problems in [archive/17-settings-acceptance.md](archive/17-settings-acceptance.md), each with its proposed fix there.

- Problem 1: make the whole Task card on the board the link, its menu and buttons stopping the click.
- Problem 3: the "+ Task" dialog says the work is described when planning with the Planner, and opens the new Task's page.
- Problem 7: a Stage session that starts adds its tab right after the current one, marked new, without switching to it.
- Problems 9 and 10: the Gate view says what the user does there; the Stage editor says a Gate's name is a label for the user; a Script Stage chosen to send back to says it can't read the feedback.
- Problem 2: the board card's "…" menu is clipped when the board is short. Render it outside the column's overflow, flipping up when there is no room below.
- Problem 8: on the Changes tab, every file starts folded to its header with its +/- counts, unfolds on a click, with "Unfold all" and "Fold all".
- Problem 13: count tokens without cache reads everywhere (Threads, Stages, Now, the strip), with an info icon giving input, output, cache writes and cache reads and what each costs. Amends [spec 2.7 Defaults](../spec/2.7-notifications.md#defaults), "Today's figures", which counts all four kinds.
- Found in task 24: the Project page's toast on a saved command says running Tasks keep the one they started with (`surfaces/projects/commands-block.tsx`), but a Script Stage runs the Project's command as it is when the Stage runs (`ScriptStageRunner` through `TaskCommands`), and `ProjectService.changeCommand` says the same as the toast. Proposed fix: word the toast and the comment as it works ("Command saved. Tasks run it from their next Build, Lint or Test Stage."), unless the user wants a started Task to keep its commands.
- Found in task 24: Start refuses only when the first Agent Stage's Role is vacant (`work/domain/task-start.ts`). A later Agent Stage whose Role nobody fills, which the library now only flags, lets the Task start and then fails in the runner ("Nobody fills the Role"), since `pipelines/application/staffing-holds.ts` holds Tasks when someone is let go (and Resume checks staffing) but nothing does on `TaskStarted`. Proposed fix: hold the Task on `TaskStarted` too, paused behind the same Decision Resume and letting someone go give, so it carries on, or drops, by the user's answer once someone fills the Role.
- Found in task 24: applying a `project` Proposal adds the Project, then its Onboard Task, in separate transactions (Work's `ProjectProposals`). If the Task can't be added (in practice, its worktree can't be made), the Proposal is refused but stays open with the Project already added, and applying it again tries to add the Project a second time. Proposed fix: on a second apply, find the Project the Proposal already added (by its repository) and carry on with the Task, so applying converges.
- Found in task 25: an applied `skill-update` Proposal's card reads its files' diff from the Source each time (`GET /skills/:name/update-diff`, `shell/skill-update-diff.tsx`), so it shows an error once the Source is gone or no longer has those versions. Proposed fix: keep the diff with the Proposal when it is applied (or the files hash's diff from the library's kept versions), and show that on an applied card.

Read these only when a step needs them:

- [build-defaults.md](build-defaults.md): choices the spec leaves open (Windows and Linux, the workspace layout, the checks, the Office data directory, the scripted engine adapter). Change one only with the user.
- [test-project.md](test-project.md): the Project a task's check runs on.
- [coverage.md](coverage.md): every spec item of a tier and the task that builds it, for slicing a tier and closing one.
- [archive/](archive/): the full Progress logs of finished tasks. A session reads one only to trace why something was done; the module maps hold what was built.
