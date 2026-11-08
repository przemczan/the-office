# Coverage

## Tier 1

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

## Tier 2

Every tier 2 item of [spec 3](../spec/3-capabilities-by-tier.md#tier-2-the-all-day-workspace) and the task that builds it. Rows are refined, with spec sections, as each task's file is written.

| Spec | Item | Task |
|---|---|---|
| §3 (tier 1 run) | The tier 1 run's fixes that would get harder later: 4, 5, 6, 11, 12 | 18 |
| §3 (tier 1 run), §2.7 | The rest: 1, 2, 3, 7, 8, 9, 10, and 13 (amends the spec) | after tier 2, [README](README.md#after-tier-2-the-remaining-fixes) |
| §2.2, §8 | Shared memory, its Memory tab and delete actions; Memory on for the Planner | 19 |
| §2.2, §6 | Hiring from scratch; letting go; editable permission profiles; holding an enforced Hard switch's call | 20 |
| §2.2, §2.4 | Consultants and Consultations, escalation up to two steps; mentions | 20 |
| §2.2, §2.7, §6 | The Office Manager: Proposals for Roles and Office settings, Link cards, capturing Ideas, the Office status; Office kinds of Notifications from them | 21 |
| §2.1, §2.2, §6 | The CTO preset; dependencies and Start refused while blocked | 22 |
| §2.1, §2.4, §2.7 | Initiatives: shaping with the CTO, their states, the Task graph, Proposals once active, "Initiative done"; mentioning an Initiative in a chat | 22 |
| §2.3 | The CTO asked first on a Stage failed with no retries left or a round limit | 22 |
| §2.1 | Tags, full-text search, saved views; the Project filter | 23 |
| §2.3, §2.2 | The Pipeline library editor; Devops owning the library and Project commands by Proposal; the proof-of-concept publish target | 24 |
| §2.1, §8 | Onboarding a Project through Devops | 24 |
| §2.6 | Installing skills from a source; update Proposals | 25 |
| §2.6 | A skill drafted as a Proposal from a chat | 25 |
| §2.1, §2.2, §8 | Several Tasks in progress per Project; the queue for Start, on the board, the Task page and Now | 26 |
| §2.1, §8 | Overlaps: the Plan's files to change, the warning at Start, queuing behind a Task | 26 |
| §2.3, §5.5, §8 | Conflicts at Publish: the Resolve Stage, the Project's Test and a Gate before Publish again | 26 |
| §2.7 | The kinds × channels grid (with the Phone column); quiet hours; batching; the at-desk hold (phone pushes through a recording port until 28's Web Push) | 27 |
| §2.8 | The fire alarm and the all clear | 27 |
| §4, §2.7 | The phone: HTTPS on the LAN with a local certificate authority, the PIN, the installed app, phone views, phone push (postponed; left out of tasks 29 and 30 until the user decides) | 28 |
| §5.4 | The `-p` fallback adapter, matching the Agent SDK adapter (start at login left out for now, §3) | 29 |
| §3, §2.1–§2.8, §5.4 | The tier 2 test, all day from the desk, on the Test Project on Linux, driven through the API (the phone left out while task 28 is postponed) | 30 |

## Tier 3

Every tier 3 item of [spec 3](../spec/3-capabilities-by-tier.md#tier-3-on-need) and the task that builds it. Rows are refined, with spec sections, as each task's file is written.

| Spec | Item | Task |
|---|---|---|
| §5.2 | The bundled `otel-lgtm` optional; the telemetry sent to the user's own Grafana or OpenTelemetry collector | 34 |
| §5.4, §5.6, §2.5, §6, §8 | The OpenAI-compatible API engine, The Office's own agent loop, for local LLMs: API endpoints and a search endpoint set Office-wide, streamed replies, background commands, skills and the Context policy | 35 |
| §2.2, §5.4, §6, §8 | MCP servers for Agents: an Office-wide library reviewed before use, assigned on the Role card, Server values set Office-wide and per Project, each MCP tool judged by the Office rules from Consult Devops; on all three engines | 36 |
| §2.1, §2.2, §2.7, §3, §4, §5.4, §8 | Usage estimates of a Task at Start, for its whole Pipeline, per engine, in the measures ticked Office-wide (tokens, the 5-hour and 7-day windows, cost): the median of done Tasks' Stage runs for the same Project and Pipeline, else the Planner's token estimate; Model prices per model in Settings › Engines; shown on Ready Tasks, in the Start flow and in the queue; the Window caps and Daily caps (tokens, dollars), per account for the Claude Code engines, one set for the OpenAI-compatible API, hold a Start in the queue until they reset, or start it when they reset within the cache's hour | 37 |
| §2.1, §2.2, §2.3, §3, §4, §5.4, §5.6, §6, §8 | Engines as a list in Settings › Engines: a Claude Code engine per account in its own config folder with a "Sign in" (`claude auth login`) and the `-p` switch, each API endpoint an engine, each with a default model; caps, usage and Model prices per engine; the engine cascade (Office default, Project default with "Use for every Role", Role override, the Project's Role override) for every session, checked at every level; no Stage model; the Role card showing what applies and from where; the Project page's Engine block; removing an engine with a replacement | 47 |
| §2.2, §4 | Office instructions: one text from Settings in every person's session on every engine, versioned as a Role card is, and a Proposal of the Office Manager | 50 |
| §2.1 | Archive; moving Tasks between Projects until In progress, the Plan marked for the Planner to re-check | 38 |
| §2.1 | Attachment versions: postponed until after tier 3 (2026-11-08) | 39 |
| §2.3 | Stage templates in the Pipeline library | 40 |
| §4, §2.6 | The Graphite and Paper palettes; the densities; skill usage counts | 41 |
| §2.7 | Email and chat-app Notifications (WhatsApp first) | 42 |
| §2.4, §8 | Talking to The Office from chat apps (WhatsApp first) | 43 |
| §6 | Stack-specific checks for installs and publishing | 44 |
| §2.1, §2.3, §4, §5.3, §5.5, §6, §8 | A Project from a git repository (any git URL cloned into the Office data directory; a picker of the user's GitHub repositories; Devops' onboarding by URL); the Office identity, the only credentials The Office's git uses: Sign in with GitHub (a GitHub App registered by its manifest, signed in by its web flow) for every GitHub Project's fetch, push and pull requests, and the Office ssh key for ssh remotes; other hosts over https anonymously | 46 |
| §3 | The tier 3 acceptance run | 45 |
