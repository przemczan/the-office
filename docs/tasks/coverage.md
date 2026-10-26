# Coverage: tier 1

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
| §2.1, §6 | Agents read a Task's Attachments through an Office tool | 11 |
| §2.1, §2.3 | Plan and Definition of Done with the Planner; the Planner proposing a Pipeline; Ready | 11 |
| §2.4 | Decisions with options, recommendation, follow-ups and free answers | 11 (planning), 13 (Stages) |
| §2.3 | Agent and Script Stages; result envelope with one correction; loops; round and budget limits; optional Stages | 12 |
| §2.3, §6 | Commit per Stage; HEAD and branch check; worktree restore after tests; output filtering; flake re-run | 12 |
| §2.1, §2.2 | Start refused with the reason; waiting Tasks count; Office-wide limit 3; one Task in progress per Project | 12 |
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
