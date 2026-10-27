# Build tasks: tier 1

Tier 1 of [the spec](../spec/3-capabilities-by-tier.md#tier-1-the-base), sliced into tasks in build order. The current task is the first row that is not `done`. How a session works through a task is in [CLAUDE.md](../../CLAUDE.md).

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
| 17 | [Settings, and the tier 1 acceptance run](17-settings-acceptance.md) | Settings | in progress |

Read these only when a step needs them:

- [build-defaults.md](build-defaults.md): choices the spec leaves open (Windows and Linux, the workspace layout, the checks, the Office data directory, the scripted engine adapter). Change one only with the user.
- [test-project.md](test-project.md): the Project a task's check runs on.
- [coverage.md](coverage.md): every tier 1 spec item and the task that builds it, for slicing a tier and closing one.
- [archive/](archive/): the full Progress logs of finished tasks. A session reads one only to trace why something was done; the module maps hold what was built.
