# The Office: specification

The Office is a single-user, all-day workspace run like an office. The user hires people for Roles, and their Agents turn Ideas into published changes across the user's Projects while the user plans, steers and decides. It replaces nothing: it is a fresh build, and the Software Factory repository is reference only.

This spec is assembled from the resolved tickets in [.scratch/the-office/issues/](../.scratch/the-office/issues/), which, with the map, research findings and the click-through, are kept locally and not committed. Each section names the tickets it comes from; when a ticket and this spec seem to disagree, the ticket's Answer (with its amendments) wins and this spec is fixed. Vocabulary is the [glossary](../GLOSSARY.md); its terms are used exactly, in the UI and in code.

Contents: [1 The user's day](#1-the-users-day) · [2 Domain model](#2-domain-model) · [3 Capabilities by tier](#3-capabilities-by-tier) · [4 UX direction](#4-ux-direction) · [5 Architecture and stack](#5-architecture-and-stack) · [6 Permissions and safety](#6-permissions-and-safety) · [7 Building it](#7-building-it) · [8 Open questions and risks](#8-open-questions-and-risks) · [9 Defaults chosen in this spec](#9-defaults-chosen-in-this-spec)

## 1. The user's day

From [11](../.scratch/the-office/issues/11-surfaces.md), [16](../.scratch/the-office/issues/16-layout-mockups.md), [07](../.scratch/the-office/issues/07-work-model.md), [09](../.scratch/the-office/issues/09-conversations.md), [20](../.scratch/the-office/issues/20-notifications.md).

- **Morning.** The user opens The Office on the workstation (later also the phone). **Now** shows what needs them (Decisions, Gates, messages from people), what is running (Task · person · Stage · time in Stage), what happened since they left, and today's tokens with the 5-hour window. They answer what waits, in place.
- **During the day.** A thought becomes an **Idea** in seconds from the top bar. When it is worth doing, they shape it: into a **Task**, planned in a thread with the Planner (Plan, Definition of Done, Pipeline), or into an **Initiative** with the CTO (tier 2). They mark the Task Ready and start it; starting is always the user's call.
- **While work runs.** Agents work the Task's Pipeline. The user can write into any running thread (it lands at the next safe point), Stop or Pause a Task, open a person's chat to talk something through, and mention any Task, Idea or Decision there (tier 2). Agents consult colleagues when their authority says so; the user is asked only when nobody else can or may answer. Gates bring the work back for a look (diff, results, screenshots) before it continues.
- **Away from the desk** (tier 2). Needs you reaches the phone as a push; Decisions, Gates and chats work there.
- **All the time.** Every thread shows how its session was continued and what it cost. Token efficiency is a primary goal: The Office costs more than manual sessions, so it is as smart as it can be about resuming, starting fresh and handing over.

## 2. Domain model

### 2.1 Work

From [07](../.scratch/the-office/issues/07-work-model.md), with [08](../.scratch/the-office/issues/08-pipelines.md) and [19](../.scratch/the-office/issues/19-work-mockup.md).

- **Project:** a repository The Office works on, with its own commands (install, build, lint, test), install inputs, default Pipeline, publishing mode (push + PR, or merge, run by The Office's own code; see [9](#9-defaults-chosen-in-this-spec)), environment and skills setting.
- **Idea:** captured quickly, in a Project or Office-wide. States: new, shaped, dropped. Shaping makes an Initiative or a Task and keeps the Idea as the origin link; its Attachments move with it.
- **Initiative** (tier 2): Office-level, spans Projects; each of its Tasks is in one Project. States: shaping (with the CTO), active, done (all Tasks done), dropped. Order inside it is dependencies plus manual order.
- **Task:** one unit of work in one Project, done when its **Definition of Done** is met: a published change, an Attachment, or both.
  - States: **Backlog → Planning → Ready → In progress → Done**, side states **Waiting on you** and **Paused**, exit **Dropped**. Ready requires a Plan and a Definition of Done, both confirmed by the user, no Pipeline proposal left open and no Decision on the Task left open (the user's answer of 2026-10-26). In progress shows the current Stage.
  - **Plan** (how) and **Definition of Done** (what must be true) are separate first-class parts of the Task, co-written with the Planner in a thread on the Task, confirmed by the user.
  - **Dependencies** (tier 2): on any Task in any Initiative or Project; a blocked Task cannot start.
  - **Organisation:** three priority levels plus manual order per Project (tier 1); tags, full-text search, saved views (tier 2); archive after a while (tier 3).
  - **Moving** between Projects (tier 3) until In progress; the Plan is then marked for the Planner to re-check.
- **Attachment:** a document (Markdown), image or screenshot, file or link, attached by the user or an Agent to an Idea, Initiative or Task; can be a Task's result. Diffs and Stage logs are parts of a Task, not Attachments. Versions are tier 3.

### 2.2 People

From [04](../.scratch/the-office/issues/04-agent-identity.md), [05](../.scratch/the-office/issues/05-roles.md), [06](../.scratch/the-office/issues/06-office-manager.md), [21](../.scratch/the-office/issues/21-role-capabilities.md), [23](../.scratch/the-office/issues/23-skills.md), [25](../.scratch/the-office/issues/25-agent-permissions.md).

- **Role:** a job the user hires for, filled by one named person ("Ada · Developer"). Every person is Office-wide. There are no kinds of person.
- **Agent:** a person at work on one thing (a Task or a conversation). A person can be at work on several things at once. A person's Agent on a Task stays the same person for each of that Role's Stages on it.
- **Role card:** name and title; its responsibilities in one paragraph; the instructions; model, effort and engine; **capabilities** (Shared memory, Chat, Consultant), each switched freely; the permission profile ([6](#6-permissions-and-safety)); authority rules; **Hard switches**; **Task limit** (1–6, or none: the person only talks and no Pipeline may name the Role); **Skills**.
- **Authority** in three tiers written as plain rules in the instructions: decide alone, consult *person* first, ask the user. **Hard switches** (run installs, publish outside the Pipeline, change Roles) are each Allowed, Consult *person*, Ask me or Never ([6](#6-permissions-and-safety)).
- **Escalation:** a Consultant asked to approve answers Allow once, Deny or Pass on, at most two steps up (e.g. Devops → CTO → the user). **A missing person falls back to the user:** whenever an Agent would consult someone not hired, the user is asked.
- **Presets** (hiring starts from a template; the template sets the switches):

  | | Memory | Chat | Consultant | Task limit | Tier |
  |---|---|---|---|---|---|
  | Planner | on (off until tier 2) | on | on | 2 | 1 |
  | Developer | off | off | off | 3 | 1 |
  | Reviewer | off | off | off | 3 | 1 |
  | CTO, Devops | on | on | on | 2 | 2 |
  | Office Manager | on | on | off | none | 2 |

  The CTO owns architecture and shapes Initiatives; Devops onboards and repairs Projects and owns the Pipeline library and Project commands by Proposal; the Planner co-writes Plans; the Reviewer is an optional independent review.
- **Office Manager** (tier 2): the default person to go to. Drafts Roles and Office settings as **Proposals** the user confirms with one click; redirects with a link card and an editable handover note, never relays; captures Ideas; sees all of The Office read-only; never works a Stage. Never alone: Roles, settings, starting, stopping or moving work, publishing, speaking for others.
- **Changing a Role** takes effect at the next session start. **Letting a Role go** (tier 2) pauses its running Tasks behind a Decision and flags Pipelines that name it. **Switching a capability off** keeps its memory or threads, unused and readable; deletion only by explicit, confirmed actions on the Role card (tier 2).
- **Shared memory** (tier 2): one append-only memory per person, read at session start, written as small notes. Its form is an open question ([8](#8-open-questions-and-risks)).
- **Limits:** each person's Task limit, plus one Office-wide limit on running Tasks to protect quota. Talking never counts and is never blocked.

### 2.3 Pipelines

From [08](../.scratch/the-office/issues/08-pipelines.md) (amended by [25](../.scratch/the-office/issues/25-agent-permissions.md)), [19](../.scratch/the-office/issues/19-work-mockup.md), [21](../.scratch/the-office/issues/21-role-capabilities.md).

- **Stage kinds:** **Agent Stage** (a Role does work), **Script Stage** (a Project command, no model call: tests, lint, build, publish; result recorded), **Gate** (the Task waits for the user, showing diff, results, Attachments, screenshots; UI acceptance is a Gate after a Stage that attached screenshots).
- **A Stage declares:** kind; Role or command; a plain-words brief filled with the Plan, Definition of Done and earlier results; limits (rounds, budget); session (fresh by default, or continue the previous Stage's session only when the same Role did it); on failure. It ends **done**, **needs a Decision** (one the Agent opened with an Office tool, open a Decision or consult: the only way an Agent asks, the user's answer of 2026-10-26), or **failed**.
- **Loops, not branches:** a Pipeline is a straight list. The only control flow is "on failure go back to Stage X, at most N times". That covers test-fix rounds, review-fix rounds and repair after a failed Script Stage (a failed publish or test run hands to an Agent Stage with the error).
- **At a Gate** the user continues, drops the Task, or sends the work back with feedback to any earlier Stage but a Gate or a Publish (whose work has already left the workstation), using no round (the user's answer of 2026-10-26). An Agent Stage is briefed with the feedback; a Script Stage can't read it, so it simply runs again and the walk goes on from there, the feedback kept on its run and shown on its row.
- **Built-ins:** **Full** (Implement → Tests → Review & fix → Publish), **Quick fix** (Implement → Tests → Publish), **Document** (Produce → Review & fix). Planning is a Task state, not a Stage. Each Project names a default; the Planner proposes one from the Definition of Done, which the user takes or declines (keeping the Task's Pipeline) before the Task can be Ready; the user can swap it or **edit the Stage list for this Task** (add a Gate, drop or reorder, model and effort, session, budget). Started Stages are locked.
- **Review & fix** is one fresh-session Developer Stage: the Agent reviews against the Definition of Done and fixes what it finds, consulting (the CTO, then the user) only when it can't fix something itself.
- **Publish** is a Script Stage run by The Office: push and open a PR, or merge, per Project. A proof-of-concept publish target (work stays on a branch) is tier 2.
- **Skipping:** an optional Stage is skipped when the Definition of Done is already met; otherwise skipping is the user's click.
- **Who is asked:** budget limits always ask the user. A round limit or a Stage failing with no retries left goes to the CTO first, who may send the Task back for one more round with guidance or pass it on (in tier 1: the user). Hard switches follow their value.
- **Library** (editor tier 2): Pipelines and Stage templates are Office-wide; one Stage editor serves the library and "Edit for this Task". It flags a Role with Task limit none or let go, "continue" without the same Role before, and failure targets that aren't earlier. Saving a library Pipeline changes Tasks that haven't started; running ones keep their copy; a Task edited for itself keeps its Stages.

### 2.4 Conversations

From [09](../.scratch/the-office/issues/09-conversations.md) (amended by [21](../.scratch/the-office/issues/21-role-capabilities.md) and [25](../.scratch/the-office/issues/25-agent-permissions.md)), [04](../.scratch/the-office/issues/04-agent-identity.md), [17](../.scratch/the-office/issues/17-task-page-mockup.md), [18](../.scratch/the-office/issues/18-people-mockup.md).

- **Three homes:** a **person's chat** (for people with Chat on), a **Task's conversation** (planning, each Stage's thread, with their Decisions, and Consultations) and an **Initiative's conversation** (shaping with the CTO).
- **Threads:** each is one engine session underneath. A fresh Thread starts a new session: the record and the person's memory stay, the context goes. Old Threads stay readable and can be continued ([2.5](#25-context-policy) decides resume or brief).
- **Decision:** a question the Agent opens in the Thread it works in on the Task, shown there as a card: question, options, recommendation. The user picks an option, writes a free answer or asks follow-ups in the same Thread, and the answer reaches the asking session as its next message. A redirect reply ("ask the CTO") turns it into a Consultation.
- **Barge-in:** the user writes into a running Stage Thread at any time; it lands at the next safe point (between tool calls). **Stop** interrupts now, discards the Stage's uncommitted edits and holds the Task; **Pause** holds it once the Agent's current turn ends, mid-Stage, keeping the edits (a Project command, such as a Script Stage's, can't be interrupted: Stop waits for it to end and holds the Task as Pause does). Resume runs the held Stage on through the Context policy; the user's messages a stopped session never took go with it, so a message and Stop redirect the Agent (the user's answers of 2026-10-26). Shutting The Office down ends running sessions at once, as Stop does; at the next start a Stage it restarted during, or the Stage it would have started next, never runs by itself: a Decision asks to run (or start) it or drop the Task. A Stage the user had paused stays Paused with its edits, its last turn cut short (the user's answers of 2026-10-26). A Decision the Agent opened before its run was held stays open and the run keeps it: the Task shows Paused and Waiting on you; answering it doesn't resume the Task, and its answer goes with the Stage when the user resumes, which runs only once it is answered (the user's answer of 2026-10-26).
- **Consultation** (tier 2; in tier 1 every consult goes to the user): a sub-thread on the Task between an Agent and a Consultant, labelled with both. It answers a question or approves a held call past a Hard switch. The user can read it live, join or take it over. The Consultant answers in a fresh session with its memory and the Task's brief.
- **Mentions** (tier 2): any Task, Initiative, Idea or Decision can be mentioned in any chat (link or `@`), and the Agent there can read its record.
- **Only work starts a conversation:** an Agent needing the user opens a Decision on the Task; a person outside any Task writes in their own chat. No idle messages, no talk between Agents outside a Consultation.
- **Chats only read** ([6](#6-permissions-and-safety)): changes happen on Tasks.

### 2.5 Context policy

From [10](../.scratch/the-office/issues/10-context-policy.md), with [02](../.scratch/the-office/issues/02-agent-engines.md) and [03](../.scratch/the-office/issues/03-factory-reference.md).

- **Three moves:** **Resume** (same session, cache warm), **Fresh** (new session for the same person, briefed from the record), **Hand off** (another Role gets a brief; any Role change is a hand-off).
- **At a Stage boundary** the Stage's declared session wins. **Inside a Thread**, continuing resumes when the cache is warm (under 1 hour since the last call) or the context is small; when the cache is cold and the context large, The Office starts fresh with a brief. The size threshold starts at 30k tokens and is tuned from telemetry.
- **The Brief** is assembled from the record with no model call: Task title, Plan, Definition of Done, the Stage's brief, earlier Stage results, answered Decisions, the diff summary from git, the Attachment list, and the person's memory when they keep one. Transcripts are never handed over.
- **Handover note:** every Agent Stage ends with a few lines (where I am, what is left, what to watch) inside its result.
- **Shown** on every Thread as a label with what and why ("Continuing · cache warm · 41k context"; "Fresh · cache expired, 48k context · brief ~3k"), with tokens per Thread and per Task. The line of a move that starts a session with a Brief expands to show the Brief as it was sent.
- **Overrides:** a per-Role default, per Stage, and per moment with "Start fresh" and "Continue anyway", each with its estimated cost.
- **No automatic compaction:** near the context limit The Office asks for the handover note, ends the session and starts fresh with a brief.

### 2.6 Skills

From [23](../.scratch/the-office/issues/23-skills.md), [22](../.scratch/the-office/issues/22-skills-per-session.md).

- **The library** is Office-wide (Settings → Skills): one folder with each skill once in its own subfolder; the database holds a record per skill (name, description, source, version, enabled, files hash), the Role → Skill mapping and an "everyone" flag.
- **Adding:** install from a source (tier 2; an install, so Devops does it and the user confirms), upload a `.md` or a zipped folder, or write one in place. Every new skill arrives off; the user reviews its files before turning it on. Pinned versions update by Proposal (tier 2).
- **Project skills** stay in the repository and apply unless the Project page turns them off; listed read-only.
- **A session gets** its Role's skills plus the "everyone" skills plus the Project's when allowed, and nothing else (mechanism in [5.6](#56-skills-per-session)).
- Short descriptions matter: the listing gets about 1% of the context window.

### 2.7 Notifications

From [20](../.scratch/the-office/issues/20-notifications.md) (amended by [13](../.scratch/the-office/issues/13-first-slice.md)).

- **A Notification is a pointer** to something that waits or happened; it opens that thing and is cleared on every channel by handling it. No inbox: Needs you and Since you left serve as one.
- **Kinds are a tree of hierarchical keys** (`needs-you.decision`, later `needs-you.decision.limit-reached`); routing overrides are stored at any level and inherited from the nearest one, so splitting a kind keeps every setting. Groups today: **Needs you** (Decision waiting, Gate waiting, a message to the user), **Outcomes** (Task done, failed or paused; Initiative done), **Office** (5-hour window nearly used or reset; the service or an engine down; the alarm lifted with work waiting). Never notified: Stage progress, Tasks starting, Consultations the user is not in, Agents talking to each other, approvals made by colleagues.
- **Channels** are adapters behind one port: in-app (toast, unread count in tab title and favicon, status strip) and desktop in tier 1; phone push (Web Push over HTTPS on the LAN with a local certificate authority, installed app) in tier 2; email and chat apps in tier 3.
- **Content:** the person's avatar and name, one first-person line, the Task and Project. Office kinds come from the Office Manager and open the Office Manager's chat. No action buttons.
- **Routing defaults** apply from tier 1, without the phone column: Needs you goes in-app and to the desktop; Outcomes go in-app and to the desktop; Office kinds go in-app, and "service or engine down" also to the desktop. A desktop notification appears only when the tab isn't focused; otherwise the in-app toast shows. Needs you is never batched and there are no repeat reminders.
- **The kinds × channels grid, the at-desk hold, quiet hours and batching of Outcomes** are tier 2, as in [20](../.scratch/the-office/issues/20-notifications.md). The Project filter never silences.

### 2.8 Fire alarm

From [15](../.scratch/the-office/issues/15-fire-alarm.md) (tier 2).

- Office-wide only. **Sound the alarm** stops every Stage, waiting Task, Consultation and background work at the next safe point (hard stop after 60 s); running git operations finish; nothing new starts.
- Chats stay open, but no Agent runs tools unless the user lifts that for one Thread.
- **All clear** first lists on Now what will resume, how (warm or fresh with a brief) and at what cost, with Hold and Drop per Task; then everything resumes through the Context policy.

## 3. Capabilities by tier

From [13](../.scratch/the-office/issues/13-first-slice.md), with [16](../.scratch/the-office/issues/16-layout-mockups.md) and [prototypes/feature-ranking.md](../.scratch/the-office/prototypes/feature-ranking.md).

### Tier 1: the base

**Test:** the user would pick The Office over a regular Claude Code session for one piece of work in one Project, at the desk. Done when a real Task on a real Project is planned in a thread with the Planner, runs a built-in Pipeline, passes a Gate on the Changes tab and publishes, with the Context policy's label and token counts on every Thread. Small on purpose; every later tier builds on it without a rewrite.

| Area | In tier 1 |
|---|---|
| Foundation | One Node service on `localhost`; Postgres in Docker; the AgentEngine port with the Agent SDK adapter; OpenTelemetry traces and metrics with token counts into `otel-lgtm` |
| Projects | Added by hand: path, commands, install inputs, publishing mode, default Pipeline; the environment check in a fresh worktree; the Project's skills listed with their switch |
| Work | Ideas captured and shaped into Tasks; all Task states; Plan; Definition of Done; priority and manual order; the board; Attachments by the user and Agents |
| People | Planner, Developer, Reviewer from presets; the Role card form (capabilities, Task limit, Skills, Hard switches); the People grid and a person's page; chat with the Planner (without memory) |
| Conversations | Task Threads; Decisions with follow-ups; barge-in, Stop, Pause; Office tools for Agents (read records, open a Decision, consult, attach, handover note) |
| Pipelines | All three Stage kinds; Full, Quick fix, Document; on-failure loops and limits; optional Stages; the Planner proposing a Pipeline; "Edit for this Task"; Gates with the Changes tab; publish as push + PR or merge; one Task in progress per Project |
| Context policy | All of [2.5](#25-context-policy) |
| Skills | The library from uploads and skills written in place; review before use; assignment on the Role card; "everyone"; the per-session plugin folder |
| Permissions | All of [6](#6-permissions-and-safety) except holding an enforced Hard switch's call, which no tier 1 Role needs ([9](#9-defaults-chosen-in-this-spec)); every Consult value falls back to the user; the preset profiles, not yet editable |
| Shell | A3 · Desk: rail, top bar with Idea, status strip (needs you, tokens today, 5-hour window); Now; the Needs you panel; the Task page; the chat modal; the theme layers with Light and Dark |
| Notifications | In-app and desktop; the kinds tree in code |

### Tier 2: the all-day workspace

**Test:** the user would run all their Projects' work through The Office all day, from the desk and the phone.

- **Work:** dependencies; Initiatives with the CTO and their Task graph; tags, search, saved views; the Project filter.
- **Parallel work:** several Tasks in progress per Project, with conflicts handled (open question).
- **People:** CTO, Devops, Office Manager (Proposals, redirects, capturing Ideas, the status view); hiring from scratch; letting go; Consultants and Consultations; mentions; shared memory with its Memory tab and delete actions; editable permission profiles.
- **Pipelines:** the library editor; Devops owning the library and Project commands by Proposal; the proof-of-concept publish target.
- **Projects:** onboarding through Devops.
- **Skills:** installing from a source; update Proposals.
- **Safety:** the fire alarm.
- **Phone:** HTTPS on the LAN with a local certificate authority, the PIN, the installed app, phone views, phone push.
- **Notifications:** the kinds × channels grid; quiet hours; batching; the at-desk hold.
- **Running:** start at login (a Windows service or scheduled task; a systemd user service on Linux); the `-p` fallback adapter.

### Tier 3: on need

Archive; Attachment versions; moving Tasks between Projects; the Graphite and Paper palettes and the densities; skill usage counts; Grafana dashboards; usage estimates; other engines (Codex, API-based); integrations (webhooks, MCP servers for Agents, issue trackers, chat apps); email and chat-app Notifications; access away from home; stronger containment (WSL2 sandbox or a separate Windows user); stack-specific checks for installs and publishing.

## 4. UX direction

From [11](../.scratch/the-office/issues/11-surfaces.md), [16](../.scratch/the-office/issues/16-layout-mockups.md), [17](../.scratch/the-office/issues/17-task-page-mockup.md), [18](../.scratch/the-office/issues/18-people-mockup.md), [19](../.scratch/the-office/issues/19-work-mockup.md), [01](../.scratch/the-office/issues/01-export-design-system.md).

**The click-through is the UI spec.** [prototypes/app/](../.scratch/the-office/prototypes/app/index.html) is a complete, interactive layout of every surface, accepted in three steps ([17](../.scratch/the-office/issues/17-task-page-mockup.md), [18](../.scratch/the-office/issues/18-people-mockup.md), [19](../.scratch/the-office/issues/19-work-mockup.md)). The real shell is built from it: its structure, flows and copy, re-implemented in React with the design system's components. Where the click-through shows a tier 2 or 3 feature, tier 1 leaves it out rather than stubbing it.

- **Five surfaces:** **Now** (home: Needs you, Running, Since you left, today's tokens; nothing else), **Work** (per Project: Ideas, the Task board by state, Initiatives with their graph), **People** (a grid of same-size cards; a page per person with Overview, Work, Conversations, Role card, Memory; hiring), **Projects** (a page per Project: commands, default Pipeline and publishing, onboarding checks, the repository's skills), **Settings** (Pipelines and the skill library, Office limits, Notifications, Appearance).
- **Shell A3 · Desk** ([prototypes/shell-a3.html](../.scratch/the-office/prototypes/shell-a3.html)): a 56px icon rail with the five surfaces; a top bar with title, search (tier 2), "Idea" and the fire alarm (tier 2); a fixed **status strip** (needs you, desks in use, tokens today, 5-hour window with meter and reset time, Tasks touched, done since you left, alarm state); content as three panels filling the width, folding to two then one; every item a card with air around it; **each block's left edge coloured by its type or status** (a deliberate deviation from the design system).
- **Progressive disclosure by frequency** ([prototypes/feature-ranking.md](../.scratch/the-office/prototypes/feature-ranking.md)): many-times-a-day features on the surface, daily ones one step away, occasional and rare ones folded where they apply.
- **The Task page:** record left (Plan, Definition of Done, Stages, Changes, Attachments), conversation right (Threads, the active Thread, composer, context label). **Changes** is a tab (files, diff, test results); a Gate shows the same inline with its actions.
- **Chats open in a modal** over any page. A **Needs you panel** opens Decisions and Gates anywhere.
- **Every item shows its Project mark and name.** The Project filter (tier 2) narrows every surface, never Office-wide numbers or the rail badge.
- **Colour and themes** ([prototypes/themes.md](../.scratch/the-office/prototypes/themes.md)): muted text, borders and surfaces; status colours, accent, badges and icons at the design system's values; dark mode is dark gray; logos in brand colours. Three layers: design-system tokens untouched; a palette remaps colour aliases only; a density remaps spacing and size aliases only. Components use aliases only. Tier 1 ships Light and Dark.
- **Brand:** the NotNullSoft lockup with a mono product chip reading "The Office" ([design-system/guidelines/brand-admin-lockup.html](../design-system/guidelines/brand-admin-lockup.html)); Ember is the accent. The design system ([design-system/readme.md](../design-system/readme.md)) is a component library plus brand; its admin sidebar layout is not used.
- **Copy:** UI copy follows the design system (sentence case, no "I"/"we", verb + object buttons). Everything an Agent says is content: Agents speak in the first person, and their actions are attributed to the person, never to "System".
- **Phone** (tier 2): Needs you, passing Gates with screenshots, Running, chatting, a Task's summary, the fire alarm; bottom tabs and one column. Boards, graphs, diffs, Projects and Settings are laptop surfaces.
- **Known gap:** the Edit Role and hire form works but needs a proper design in the real build ([18](../.scratch/the-office/issues/18-people-mockup.md)).

## 5. Architecture and stack

From [12](../.scratch/the-office/issues/12-architecture.md) (amended by [13](../.scratch/the-office/issues/13-first-slice.md)), [02](../.scratch/the-office/issues/02-agent-engines.md), [03](../.scratch/the-office/issues/03-factory-reference.md), [22](../.scratch/the-office/issues/22-skills-per-session.md), [25](../.scratch/the-office/issues/25-agent-permissions.md).

### 5.1 Shape

- **One long-running Node service** on the workstation hosts the API, the web UI, the agent supervisor and the database connection. Agents are child processes (the SDK spawns the Claude Code binary per session). No separate runner, no remote protocol; the supervisor sits behind its own boundary so it could become a separate host later. Tier 1 serves `localhost` only; the LAN with a PIN and HTTPS come with the phone in tier 2. Any page the user opens in a browser can still reach `localhost` (browsers apply no cross-origin rule to WebSockets, and DNS rebinding points a site's own name at `127.0.0.1`), so the service refuses every HTTP request and WebSocket whose `Host` is not `localhost` or `127.0.0.1` at its port, or that carries an `Origin` other than The Office's own.
- **Windows and Linux.** The workstation runs either, and every tier is built and checked on both. What differs (the Office data directory, shells and their rules, finding a command that can't run, ending a process tree, path length limits, where secrets live, starting at login) sits behind one platform layer in the service; nothing else branches on the operating system.
- **Fresh code; functionality copied, not code.** What [03](../.scratch/the-office/issues/03-factory-reference.md) marks "keep" is re-implemented from its described behaviour ([research/factory-reference.md](../.scratch/the-office/research/factory-reference.md)): the lean harness with a stable cached prefix, the resume-vs-fresh rule with a standalone brief, the flat Stage result envelope, Office-owned git with a worktree per Task, the environment as data verified in a fresh worktree, loop limits and budgets, telemetry tagged with prompt features, tool output filtering and the flaky-test re-run, the screenshot trust model, the layered settings merge. Dropped: remote runners, leases, the runner protocol, the `/factory` plugin and MCP entry.

### 5.2 Stack

- **TypeScript end to end on Node 22.**
- **Backend:** NestJS (modules, DI, ports as interfaces, adapters as providers); WebSocket push to the browser.
- **Web:** React + Vite, TanStack Query and Router, the design system's components.
- **Data:** PostgreSQL with Drizzle (typed SQL, repositories in the adapter layer); full-text search; JSONB for Stage results and Attachment metadata. Attachments are files in an Office data directory with metadata in Postgres. Engine transcripts stay where the engine keeps them, referenced by session id; The Office's own message log per Thread is what the UI shows.
- **Infrastructure:** one `docker compose` with PostgreSQL and `grafana/otel-lgtm`. The Office exports OpenTelemetry over OTLP: one trace per Task, spans per Stage and per engine call with token counts; metrics for tokens, cost, queue depth and Stage durations; logs.

### 5.3 Modules

Hexagonal + DDD, modules as bounded contexts: **Work**, **People**, **Pipelines** (definitions and the Stage interpreter: an interpreter of Pipeline data, never a class with a method per Stage), **Conversations**, **Projects** (git, worktrees, environment, commands), **Engine**, **Skills**, **Notifications**, **Telemetry**.

- Each is layered inside: domain (entities, rules, events), application (use cases), ports, adapters (Postgres, engine, filesystem, HTTP, WebSocket).
- Modules talk through application services and domain events only; no module reads another's tables.
- Every state change emits a domain event, consumed alike by the WebSocket push, Now, telemetry, Notifications and (tier 2) the Office Manager's read-only view.

### 5.4 The engine

- **An `AgentEngine` port, not Claude-shaped:** start a session with a brief, send a message with priority, interrupt, resume, read usage, the tool-permission hook; each adapter declares which capabilities it has and The Office degrades where one is missing. A Role picks its engine and model.
- **Adapters:** the TypeScript Claude Agent SDK on the user's own login (tier 1); `claude -p` as fallback (tier 2); others later. One long-lived streaming `query()` per session.
- **Native features used:** message `priority` for barge-in (`next` between tool calls, `later` after the turn); `interrupt()` for Stop, the only way to stop a running command (`now` is not used: it ends the turn but leaves a running command to finish or run on in the background); resume by session id; the 1-hour prompt cache on the main conversation; in-process Office tools via `createSdkMcpServer()`; `rate_limit_event` and the experimental usage query for the 5-hour and 7-day windows (never the CLI's OAuth token).
- **Engine features turned off:** claude.ai connectors (`disableClaudeAiConnectors`); the engine's built-in plugins (each set false in `enabledPlugins`); auto-memory (`autoMemoryEnabled` and `autoDreamEnabled` false), whose folder outside the worktree is shared by every worktree of a repository and written without a prompt. Memory is The Office's own (Shared memory, tier 2). The built-in tool set is an explicit `tools` list, the same on both platforms (the engine's Windows default today, PowerShell on Windows only), since the engine's Linux default drops Grep and Glob for shell search; trimming it per Role is open, with its cost measured in [engine-check.md](engine-check.md).
- **Cache breakers to avoid mid-session:** changing model, effort, MCP servers (with tool search off) or the Claude Code version.
- **Versions are pinned** (the SDK bundles the binary) and bumped deliberately, re-checking what was read from the binary ([5.6](#56-skills-per-session), [6](#6-permissions-and-safety)) with the engine check ([engine-check.md](engine-check.md)).

### 5.5 Git and isolation

- **A worktree per Task** at a stable path under the Office data directory; The Office owns every git change: branch and worktree creation, a commit per Stage (message from the Stage result and handover note), worktree restore after each test run, discarding an interrupted Stage's uncommitted edits, push and PR or merge at Publish.
- **Guards:** a git-mutation deny list for Agents plus a HEAD and branch check after every Stage, since command patterns can be bypassed.
- **Environment as data:** the Project's environment (`set`, `unset`, `prependPath`) is stored outside the checkout and applied to every command and Agent; the environment check runs in a fresh worktree of the base branch before it is saved.

### 5.6 Skills per session

From [22](../.scratch/the-office/issues/22-skills-per-session.md); details and the "Could not confirm" list in [research/skills-per-session.md](../.scratch/the-office/research/skills-per-session.md).

- No engine option names skill folders, so the Skills module writes `<office-data>/sessions/<session-id>/skills/` outside the worktree and the library, and the session's owner hands the folder, the allowlist and the overrides to the Engine, whose adapter checks them at start: `.claude-plugin/plugin.json` (`{"name":"office"}`) and a copy of each skill at its pinned version, regular files only (links and junctions refused). Removed once the session can't be resumed; rebuilt from recorded versions on resume, never with a changed set (the engine announces only added skills on resume, so a removed one would stay named in the conversation).
- SDK options: `settingSources: ['project']`; the folder in `plugins`; `skills` listing `office:<name>` for each skill plus the Project's skill names when allowed. Settings: `syncClaudeAiSkills` and `syncClaudeAiPlugins` false, `disableBundledSkills` true, `disableSkillShellExecution` true (a skill's text runs no command when it loads; the Agent runs it, through the hook), `skillOverrides: "off"` per Project skill and command when the Project turns them off (each keyed as the allowlist matches it: a skill by its folder name, whatever its frontmatter calls it, at any depth; a command by its path under `commands/` with `:` between folders), and the folder in `permissions.additionalDirectories`, which lets the file tools read it under the read fence ([6](#6-permissions-and-safety)). A `Read` allow rule does not lift the fence, and the `additionalDirectories` option would also load the folder's `.claude` as a project source.
- The allowlist only filters the context and matches names by suffix; check allowed Project names against the session's other skill names.
- **What a session must list at start** is its library skills and, when allowed, the Project's skills and commands at the repository's top, by the names the listing gives them (a skill's frontmatter name); nested ones are listed only once a file below them is read.
- **At start:** before the first message, `reloadPlugins` (holding on any cache impact) lists the plugin with no errors and the skill names in `getContextUsage()` equal the expected set, or the session doesn't start; the engine sends `init` only with the first message, and an `init` that disagrees ends the session.
- A per-session `CLAUDE_CONFIG_DIR` is ruled out (credentials and transcripts move with it).

## 6. Permissions and safety

From [25](../.scratch/the-office/issues/25-agent-permissions.md), amending [05](../.scratch/the-office/issues/05-roles.md), [08](../.scratch/the-office/issues/08-pipelines.md), [09](../.scratch/the-office/issues/09-conversations.md).

- **Threat model:** the rules guard against an Agent's mistakes and keep the user in charge of what leaves the workstation; they do not contain a hostile Agent. Native Windows has no command sandbox, and Linux runs under the same rules so both behave alike; stronger containment (the engine's sandbox on Linux and WSL2, or a separate user) is tier 3.
- **Two layers:**
  - **Office rules in code,** which no profile loosens: Agents never change git (read-only `status`, `diff`, `log`, `show` only, every Stage); the HEAD and branch check; worktree restore after tests; the enforced Hard switches; the secrets refusal; one `PreToolUse` hook that sees every call the engine's own input validation lets through, before any rule decides. The Office sets no path-scoped deny rule, which would refuse before the hook; validation refusals show only in `result.permission_denials` and are logged from there.
  - **A permission profile as data on the Role card:** read, edit, run, web. A Stage may narrow it, never widen it. Editable in tier 2.
- **Hard switches:**

  | | Run installs | Publish outside the Pipeline | Change Roles |
  |---|---|---|---|
  | Developer | Consult Devops | Consult CTO | Never |
  | Reviewer, Planner | Consult Devops | Never | Never |
  | Devops | Allowed | Consult CTO | Never |
  | CTO | Consult Devops | Ask me | Never |
  | Office Manager | Never | Never | Ask me |

  - **Enforced by The Office:** change Roles (an Office tool) and git. **Followed by the Agent:** run installs and publish outside the Pipeline. The Office stays agnostic of each Project's stack, so the brief states them in plain words ("Before you install anything that changes the machine outside the worktree, consult Devops; adding or updating the Project's own dependencies is a code change") and the Agent asks through the consult tool first. The Role card marks which are enforced and which are followed.
  - A held call waits on a Consultation (Consult *person*) or a Decision (Ask me). Approvals by colleagues show on the Task, in the Stage log and as one line in Since you left; never a Notification. A Decision never grants "always"; widening permissions is a Role card change.
- **Other refusals** are immediate, with a reason the Agent reads ("Not allowed for a Reviewer: editing files. Open a Decision if you need it."), logged on the Thread.
- **Default profiles:**

  | | Read | Edit | Run commands | Web |
  |---|---|---|---|---|
  | Planner (planning on a Task, chat) | The worktree; the base branches in chat | No | Read-only git | Search and fetch |
  | Developer (Implement, Review & fix) | The worktree | The worktree | Anything in the worktree except git changes; installs and publishing follow the switches | Search and fetch |
  | Reviewer (optional independent review) | The worktree | No | The Project's own commands and read-only git | Search and fetch |

  Everyone also reads their session's skills folder and the engine's output of their own background commands, and uses the Office tools.
- **Chats only read:** a chat session reads every Project's base branch, searches the web and uses the Office tools (read records, capture an Idea, open a Task); no edits, read-only commands only.
- **Secrets:** the hook refuses reads, by file tools or in command text, of `~/.ssh`, the Claude credentials in `~/.claude`, `~/.config/gh`, `~/.aws`, browser profiles (where each lives on Windows and on Linux is the platform layer's), and The Office's own data and database credentials. A `.env` inside the worktree stays readable.
- **Build rules:**
  - Runtime decisions (holding, refusing with a reason) are made in hooks: `permissionPrompts: 'none'` skips `canUseTool`, and refuses whatever would prompt, so the Office tools are allowed by rule.
  - Path decisions (secrets, protected paths, what lies outside the worktree) are made in the hook, never in path-scoped deny rules.
  - Refusals are logged from the hook's own decisions, `permission_denied` messages and `result.permission_denials`; the `PermissionDenied` hook is not relied on, since it fires for none of them.
  - Every shell rule has a PowerShell twin on Windows: a Bash rule does not reach the PowerShell tool (with the engine's default tool set a Bash deny rule alone would turn PowerShell off instead). On Linux the Bash rules apply alone.
  - `permissions.blockReadsOutsideWorkingDirectories` is on and fences Read, Grep and Glob to the worktree and the session's skills folder; the hook's read fence also lets a session read the engine's output files of its own background commands (the engine's temporary folder, then the working folder's name, the session id and `tasks`), which the engine's fence lets through already. Shell reads outside work only for profiles that allow commands (without an allow rule the command would prompt, and is refused); where they work, they are accepted under the threat model.
  - The Office ends a session's leftover processes (dev servers, watchers) when its Stage ends.
  - `.git`, `.claude` and `.mcp.json` are protected paths: the hook refuses Agents' writes there first, with a clear reason; the engine's own protection (it never auto-approves them, and its refusal reads like any other prompt refusal) stays as a backstop. The Office's own writes there go through Office code, not Agents.

## 7. Building it

From [13](../.scratch/the-office/issues/13-first-slice.md).

- **Who and where:** the user builds The Office in Claude Code sessions, in this repository, `D:\Projects\the-office` (`origin` `git@github.com:przemczan/the-office.git`). The spec, the glossary and the design system are committed; the plan (map, tickets, research findings, the click-through) lives in `.scratch/the-office/`, git-ignored. The Software Factory repository (`D:\Projects\software-factory`) stays untouched as reference; code paths cited in the research findings refer to it. Nothing is pushed until the user says so.
- **Surface by surface,** each built complete (real UI from the click-through, its modules, real Agents) and done when it works on a real Project. Order for tier 1:
  1. **Spike:** run the [22](../.scratch/the-office/issues/22-skills-per-session.md) "Could not confirm" checks and the permission build rules of [6](#6-permissions-and-safety) against a live session on the pinned versions.
  2. **Projects:** add a Project, commands, the environment check; builds the service foundation, the database, git and worktrees.
  3. **People:** Role cards from presets, skills, chat with the Planner; proves the engine, the per-session skills, permissions and the Context policy.
  4. **Work and the Task page:** Ideas, Tasks, planning in a Thread, the Pipeline run, Gates, publishing.
  5. **Now:** Needs you, Running, Since you left, the status strip, Notifications.
  6. **Settings:** limits and appearance.
- **Build tasks** are files in the new repo, `docs/tasks/NN-slug.md`: Goal and Definition of Done (with how to check it), Read first, Steps (each small, ending in a commit), Progress (the log a session updates as it goes, which replaces a handover). Each fits a few sessions. The repo's CLAUDE.md tells every session to resume from the task's Progress and first unchecked step, and to tick and log before each commit. Tier 1 is sliced by [24](../.scratch/the-office/issues/24-slice-tier-1.md) into [docs/tasks/](tasks/README.md), with the build defaults it chose and a coverage table; later tiers when they are reached.

## 8. Open questions and risks

### Open questions, by the tier that needs them

None blocks tier 1. Each becomes a ticket when its tier starts.

- **Tier 2:** the form of shared memory and how the user reads and edits it; onboarding a Project through Devops; conflicts between parallel Tasks in one Project (overlap, merge order, rebase; Software Factory's Resolve agent never met a real conflict); a queue for Start; whether Tasks of an Initiative still being shaped can be planned and started; whether direct edits of Project commands stay once Devops proposes them; whether the Office Manager can be let go; folding a Proposal's Role card in chat.
- **Tier 3:** quota and usage estimates; integrations; reaching The Office away from home (a push arrives anywhere but opens only on the LAN).

### Risks

- **Subscription terms** for programmatic use are being revised; a 24/7 multi-agent office is a gray zone under "ordinary, individual usage". Mitigation: the engine boundary, pinned versions, the `-p` fallback in tier 2 ([02](../.scratch/the-office/issues/02-agent-engines.md)).
- **Undocumented internals:** the skills allowlist's suffix matching and plugin detection were read from the binary, and the permission behaviour comes from docs fetched as summaries. Re-check on every version bump; the spike checks them first.
- **No sandbox** (none on native Windows, none used on Linux until tier 3): an Agent's shell can read and write outside the worktree; installs and outside publishing rest on Agents following rules. Backstops: per-Stage commits, the HEAD check, the Office tools.
- **Quota:** parallel sessions spend quota about N times as fast, and plan windows are account-wide, so per-session quota is only an estimate.
- **The PowerShell tool is a preview** with its own rule quirks.
- **Cache:** a Decision answered after more than an hour resumes on a cold cache; the label shows it, and the Context policy may start fresh.

## 9. Defaults chosen in this spec

Gaps no ticket settled, filled with the simplest choice consistent with the tickets; accepted by the user on 2026-10-24.

- **Start in tier 1** is refused with the reason when the Project already has a Task in progress, the person is at their Task limit or the Office-wide limit is reached (as the click-through does); no queue.
- **A Task waiting on the user or paused still counts** against its person's Task limit and the Office-wide limit, since it keeps its worktree and session.
- **The Office-wide limit on running Tasks** defaults to 3; the status strip's "desks in use" is the running Tasks against this limit.
- **Preset Task limits** are single numbers within [21](../.scratch/the-office/issues/21-role-capabilities.md)'s ranges: Planner 2, Developer 3, Reviewer 3, CTO 2, Devops 2.
- **Office kinds in tier 1 have no person:** until the Office Manager is hired (tier 2), they show in the status strip and as in-app toasts in the UI's own voice (sentence case, no "I"), and "service or engine down" also goes to the desktop. They never appear as a message from a person, and never as "System".
- **Project commands in tier 1** are edited directly on the Project page; Devops' Proposals join them in tier 2 ([08](../.scratch/the-office/issues/08-pipelines.md) allows both).
- **Skills the user writes or uploads** also arrive off and are turned on after review, as [23](../.scratch/the-office/issues/23-skills.md) says for every new skill; for one's own text the review is one click.
- **Thread titles** come from the first message and can be renamed (tier 1). A Thread The Office opens, which has no message of the user's first, is titled by The Office and shown with the person, as "Planning · Jan" (agreed with the user on 2026-10-25).
- **Skills is its own module,** next to People and Engine, since it owns the library, versions and assignment, and builds each session's folder from them; the Engine takes the folder and the options from the session's owner and never reads Skills (agreed with the user on 2026-10-25) ([12](../.scratch/the-office/issues/12-architecture.md) predates [23](../.scratch/the-office/issues/23-skills.md)).
- **The Office's own credentials for publishing** (git push, `gh`) are the user's, used by Office code only; Agents never see them.

Added while slicing tier 1 ([24](../.scratch/the-office/issues/24-slice-tier-1.md)), accepted by the user on 2026-10-24:

- **Publish is a publishing mode, not a Project command:** push + PR, or merge, run by The Office's own git code, which is what keeps the credentials out of Agents' reach. The click-through's "Publish" command row becomes the publishing mode.
- **Holding an enforced Hard switch's call waits for tier 2:** in tier 1 no Role holds "change Roles" and git is always enforced, so no call is ever held. Agents ask through the consult tool for the followed switches.
- **Agents wait on the user without blocking a tool call:** "open a Decision" and consult return at once and the Agent ends its turn; the answer arrives as the session's next message, continued through the Context policy.
- **Windows and Linux** are both supported from tier 1 ([5.1](#51-shape)).

Added while building tier 1, accepted by the user on 2026-10-25:

- **Only The Office's own pages reach the service:** the `Host` and `Origin` checks of [5.1](#51-shape), for HTTP and WebSocket alike. A request with no `Origin` (a local tool such as `curl`) passes the `Origin` check; the threat model leaves local processes out.
- **Install inputs:** a Project lists the files whose change makes a worktree install again (a lockfile, say), given when it is added and edited on its page beside the install command. A worktree installs when it is created and again when the install command or one of those files changes; with none listed, once.
- **A skill's new version waits for review too:** a saved change that changes its files turns it back to off, waiting for review, as a new skill arrives; turning it on again is one click. Running sessions keep the version they started with.
- **Editing a skill** is in its Review: Edit for a written skill (the Write form, filled in), Upload a new version for an uploaded one.
- **A skill's frontmatter is read as the engine reads it:** a plain value holding `: `, which YAML refuses, is the text after the first `: `; only what the engine can't read either is refused.
- **A skill's frontmatter is flagged, not refused:** Review warns of each key that changes a session (its own hooks, model or effort, tool rules, a subagent, `when_to_use`, `disable-model-invocation`), as it does of scripts.
- **Change Roles stays Never in tier 1:** the Role card shows it, marked enforced by The Office, and refuses any other value with the reason, since holding an enforced call waits for tier 2. The followed switches take all four values.
- **The base branch's upstream** is where the freshly fetched base comes from: worktrees start at the remote branch it tracks, fetched first. A base branch that tracks nothing is used as it is, unfetched, and the environment check says so.
- **A person's session default decides only the cold case** ([2.5](#25-context-policy)): within an hour of a Thread's last call it continues, the cache being warm. Once cold, Context policy starts fresh above the threshold and continues below it, Always start fresh starts fresh, and Prefer to continue continues. "Start fresh" and "Continue anyway" override it for the moment; a change of person is always a hand-off. Every layer names it the session default.
- **The Context policy's size threshold counts what the conversation added** ([2.5](#25-context-policy)) since the session's first turn: its context then (the engine's own prompt and tools, some 28–33k measured in task 09, the Brief and the first exchange) is what a fresh session takes too. 30k of that to start.
- **A chat Thread's Brief** ([2.5](#25-context-policy)), when it continues fresh: the Thread's title, the person's latest Handover note if one was written (The Office asks for one only near the context limit), and the last exchanges of The Office's log (the user's messages and the person's, not tool activity), newest kept, capped at about 3k tokens. The person's Role card and where the Projects are come with every session.
- **A Decision is a card in the asking Agent's Thread,** not a Thread of its own ([2.4](#24-conversations)): a Thread is one engine session, and the answer goes into the asking session, as the click-through shows it.
- **Waiting on you while planning:** a Task in Planning with an open Decision stays in Planning and shows a Waiting on you badge; the Waiting on you state stays a side state of In progress.
- **Plan as a Task with the Planner** on an Idea shapes it into a Task and opens its planning at once, as the click-through does.
- **Open in editor** (the user's answer of 2026-10-26): the Changes block's "Open in editor" opens the Task's worktree folder in VS Code through a `vscode://file/<worktree path>` link, and each file in the list links to that file the same way. Both show only while the Task has its worktree, so not before it is made or after Publish removes it. The Office launches no editor itself.
- **Merge mode when the base moved** (the user's answer of 2026-10-26): Publish fetches the base branch first. When the base moved on since the Task's branch left it, The Office rebases the branch onto the fetched base itself, under the repository's lock, and then fast-forwards the remote's base branch to it. Only a rebase that would conflict asks the user. Push + PR pushes the branch as it is and opens the pull request; there too, a branch that would conflict with the base asks the user.
- **The Changes tab after Publish shows what Publish shipped** (the user's answer of 2026-10-26): Publish records where the published branch forked from the base in a ref of The Office's own (`refs/office/published-from/<task>`). From then on Changes diffs the Task's branch from that commit, so it still shows the change after a merge, or after its pull request merges upstream.
