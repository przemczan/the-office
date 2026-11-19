# Notifications: module map

**Owns:** Notifications (`notifications`): the kinds tree and routing resolved from the nearest level (`domain/notification-kinds.ts`), the routing the user sets in Settings › Notifications, by level and channel (`NotificationRouting`, `notification_routing`, seeded with spec 2.7's defaults), each Notification raised from another module's event with its content and the channels the stored routing gives it, Outcomes landing close together collapsed into one, and cleared once the user handles what it points to, or once the Decision it points to is closed as its Task was dropped or, on no Task, its Initiative ended (`DecisionClosed`, which also announces Now again) (`NotificationService`); the delivery rules, pure in `domain/delivery.ts`, and their timing (`notification_timing`, one row: the at-desk hold, the away delay, batching, quiet hours), applied by `NotificationDelivery`: the desktop and phone held inside quiet hours with one summary at their end, the phone waiting while any user is at the desk (The Office is away only when every user is: the latest activity of any user decides), sent through the `PhonePush` port (bound to `RecordingPhonePush`, which only records); and Now and the status strip as one read model shared by every user (`NowService`, pushed whole as `now.changed`; each started Task's Stages and alarm resume read four at a time (`readEach`), and a read for the push in a read scope of its own (`inReadScope`), as it runs outside any request), with each user's own Since you left beside it (`GET /now/since-you-left` for the requester: where their last absence began and the outcomes since), and what only events tell, kept in its own tables: each started Task's outcomes (`task_outcomes`), each user's activity by their id, which says where their Since you left begins (`user_activity`), and tokens by day (`day_tokens`, measured from `thread_token_counts`).

**Talks to:** only Telemetry's Stats calls it, reading tokens by day through `DayTokenHistory` (`lastDays`: the last office days ending today, a day with no count all zero). It reacts to the events of Work, Pipelines, Conversations and the Engine, and reads the rest through its ports, bound in [app.module.ts](../../app.module.ts): `OfficeTasks` to Work's `TaskService`, `DeskLimit` to Work's `OfficeLimits`, `StartQueue` to Work's `QueueService` (Now's queue, first place first), `OfficeInitiatives` to Work's `InitiativeService` (Now's Shaping: the Initiatives in Shaping, oldest first, with their Tasks so far, announced again on Work's Initiative and Task membership events and People's duty and hiring events), `KnownPeople` to People's `RoleCards` (`holderOf(duty)` alone: whoever holds Default person to talk to speaks the Office kinds, the Caretaker while nobody does; whoever shapes Initiatives tells an Initiative done, the UI's voice while nobody does, and is Now's shaper of each Initiative in Shaping, none while nobody does), `OpenDecisions` to Conversations' `DecisionService`, `TaskStageProgress` to Pipelines' `TaskStagesService`, `AccountUsage` to the Engine's `UsageWindowState`, `OfficeFireAlarm` to Work's `FireAlarmService` and `ResumePlans` to Pipelines' `AlarmResumes`: while the alarm is on, Now carries it (`Now.fireAlarm`: stopping until each Task it paused has a plan, then each plan and the total), read afresh on every read, since a cache cools with no event. `StandInChoicesWaiting` is bound to Pipelines' `StandInChoices`: the Stages waiting for the user's choice of a Stand-in Engine, which Needs you lists as one `stand-in-choice` item (their Projects, the oldest's `waitingSince`, `count`), read on every read and announced again on Pipelines' `StandInChoicesChanged`, which also raises or clears its one `needs-you.decision` (pointing to `{ kind: "stand-in-choice" }`, from whoever holds Default person to talk to). The `show_office_status` of whoever holds Default person to talk to (`OfficeStatusOfficeTools`, on the Engine's registry that `imports` must provide) gives the Agent Now in words (`officeStatusText`) and posts the Office status card through `OfficeStatusCards`, bound to Conversations' `ThreadService`; `NotificationsPortsForTestsModule` provides a registry of its own. Office-updates' `OfficeUpdated` and `OfficeUpdateFailed` raise `office.update.done` and `office.update.failed`, pointing at Settings › Updates (`office-update`), whose page activity handles them, as does the next result.

**Traps:**
- In-app and the desktop live in the browser: the service routes each Notification and sends it, with its channels and those quiet hours hold, as `notification.raised` (with the ids it `replaces`: a collapse takes the place of the Outcome or the collapse shown before); the web's channel adapters show it and ignore `phone`. The phone is a channel outside the browser, pushed through `PhonePush` here.
- Delivery runs on The Office's clock (`Schedule.now`, `Schedule.once`), never `new Date()`; waits are in memory and set again at boot and on a timing change from the open Notifications (`phone_pushed_at`, `held`), so a wait that ends decides again from the latest activity.
- A Notification that gathers others (`collapsed-outcomes`, `quiet-hours-summary`) is not a kind of the tree, so not a row of the grid; it clears once none it gathers is open. The Outcomes a collapse gathers stay open, out of the list (`shownOf`), until each is handled.
- Delivery acts only on Notifications the clock has reached (`raisedBy`), and batching only on Outcomes raised within the window before now: tests that raise on a clock of their own (2001 in `notification-service.full.test.ts`, 2100 in `notification-delivery.full.test.ts`) stay apart from the other files. The delivery test keeps the timing and the activity in fixtures (`ports/delivery.fixtures.ts`): both are one row for every file.
- A Decision raises `needs-you.decision` only when it waits on the user on a Task: none while put to a Consultant, on no Task, or in a chat, where it waits inline (spec §2.7), told by the event's Thread's `home`, so a test publishing `DecisionOpened` or `DecisionReopened` gives its Thread a `home`.
- The routing is one table for every test file, which run at once: a test that changes it changes only levels no other file raises, and gives them back.
- A Decision on no Task in an Initiative's shaping or planning Thread waits on the user like one on a Task: Needs you lists it as `initiative-decision`, with the Projects the Initiative's Tasks not Dropped are in, while the Initiative is known and neither Done nor Dropped, and it raises `needs-you.decision` naming the Initiative's title (read through `OfficeInitiatives`), pointing to `{ kind: "initiative", initiativeId, decisionId, threadId }`. Only its answer or its closing handles it, never opening the Initiative page, which handles only an `initiative` pointer with no `decisionId`. A Decision in a chat, on no Task, raises nothing and never shows in Needs you.
- Opening a page handles what points to it: the web reports the page with each activity (`POST /activity`, for the signed-in user), and opening a Task handles its outcomes, opening Now the 5-hour window's.
- Since you left is not in `Now`: the web reads it again on each `now.changed`, so a new outcome or a user's Since you left moving announces `now.changed` even when Now itself is as announced (`announceInBackground(true)`). Tests that report activity name a user of their own (`signedInAs` with a random id), since the rows are by user for every test file.
- `EventBus.publish` waits for its handlers, so Now is read and announced in the background (`announceInBackground`), one read after a burst of events. `TokensCounted` comes many times a turn and changes only `tokensToday`, so it reads that alone onto the Now last announced (`nextRead`); never make it read Now whole, which reads every Task and each started Task's Stage runs.
- Tokens today count how much each Thread's tokens so far grew since its last count; a turn's own count replacing its running one makes the growth negative, which is right.
- "Today" is the service's local day (`officeDayOf`).
- An Office kind's Notification carries a short line (`shortLine`, `short_line`) for the status strip's slot, made by the same function as its line and never in a person's voice, as the strip names who speaks beside it. Other kinds have none; the strip shows their line, as it does for an Office kind's raised before the column existed, which nothing fills in.
- An engine down points to the Office with its engine's id (`pointsTo.engineId`), so each engine's is raised on its own and handled only when a turn on that engine ends; one kept from before engines were named has none and any engine's turn handles it. The window kinds do the same: each engine's 5-hour window is compared with its own last reading (`windowReadings`, in memory, its `percentUsed` and `resetsAt`), and `windowMove` says `reset` only once that reading's `resetsAt` came on The Office's clock or the new reading's window began at or after it (its `resetsAt` less 5 hours, within a minute's rounding): a lower reading before then is neither a reset nor a nearly used crossing, and leaves the last reading standing. Its Notifications name the engine and point to `{ kind: "office", engineId }`, and its reset clears only its own nearly used; opening Now clears every engine's. Now's `usageWindows` lists each engine read, by id, with its 5-hour and 7-day windows.
- A used-up usage window (`office.window.used-up`, raised on Engine's `UsageWindowUsedUp`, in the `office.window` row) is handled by its own `used-up-window-reset` on `UsageWindowReset` for that engine, or a later refusal moving the reset on, never by `window-reset`: a 5-hour reading going down says nothing of a used-up 7-day window. A Task paused by the usage window raises "Task paused" (`taskPausedByUsageWindow`, worded with `usageWindowWords`) only from a running Task with the refusal on its `TaskPaused`; a refusal moving a paused Task's resume on, and the Initiative's Resume handing a Task back to the window, raise none. Their reset time is not worded by the service: the Notification keeps the instant (`at`, the `at` column; older ones have none) and its `line` and `shortLine` hold `{time}` (`TIME`, the contracts' `NOTIFICATION_TIME`), which the web words in the browser's time zone. The phone, outside the browser, gets it worded in the service's time zone (`withTimeWorded`, in `NotificationDelivery` before `PhonePush`), "14:00" on the day, with the day otherwise; `officeStatusText` names no reset time. One raised before the column has no `at` and its line worded already, in the service's zone; a rollback to an earlier release shows `{time}` as it is on one raised since.
- The Stages waiting for a Stand-in Engine raise one Notification per opening of the card: raised when `waiting()` first lists one, none more while it is open (a Stage joining raises nothing), cleared once `waiting()` is empty (`stand-in-choices-made`). It reacts to `StandInChoicesChanged`, not `StageAwaitsStandInChoice`, which fires before the held run is saved, so `waiting()` doesn't list it yet. A Stage waiting so raises no "Task paused" Outcome (its `TaskPaused.usageWindow.awaitsStandInChoice`); the engine's `office.window.used-up` stays. The card is one for The Office, so a test raising it clears it before and after.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

NotificationsModule, DayTokenHistory, DayTokens

## Domain events

- `domain/notification-events.ts`: NotificationRaised, NotificationsCleared, RoutingChanged, TimingChanged
- `domain/now-events.ts`: NowChanged

## HTTP routes (under `/api`)

- `GET /notifications`: NotificationsController.listOpen
- `GET /notifications/timing`: NotificationsController.readTiming
- `PUT /notifications/timing`: NotificationsController.setTiming
- `GET /notifications/routing`: NotificationsController.readRouting
- `PUT /notifications/routing/:level`: NotificationsController.setChannel
- `DELETE /notifications/routing/:level`: NotificationsController.reset
- `GET /now`: NowController.read
- `GET /now/since-you-left`: NowController.readSinceYouLeft
- `POST /activity`: NowController.recordActivity

## Tables

- `adapters/postgres/notifications.schema.ts`: task_outcomes, user_activity, thread_token_counts, day_tokens, notifications, notification_routing, notification_timing

## Files

### ./

- `notifications.module.ts`: NotificationsModuleOptions, NotificationsModule

### adapters/http/

- `notification-responses.ts`: toNotificationResponse, toTimingResponse, toRoutingResponse
- `notifications.controller.ts`: NotificationsController
- `now-responses.ts`: toNowResponse, toSinceYouLeftResponse
- `now.controller.ts`: NowController

### adapters/office-tools/

- `office-status-office-tools.ts`: OfficeStatusOfficeTools
- Tests: office-status-office-tools.full.test.ts

### adapters/phone/

- `recording-phone-push.ts`: RecordingPhonePush

### adapters/postgres/

- `notifications.schema.ts`: taskOutcomes, userActivity, threadTokenCounts, dayTokens, notifications, notificationRouting, notificationTiming
- `postgres-notification-repository.ts`: PostgresNotificationRepository
- `postgres-notification-routing-repository.ts`: PostgresNotificationRoutingRepository
- `postgres-notification-timing-repository.ts`: PostgresNotificationTimingRepository
- `postgres-office-day-figures.ts`: PostgresOfficeDayFigures
- `postgres-task-outcome-repository.ts`: PostgresTaskOutcomeRepository
- `postgres-user-activity-repository.ts`: PostgresUserActivityRepository
- Tests: postgres-office-day-figures.test.ts

### adapters/websocket/

- `notifications-web-events.ts`: NotificationsWebEvents

### application/

- `day-token-history.ts`: DayTokens, DayTokenHistory
- `notification-delivery.ts`: NotificationDelivery
- `notification-routing.ts`: NotificationRouting
- `notification-service.ts`: Page, NotificationService
- `now-service.ts`: NowService
- Tests: day-token-history.full.test.ts, notification-delivery.full.test.ts, notification-service.full.test.ts, now-service.full.test.ts, now-service.test.ts, since-you-left.test.ts, test-project-check.test.ts

### domain/

- `delivery.ts`: passesQuietHours, withQuietHours, raisedBy, shownOf, isOutcome, outcomeToJoin, outcomesOf, collapsedOutcomes, quietHoursSummary, isHeld, emptiedGatherings, PhoneDelivery, phoneDeliveryOf, outcomesLine, summaryLine
- `notification-events.ts`: NotificationRaised, NotificationsCleared, RoutingChanged, TimingChanged
- `notification-kinds.ts`: NOTIFICATION_KINDS, NotificationKind, CHANNELS, Channel, ChannelSettings, Routing, DEFAULT_ROUTING, WINDOW_NEARLY_USED_PERCENT, levelsOf, ROUTING_LEVELS, isRoutingLevel, RoutedChannel, routedChannel, channelsOf, isGroup, withChannelSet, withLevelReset
- `notification-timing.ts`: TimeOfDay, QuietHours, NotificationTiming, DEFAULT_TIMING, minutesMs, inQuietHours, quietHoursEnd
- `notification.ts`: Pointer, GatheringKind, Notification, NotificationDraft, notificationOf, decisionWaiting, decisionWaitingOnInitiative, standInChoiceWaiting, gateWaiting, taskDone, Failure, taskFailed, taskPaused, taskPausedByUsageWindow, UsedUpWindowWords, TIME, withTimeWorded, initiativeDone, windowNearlyUsed, windowReset, windowUsedUp, engineDown, officeUpdated, officeUpdateFailed, WindowReading, windowMove, windowHasReset, Handling, handles, samePointer
- `now-events.ts`: NowChanged
- `now.ts`: OfficeTask, OfficeInitiative, InitiativeTask, ShapingInitiative, NowFireAlarm, TaskResume, OpenDecision, StageOfTask, UsageWindow, EngineUsageWindows, WaitingDecision, WaitingInitiativeDecision, WaitingGate, StandInChoiceWaiting, WaitingStandInChoices, NeedsYouItem, CurrentStage, RunningTask, FinishedTask, QueuedOnNow, QueuedTask, AlarmPausedTask, FireAlarmOnNow, Desks, Now, SinceYouLeft, sinceYouLeftOf, StartedTask, NowParts, nowOf, waitingGateOf, currentStageOf
- `office-day.ts`: officeDayOf, TokenKinds, NO_TOKENS, addTokenKinds, tokensGrown
- `office-status.ts`: officeStatusText
- `task-outcome.ts`: TaskOutcomeKind, TaskOutcome, latestPerTask
- `user-activity.ts`: AWAY_AFTER_MS, UserActivity, recordActivity
- Tests: delivery.full.test.ts, notification-kinds.full.test.ts, notification-timing.full.test.ts, notification.full.test.ts, now.full.test.ts, office-status.full.test.ts, user-activity.full.test.ts

### ports/

- `account-usage.ts`: AccountUsage
- `delivery.fixtures.ts`: NotificationTimingForTests, UserActivityForTests, NotificationsForTests
- `desk-limit.ts`: DeskLimit
- `known-people.ts`: KnownPeople
- `notification-repository.ts`: NotificationRepository
- `notification-routing-repository.ts`: NotificationRoutingRepository
- `notification-timing-repository.ts`: NotificationTimingRepository
- `notifications-ports.fixtures.ts`: OfficeTasksForTests, OfficeInitiativesForTests, OpenDecisionsForTests, TaskStageProgressForTests, DeskLimitForTests, StartQueueForTests, KnownPeopleForTests, AccountUsageForTests, OfficeStatusCardsForTests, OfficeFireAlarmForTests, ResumePlansForTests, StandInChoicesWaitingForTests, NotificationsPortsForTestsModule
- `office-day-figures.ts`: ThreadTokens, OfficeDayFigures
- `office-fire-alarm.ts`: OfficeFireAlarm
- `office-initiatives.ts`: OfficeInitiatives
- `office-status-cards.ts`: OfficeStatusCards
- `office-tasks.ts`: OfficeTasks
- `open-decisions.ts`: OpenDecisions
- `phone-push.ts`: PhonePush
- `resume-plans.ts`: ResumePlans
- `stand-in-choices-waiting.ts`: StandInChoicesWaiting
- `start-queue.ts`: StartQueue
- `task-outcome-repository.ts`: TaskOutcomeRepository
- `task-stage-progress.ts`: TaskStageProgress
- `user-activity-repository.ts`: UserActivityRepository
