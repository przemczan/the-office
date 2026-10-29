# Progress log: 27 · Notifications: the kinds × channels grid, quiet hours, batching; the fire alarm

Moved from [27-notifications-and-fire-alarm.md](../27-notifications-and-fire-alarm.md) when the task was done. One line per commit, newest last.

- 2026-10-29 · step 0: wrote the task with the user's answers (spec 2.7 and 2.8 Defaults, glossary); step 1 next.
- 2026-10-29 · step 1: Office kinds re-keyed into `office.window.*`/`office.down.*` with `office.alarm-lifted`; `phone` a channel; `notification_routing` seeded with ticket 20's defaults, `NotificationRouting` and its routes, raising routed by it; step 2 next.
- 2026-10-29 · step 2: Settings › Notifications with "What goes where" (set or inherited cells, Reset, Phone "Not set up yet"); "service down" follows the routing; Playwright; step 3 next.
- 2026-10-29 · step 3: `notification_timing`, pure delivery rules (quiet hours, batching, the at-desk hold), `NotificationDelivery` with waits on the platform clock rebuilt at boot, a recording `PhonePush`, timing routes; step 4 next.
- 2026-10-29 · step 4: "At the desk" and "Quiet hours and batching" cards; collapsed Outcomes and the summary in the toast and on the desktop, held ones toast only; activity reported while focused; Playwright; step 5 next.
- 2026-10-29 · step 5: the fire alarm in Work (`fire_alarm`, sound route, Start and releases wait, Resume held), Pipelines' `alarm` interruption with the 60 s hard stop and the boot hold, Consultations stopped; step 6 next.
- 2026-10-29 · step 6: the Engine's tool hold, refusing every call while the fire alarm is on (the scripted engine too); lifts by Thread in Conversations (`fire_alarm_lifts`, kept for the sounding) with routes; step 7 next.
- 2026-10-29 · step 5 (fix): `AlarmSounded` after the pause pass, so the hard stop reaches a run started meanwhile; `office.ts`'s boot finishes a sounding it stopped during (Waiting on you Tasks too) before the release; step 7 next.
- 2026-10-29 · step 7: the all clear (`POST /fire-alarm/all-clear`, Resume/Hold/Drop, queue released, Consultations asked again) and its plan on Now through the Context policy (`AlarmResumes`, `sessionAhead`); the user's three answers in spec 2.8; step 8 next.
- 2026-10-29 · step 8: the alarm on the web (top bar, strip at 0 desks, Now's panel and review, composer note and lift, "Paused by the alarm"); Playwright; step 9 next.
- 2026-10-29 · step 9: three flaky tests fixed; the fire alarm's live check on the Test Project passed on Haiku 5.5 (held at the safe point, plan continues warm, resumed in the same session); verify and verify:linux pass; the user's look next.
- 2026-10-29 · step 9: the user approved the grid, quiet hours and the alarm after looking at the running app ("approved", 2026-10-29); `npm run verify` and `npm run verify:linux` passed on 0ac87c7; task 27 done.
