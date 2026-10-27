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
- [x] 2. Now in `apps/web` with in-place answers, and the status strip's figures. Commit.
  Read: [app/now.js](../../.scratch/the-office/prototypes/app/now.js), the [Now surface map](../../apps/web/src/surfaces/now/MAP.md), the [web app map](../../apps/web/src/MAP.md) (`shell/status-strip.tsx`); answering in place reuses the Decision card (`shell/conversation/decision-card.tsx`) and the [Work surface](../../apps/web/src/surfaces/work/MAP.md)'s `GateBlock`.
- [x] 3. The Needs you panel. Commit.
  Read: the Needs you panel in [app/core.js](../../.scratch/the-office/prototypes/app/core.js), by range; the [web app map](../../apps/web/src/MAP.md).
- [x] 4. Notifications module: the kinds tree, routing with inheritance, the channels port, Notifications as pointers cleared when their item is handled. Choose "window nearly used" at 90% and tell the user it is a default. Commit.
  Read: [spec 2.7](../spec/2.7-notifications.md) with its Defaults; the [module template](../../apps/service/docs/module-template.md).
- [x] 5. Channel adapters: in-app (toast, title, favicon, strip) and desktop (the browser Notification API, permission asked once, only when the tab isn't focused), and the web app's own "service down". Commit.
  Read: [spec 2.7](../spec/2.7-notifications.md) (channels, content); the [web app map](../../apps/web/src/MAP.md) (`shell/toasts.tsx`, `api/event-stream.ts`).
- [ ] 6. Check on the Test Project: a day's loop of planning, a Decision, a Gate and a finished Task, seen from Now and as Notifications; log what arrived where. Commit.
  Read: [test-project.md](test-project.md), [testing](../../apps/service/docs/testing.md).

## State

- Service (step 1): `apps/service/src/modules/notifications/` (see its MAP). `NowService` is Now and the strip as one read model: `GET /api/now`, pushed whole as `now.changed` (contract `packages/contracts/src/notifications.ts`); `POST /api/activity` records the user active. Ports bound in `app.module.ts` read Work, Conversations, Pipelines and the Engine; own tables keep outcomes, activity, tokens by day and Tasks touched.
- Web (step 2): `api/notifications.ts` (`nowQueries.now`, `now.changed` as an `EventCacheUpdates` entry, `reportActivity`); `shell/user-activity.ts` reports activity once a minute at most while the tab is visible and used. Now (`surfaces/now/now-page.tsx`) and the strip (`shell/status-strip.tsx`) read the one `now` query. Needs you's items are `shell/notifications/needs-you-feed.tsx` (the Decision card and the Gate's actions, answered in place), ready for the panel.
- The Gate's actions moved to `shell/work/gate-actions.tsx` (with `gate-words.ts` and `drop-task-dialog.tsx`), since a surface may not import another; Work's `GateBlock` uses them. Needs you shows a compact Gate card (name, next Stage, Open Changes, the actions), as the click-through does, not the whole block.
- Decided with the user on 2026-10-27 (spec 2.7 and 5.3 Defaults): Now lives in Notifications; no message from a person in tier 1; failed = `NoRetriesLeft` or `DefinitionOfDoneNotMet`; Since you left after 5 idle minutes; today from local midnight, all four token kinds, Tasks touched = a Stage run today. Step 4 sets "window nearly used" at 90%.
- Checks so far: `people.e2e.ts` answers the Developer's Decision on Now, sees the Task in Running, the Gate on Now and as a toast with the tab focused and on the desktop with it blurred (a recording stand-in for the browser's Notification), continues it from the Needs you panel over the Projects page (clearing the desktop one), opens the Task from the Done toast, which lowers the title's count, and sees it in Since you left; the strip in `shell.e2e.ts`.
- The Needs you panel (step 3) is the design system's Drawer over any page (`shell/notifications/needs-you-panel.tsx`), opened by the strip's "need you" button and kept in the address as `?needsYou=true` (`OverPageSearch` in `router.tsx`), as a chat is; it holds the same `NeedsYouFeed`. The click-through has no panel of its own, so it follows the Drawer.
- Notifications (step 4): `NotificationService` raises one per thing that waits or happened (not twice for the same pointer), with the person's Role key (none for The Office), one line and its channels from `channelsOf` (`domain/notification-kinds.ts`, defaults of spec 2.7), keeps them in `notifications` (migration 0030) and clears them as their item is handled (spec 2.7 Defaults). `GET /api/notifications` lists the open ones; `notification.raised` and `notifications.cleared` reach the web. `POST /api/activity` now takes the page (`{ page: { kind: "now" | "task" | "elsewhere" } }`); the shell's activity hook sends it, at once on each new page (`shell/user-activity.ts`).
- The channels port: both tier 1 channels live in the browser, so the service routes and the web's adapters (step 5) show; a service-side port comes with phone push (tier 2). "Window nearly used" is 90%, a default to tell the user.
- Channels (step 5): `shell/notifications/notification-channel.ts` is the port; `in-app-channel.tsx` (a notice in `ToastProvider`: the person with their avatar, the line and the Task · Project, which open what it points to) and `desktop-channel.ts` (the browser's Notification, only while the tab isn't focused and the user allowed it; the strip offers "Turn on desktop notifications" until they answer) are its adapters. `notification-channels.ts` brings each raised Notification to one of them, clears it from both, counts the open ones in the title and favicon (`unread-badge.ts`), and raises "service down" itself while the event stream reconnects. The strip shows open Office Notifications.
- `npx playwright test` serves the last build: run `npm run test:e2e`, which builds first.
- Next, step 6: the check on the Test Project (a day's loop seen from Now and as Notifications, logging what arrived where), including stopping the service for "service down" and one of each kind.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next. The detail goes in the commit body. -->

- 2026-10-27 · step 1: the Notifications module with Now's read model (GET /now, POST /activity, `now.changed`), its tables and the user's answers as spec Defaults; next, Now and the strip in the web.
- 2026-10-27 · step 2: Now and the strip in the web from the `now` query, answering Decisions and Gates in place, activity reported; the Gate's actions moved to the shell; next, the Needs you panel.
- 2026-10-27 · step 3: the Needs you panel, a Drawer over any page opened from the strip, answering Decisions and Gates there; next, the kinds tree and routing.
- 2026-10-27 · step 4: Notifications raised from the other modules' events with the kinds tree's routing, kept until their item is handled, and sent to the web; next, the channel adapters in the web.
- 2026-10-27 · step 5: the web's channels behind one port (toast, title and favicon, strip; desktop while the tab isn't focused) and the web's own "service down"; next, the check on the Test Project.
