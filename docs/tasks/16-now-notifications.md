# 16 · Now, the status strip and Notifications

Status: in progress

## Goal

Now is the home the user opens first: what needs them, what is running, what happened since they left, and today's tokens, each answerable in place. The status strip fills in with live figures, the Needs you panel opens Decisions and Gates from any page, and the Notifications module sends in-app and desktop Notifications from the kinds tree, cleared by handling what they point to.

## Definition of Done

- [ ] Now shows Needs you (Decisions, Gates, messages from people), Running (Task · person · Stage · time in Stage), Since you left (Tasks done, failed or paused since the user was last active) and today's tokens, and nothing else; a Decision or Gate is answered in place. Check: Playwright with a waiting Decision, a running Task and a finished one.
- [ ] The status strip shows needs you, desks in use (running Tasks against the Office-wide limit), tokens today, the 5-hour window with its meter and reset time from the window state of task 06, Tasks touched and done since you left, live. Check: watch it through a run.
- [ ] The Needs you panel opens from the strip on any page and answers Decisions and Gates there. Check: answer one from the Projects page.
- [ ] The kinds tree is in code (`needs-you.decision`, `needs-you.gate`, `needs-you.message`, `outcomes.task-done`, `outcomes.task-failed`, `outcomes.task-paused`, `office.window-nearly-used`, `office.window-reset`, `office.service-down`, `office.engine-down`) with routing resolved from the nearest level, and the defaults of [spec 2.7](../spec/2.7-notifications.md). Check: unit tests of the resolution, including a kind split below a level that has an override.
- [ ] In-app: a toast, the unread count in the tab title and favicon, the strip. Desktop: the browser's notification, only while the tab isn't focused (otherwise the toast). Each opens what it points to, and handling that item clears it on every channel. Check: Playwright with the tab focused and blurred.
- [ ] Content is the person's avatar and name, one first-person line, the Task and the Project, with no action buttons; Office kinds speak in the UI's own voice with no person, and "service down" is raised by the web app itself when it loses the service. Check: one of each kind, and stop the service.

## Read first

- [Spec 1](../spec/1-the-users-day.md) (what Now is for).

Leave out: the kinds × channels grid, quiet hours, batching, the at-desk hold, phone push, the alarm state and the all clear, the Office Manager as the voice of Office kinds, and the Project filter.

## Steps

- [x] 1. A read model for Now and the strip, built from domain events (Needs you, Running, Since you left from the user's last activity, tokens today, desks in use, the window state), pushed over WebSocket. Commit.
  Read: [spec 4](../spec/4-ux-direction.md) (Now, the status strip), [spec 2.2 Defaults](../spec/2.2-people.md#defaults) (desks in use); the Domain events of the [Work](../../apps/service/src/modules/work/MAP.md), [Pipelines](../../apps/service/src/modules/pipelines/MAP.md), [Conversations](../../apps/service/src/modules/conversations/MAP.md) and [Engine](../../apps/service/src/modules/engine/MAP.md) maps (`UsageWindowsChanged`); the [platform map](../../apps/service/src/platform/MAP.md) (the WebSocket push). A new module: the [module template](../../apps/service/docs/module-template.md).
- [ ] 2. Now in `apps/web` with in-place answers, and the status strip's figures. Commit.
  Read: [app/now.js](../../.scratch/the-office/prototypes/app/now.js), the [Now surface map](../../apps/web/src/surfaces/now/MAP.md), the [web app map](../../apps/web/src/MAP.md) (`shell/status-strip.tsx`); answering in place reuses the Decision card (`shell/conversation/decision-card.tsx`) and the [Work surface](../../apps/web/src/surfaces/work/MAP.md)'s `GateBlock`.
- [ ] 3. The Needs you panel. Commit.
  Read: the Needs you panel in [app/core.js](../../.scratch/the-office/prototypes/app/core.js), by range; the [web app map](../../apps/web/src/MAP.md).
- [ ] 4. Notifications module: the kinds tree, routing with inheritance, the channels port, Notifications as pointers cleared when their item is handled. Choose "window nearly used" at 90% and tell the user it is a default. Commit.
  Read: [spec 2.7](../spec/2.7-notifications.md) with its Defaults; the [module template](../../apps/service/docs/module-template.md).
- [ ] 5. Channel adapters: in-app (toast, title, favicon, strip) and desktop (the browser Notification API, permission asked once, only when the tab isn't focused), and the web app's own "service down". Commit.
  Read: [spec 2.7](../spec/2.7-notifications.md) (channels, content); the [web app map](../../apps/web/src/MAP.md) (`shell/toasts.tsx`, `api/event-stream.ts`).
- [ ] 6. Check on the Test Project: a day's loop of planning, a Decision, a Gate and a finished Task, seen from Now and as Notifications; log what arrived where. Commit.
  Read: [test-project.md](test-project.md), [testing](../../apps/service/docs/testing.md).

## State

- Step 1 built `apps/service/src/modules/notifications/` (see its MAP): `NowService` is Now and the strip as one read model, answered by `GET /api/now` and pushed whole as `now.changed` (contract in `packages/contracts/src/notifications.ts`). `POST /api/activity` records the user active; the web does not call it yet.
- It reads Work (`TaskService.list`/`listStarted`, new `OfficeLimits`), Conversations (`DecisionService.listOpen`), Pipelines (`TaskStagesService.progress`) and the Engine (`UsageWindowState`) through ports bound in `app.module.ts`. It keeps outcomes, the user's activity, tokens by day and Tasks touched in its own tables (migration 0029).
- Decided with the user on 2026-10-27, now spec 2.7 and 5.3 Defaults: Now lives in Notifications; no message from a person in tier 1 (the kind exists, nothing sends one); failed means `NoRetriesLeft` or `DefinitionOfDoneNotMet`; Since you left begins after 5 idle minutes; today is local midnight, all four token kinds, Tasks touched = a Stage run today. Step 4 sets "window nearly used" at 90%.
- Running and desks in use cover every started state (In progress, Waiting on you, Paused), as Start counts them.
- Next, step 2: `api/notifications.ts` (a `now` query, and `now.changed` as an `EventCacheUpdates` entry), the Now page, the strip's figures, and the web reporting activity (throttled, while the tab is visible and used). Trap: `GateBlock` and `gate-words` are in `surfaces/work/`; check `tools/lint-rules/src/web-layers.ts` before Now uses them, and move them to `shell/` if a surface may not import another.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next. The detail goes in the commit body. -->

- 2026-10-27 · step 1: the Notifications module with Now's read model (GET /now, POST /activity, `now.changed`), its tables and the user's answers as spec Defaults; next, Now and the strip in the web.
