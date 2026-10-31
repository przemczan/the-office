# 3. Capabilities by tier

From [13](../../.scratch/the-office/issues/13-first-slice.md), with [16](../../.scratch/the-office/issues/16-layout-mockups.md) and [prototypes/feature-ranking.md](../../.scratch/the-office/prototypes/feature-ranking.md).

## Tier 1: the base

**Test:** the user would pick The Office over a regular Claude Code session for one piece of work in one Project, at the desk. Done when a real Task on a real Project is planned in a thread with the Planner, runs a built-in Pipeline, passes a Gate on the Changes tab and publishes, with the Context policy's label and token counts on every Thread. Small on purpose; every later tier builds on it without a rewrite.

| Area | In tier 1 |
|---|---|
| Foundation | One Node service on `localhost`; Postgres in Docker; the AgentEngine port with the Agent SDK adapter; OpenTelemetry traces and metrics with token counts into `otel-lgtm` |
| Projects | Added by hand: path, commands, install inputs, publishing mode, default Pipeline; the environment check in a fresh worktree; the Project's skills listed with their switch |
| Work | Ideas captured and shaped into Tasks; all Task states; Plan; Definition of Done; priority and manual order; the board; Attachments by the user and Agents |
| People | Planner, Developer, Reviewer from presets; the Role card form (capabilities, Task limit, Skills, Hard switches); the People grid and a person's page; chat with the Planner (without memory) |
| Conversations | Task Threads; Decisions with follow-ups; barge-in, Stop, Pause; Office tools for Agents (read records, open a Decision, consult, attach, handover note) |
| Pipelines | All three Stage kinds; Full, Quick fix, Document; on-failure loops and limits; optional Stages; the Planner proposing a Pipeline; "Edit for this Task"; Gates with the Changes tab; publish as push + PR or merge; one Task in progress per Project |
| Context policy | All of [2.5](2.5-context-policy.md) |
| Skills | The library from uploads and skills written in place; review before use; assignment on the Role card; "everyone"; the per-session plugin folder |
| Permissions | All of [6](6-permissions-and-safety.md) except holding an enforced Hard switch's call, which no tier 1 Role needs ([9](README.md#defaults)); every Consult value falls back to the user; the preset profiles, not yet editable |
| Shell | A3 · Desk: rail, top bar with Idea, status strip (needs you, tokens today, 5-hour window); Now; the Needs you panel; the Task page; the chat modal; the theme layers with Light and Dark |
| Notifications | In-app and desktop; the kinds tree in code |

## Tier 2: the all-day workspace

**Test:** the user would run all their Projects' work through The Office all day, from the desk and the phone.

- **Work:** dependencies; Initiatives with the CTO and their Task graph; tags, search, saved views; the Project filter.
- **Parallel work:** several Tasks in progress per Project; a queue for Start; overlaps warned at Start; conflicts resolved at Publish by the Task's Developer.
- **People:** CTO, Devops, Office Manager (Proposals, redirects, capturing Ideas, the status view); hiring from scratch; letting go; Consultants and Consultations; mentions; shared memory with its Memory tab and delete actions; editable permission profiles.
- **Pipelines:** the library editor; Devops owning the library and Project commands by Proposal; the proof-of-concept publish target.
- **Projects:** onboarding through Devops.
- **Skills:** installing from a source; update Proposals.
- **Safety:** the fire alarm.
- **Phone:** HTTPS on the LAN with a local certificate authority, the PIN, the installed app, phone views, phone push.
- **Notifications:** the kinds × channels grid; quiet hours; batching; the at-desk hold.
- **Running:** the `-p` fallback adapter. Start at login is left out for now: the user sets The Office up and starts it by hand on Windows or Linux (the user, 2026-10-30).

## Tier 3: on need

Archive; Attachment versions; Stage templates in the Pipeline library; moving Tasks between Projects; the Graphite and Paper palettes and the densities; skill usage counts; the bundled `otel-lgtm` made optional, and the telemetry sent to the user's own Grafana or OpenTelemetry collector when they choose (the user builds the dashboards); usage estimates; API-based engines, so local LLMs can be connected, built first among the engines; MCP servers for Agents; talking to The Office from chat apps; email and chat-app Notifications; stack-specific checks for installs and publishing.

Decided with the user on 2026-10-31: access away from home and stronger containment are not planned; issue trackers are dropped.

## Later

After tier 3: the Codex engine; webhooks; the phone, tier 2's item postponed by the user (2026-10-31).
