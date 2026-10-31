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
| 33 | [The read fence in the hook, and what onboarding reads](33-read-fence-and-onboarding-reads.md) | All | in progress |

Read these only when a step needs them:

- [build-defaults.md](build-defaults.md): choices the spec leaves open (Windows and Linux, the workspace layout, the checks, the Office data directory, the scripted engine adapter). Change one only with the user.
- [test-project.md](test-project.md): the Project a task's check runs on.
- [coverage.md](coverage.md): every spec item of a tier and the task that builds it, for slicing a tier and closing one.
- [archive/](archive/): the full Progress logs of finished tasks. A session reads one only to trace why something was done; the module maps hold what was built.
