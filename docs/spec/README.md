# The Office: specification

The Office is an all-day workspace run like an office, for a few users who each sign in. The user hires people for Roles, and their Agents turn Ideas into published changes across the user's Projects while the user plans, steers and decides. It replaces nothing: it is a fresh build, and the Software Factory repository is reference only.

This spec is assembled from the resolved tickets in [.scratch/the-office/issues/](../../.scratch/the-office/issues/), which, with the map, research findings and the click-through, are kept locally and not committed. Each section names the tickets it comes from; when a ticket and this spec seem to disagree, the ticket's Answer (with its amendments) wins and this spec is fixed. Vocabulary is the [glossary](../../GLOSSARY.md); its terms are used exactly, in the UI and in code.

The spec is one file per section, so a session reads only the sections its task names. A section's **Defaults** are gaps no ticket settled, filled with the user's agreement; each section keeps its own.

## Contents

- [1. The user's day](1-the-users-day.md): morning, during the day, while work runs, away from the desk.

### 2. Domain model

- [2.1 Work](2.1-work.md): Project, Idea, Initiative, Task and its states, Attachment.
- [2.2 People](2.2-people.md): Role, Agent, Role card, authority, escalation, presets, duties, the Office Manager, limits.
- [2.3 Pipelines](2.3-pipelines.md): Stage kinds, loops, Gates, built-in Pipelines, Publish, the library.
- [2.4 Conversations](2.4-conversations.md): Threads, Decisions, barge-in, consultation, mentions, chats only read.
- [2.5 Context policy](2.5-context-policy.md): resume, fresh or hand off; the Brief, the Handover note, overrides.
- [2.6 Skills](2.6-skills.md): the library, adding skills, Project skills, what a session gets.
- [2.7 Notifications](2.7-notifications.md): kinds, channels, content, routing defaults.
- [2.8 Fire alarm](2.8-fire-alarm.md): the alarm and the all clear (tier 2).
- [2.9 Sub-agents and processes](2.9-sub-agents-and-processes.md): what a session runs beside its Agent, what each engine reports, how long it is kept, how it streams live, the read-only view.
- [2.10 Users and signing in](2.10-users-and-signing-in.md): users, the ways to sign in, linking, which ways work on which address, signed-in devices, slow-down and lockout, recovery, who did what, per user and shared.

### Tiers and UX

- [3. Capabilities by tier](3-capabilities-by-tier.md): what tier 1, 2 and 3 each hold, and what comes after them.
- [4. UX direction](4-ux-direction.md): the five surfaces, the A3 · Desk shell, the Task page, themes, brand, copy.
- [4.1 UI rules](4.1-ui-rules.md): how every screen is built: `packages/ui` components, windows in three sizes with an action bar, list and details, long text, words.

### 5. Architecture and stack

From [12](../../.scratch/the-office/issues/12-architecture.md) (amended by [13](../../.scratch/the-office/issues/13-first-slice.md)), [02](../../.scratch/the-office/issues/02-agent-engines.md), [03](../../.scratch/the-office/issues/03-factory-reference.md), [22](../../.scratch/the-office/issues/22-skills-per-session.md), [25](../../.scratch/the-office/issues/25-agent-permissions.md).

- [5.1 Shape](5.1-shape.md): one Node service, its addresses and the public address behind a reverse proxy, Windows and Linux, fresh code.
- [5.2 Stack](5.2-stack.md): TypeScript on Node 22, backend, web, data, infrastructure.
- [5.3 Modules](5.3-modules.md): the bounded contexts and how they talk.
- [5.4 The engine](5.4-the-engine.md): the `AgentEngine` port, adapters, native features, cache breakers, pinned versions.
- [5.5 Git and isolation](5.5-git-and-isolation.md): a worktree per Task, guards, environment as data.
- [5.6 Skills per session](5.6-skills-per-session.md): what a session lists at start.

### Safety, building, open questions

- [6. Permissions and safety](6-permissions-and-safety.md): threat model (signing in too), only hashes stored, the two layers, Hard switches, profiles, secrets, build rules.
- [7. Building it](7-building-it.md): who builds it and where, the build order, build tasks.
- [8. Open questions and risks](8-open-questions-and-risks.md).

## Defaults

Where each default lives (the old §9):

- Start in tier 1: [2.1 Work](2.1-work.md#defaults)
- A Task waiting on the user or paused still counts: [2.2 People](2.2-people.md#defaults)
- The Office-wide limit on running Tasks: [2.2 People](2.2-people.md#defaults)
- Preset Task limits: [2.2 People](2.2-people.md#defaults)
- Office kinds in tier 1 have no person: [2.7 Notifications](2.7-notifications.md#defaults)
- Project commands in tier 1: [2.3 Pipelines](2.3-pipelines.md#defaults)
- Skills the user writes or uploads: [2.6 Skills](2.6-skills.md#defaults)
- Thread titles: [2.4 Conversations](2.4-conversations.md#defaults)
- Skills is its own module: [5.3 Modules](5.3-modules.md#defaults)
- The Office's own credentials for publishing: [2.3 Pipelines](2.3-pipelines.md#defaults)
- Publish is a publishing mode, not a Project command: [2.3 Pipelines](2.3-pipelines.md#defaults)
- Holding an enforced Hard switch's call waits for tier 2: [2.2 People](2.2-people.md#defaults)
- Agents wait on the user without blocking a tool call: [2.4 Conversations](2.4-conversations.md#defaults)
- Windows and Linux: [5.1 Shape](5.1-shape.md#defaults)
- Only The Office's own pages reach the service: [5.1 Shape](5.1-shape.md#defaults)
- Updating The Office: [5.1 Shape](5.1-shape.md#defaults)
- Install inputs: [5.5 Git and isolation](5.5-git-and-isolation.md#defaults)
- A skill's new version waits for review too: [2.6 Skills](2.6-skills.md#defaults)
- Editing a skill: [2.6 Skills](2.6-skills.md#defaults)
- A skill's frontmatter is read as the engine reads it: [2.6 Skills](2.6-skills.md#defaults)
- A skill's frontmatter is flagged, not refused: [2.6 Skills](2.6-skills.md#defaults)
- Installing a skill from a source, its pinned version: [2.6 Skills](2.6-skills.md#defaults)
- Skill updates flagged, then proposed; an applied update is its review: [2.6 Skills](2.6-skills.md#defaults)
- A skill drafted as a Proposal: [2.6 Skills](2.6-skills.md#defaults)
- Project skills turn off one by one: [2.6 Skills](2.6-skills.md#defaults)
- The base branch's upstream: [5.5 Git and isolation](5.5-git-and-isolation.md#defaults)
- A person's session default decides only the cold case: [2.5 Context policy](2.5-context-policy.md#defaults)
- The Context policy's size threshold counts what the conversation added: [2.5 Context policy](2.5-context-policy.md#defaults)
- A chat Thread's Brief: [2.5 Context policy](2.5-context-policy.md#defaults)
- A Decision is a card in the asking Agent's Thread: [2.4 Conversations](2.4-conversations.md#defaults)
- Waiting on you while planning: [2.1 Work](2.1-work.md#defaults)
- Plan as a Task with the Planner: [2.1 Work](2.1-work.md#defaults)
- Open in editor: [4. UX direction](4-ux-direction.md#defaults)
- Merge mode when the base moved: [2.3 Pipelines](2.3-pipelines.md#defaults)
- The Changes tab after Publish shows what Publish shipped: [2.3 Pipelines](2.3-pipelines.md#defaults)
- No message from a person in tier 1: [2.7 Notifications](2.7-notifications.md#defaults)
- A failed Task: [2.7 Notifications](2.7-notifications.md#defaults)
- Since you left begins after five idle minutes: [2.7 Notifications](2.7-notifications.md#defaults)
- Window nearly used at 90%: [2.7 Notifications](2.7-notifications.md#defaults)
- Opening what a Notification points to handles it: [2.7 Notifications](2.7-notifications.md#defaults)
- Today's figures: [2.7 Notifications](2.7-notifications.md#defaults)
- Now lives in the Notifications module: [5.3 Modules](5.3-modules.md#defaults)
- Onboarding a Project: [2.1 Work](2.1-work.md#defaults)
- Project commands by Proposal and by hand: [2.3 Pipelines](2.3-pipelines.md#defaults)
- The library editor: [2.3 Pipelines](2.3-pipelines.md#defaults)
- Stage templates in tier 3, copied into a Pipeline or a Task's Stages when added: [2.3 Pipelines](2.3-pipelines.md#defaults)
- The proof-of-concept publish target: [2.3 Pipelines](2.3-pipelines.md#defaults)
- Writing the run environment definition: [5.5 Git and isolation](5.5-git-and-isolation.md#defaults)
- An Initiative's Pipeline: [2.1 Work](2.1-work.md#defaults)
- Publishing Tasks: [2.1 Work](2.1-work.md#defaults)
- Publishing into an Initiative's branch: [2.3 Pipelines](2.3-pipelines.md#defaults)
- A Publishing Task's Publish: [2.3 Pipelines](2.3-pipelines.md#defaults)
- Project Pipelines: [2.3 Pipelines](2.3-pipelines.md#defaults)
- A Broken Project Pipeline: [2.3 Pipelines](2.3-pipelines.md#defaults)
- The Initiative's branch: [5.5 Git and isolation](5.5-git-and-isolation.md#defaults)
- Duties: [2.2 People](2.2-people.md#defaults)
- Who holds a duty: [2.2 People](2.2-people.md#defaults)
- Duties on screen: [2.2 People](2.2-people.md#defaults)
- Setting up an Office with nobody hired: [2.2 People](2.2-people.md#defaults)
- A Stage names a Role or a duty: [2.3 Pipelines](2.3-pipelines.md#defaults)
- The holder of Asked first on failures (formerly "The CTO first on failures"): [2.3 Pipelines](2.3-pipelines.md#defaults)
- The public address: [5.1 Shape](5.1-shape.md#defaults)
- Users is its own module: [5.3 Modules](5.3-modules.md#defaults)
- Password rules, the one-time password, slow-down and lockout, how long a device stays signed in, recovery codes, the authenticator, removing users, records from before users, Since you left per user: [2.10 Users and signing in](2.10-users-and-signing-in.md#defaults)

A new default goes into the Defaults of the section it belongs to, with the date the user accepted it, and gets a line here.
