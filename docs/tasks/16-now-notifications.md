# 16 · Now, the status strip and Notifications

Status: todo

## Goal

Now is the home the user opens first: what needs them, what is running, what happened since they left, and today's tokens, each answerable in place. The status strip fills in with live figures, the Needs you panel opens Decisions and Gates from any page, and the Notifications module sends in-app and desktop Notifications from the kinds tree, cleared by handling what they point to.

## Definition of Done

- [ ] Now shows Needs you (Decisions, Gates, messages from people), Running (Task · person · Stage · time in Stage), Since you left (Tasks done, failed or paused since the user was last active) and today's tokens, and nothing else; a Decision or Gate is answered in place. Check: Playwright with a waiting Decision, a running Task and a finished one.
- [ ] The status strip shows needs you, desks in use (running Tasks against the Office-wide limit), tokens today, the 5-hour window with its meter and reset time from `rate_limit_event`, Tasks touched and done since you left, live. Check: watch it through a run.
- [ ] The Needs you panel opens from the strip on any page and answers Decisions and Gates there. Check: answer one from the Projects page.
- [ ] The kinds tree is in code (`needs-you.decision`, `needs-you.gate`, `needs-you.message`, `outcomes.task-done`, `outcomes.task-failed`, `outcomes.task-paused`, `office.window-nearly-used`, `office.window-reset`, `office.service-down`, `office.engine-down`) with routing resolved from the nearest level, and the defaults of [spec §2.7](../spec.md#27-notifications). Check: unit tests of the resolution, including a kind split below a level that has an override.
- [ ] In-app: a toast, the unread count in the tab title and favicon, the strip. Desktop: the browser's notification, only while the tab isn't focused (otherwise the toast). Each opens what it points to, and handling that item clears it on every channel. Check: Playwright with the tab focused and blurred.
- [ ] Content is the person's avatar and name, one first-person line, the Task and the Project, with no action buttons; Office kinds speak in the UI's own voice with no person, and "service down" is raised by the web app itself when it loses the service. Check: one of each kind, and stop the service.

## Read first

- [Spec §1](../spec.md#1-the-users-day), [§2.7](../spec.md#27-notifications), [§4](../spec.md#4-ux-direction) (status strip, Needs you panel), [§9](../spec.md#9-defaults-chosen-in-this-spec) (Office kinds without a person, desks in use).
- Click-through: [app/now.js](../../.scratch/the-office/prototypes/app/now.js), the status strip and Needs you panel in [app/core.js](../../.scratch/the-office/prototypes/app/core.js).

Leave out: the kinds × channels grid, quiet hours, batching, the at-desk hold, phone push, the alarm state and the all clear, the Office Manager as the voice of Office kinds, and the Project filter.

## Steps

- [ ] 1. A read model for Now and the strip, built from domain events (Needs you, Running, Since you left from the user's last activity, tokens today, desks in use, the window state), pushed over WebSocket. Commit.
- [ ] 2. Now in `apps/web` with in-place answers, and the status strip's figures. Commit.
- [ ] 3. The Needs you panel. Commit.
- [ ] 4. Notifications module: the kinds tree, routing with inheritance, the channels port, Notifications as pointers cleared when their item is handled. Choose "window nearly used" at 90% and tell the user it is a default. Commit.
- [ ] 5. Channel adapters: in-app (toast, title, favicon, strip) and desktop (the browser Notification API, permission asked once, only when the tab isn't focused), and the web app's own "service down". Commit.
- [ ] 6. Check on the Test Project: a day's loop of planning, a Decision, a Gate and a finished Task, seen from Now and as Notifications; log what arrived where. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->
