# Notifications: module map

**Owns:** Notifications (`notifications`): the kinds tree and routing resolved from the nearest level (`domain/notification-kinds.ts`), the routing the user sets in Settings › Notifications, by level and channel (`NotificationRouting`, `notification_routing`, seeded with ticket 20's defaults), each Notification raised from another module's event with its content and the channels the stored routing gives it, Outcomes landing close together collapsed into one, and cleared once the user handles what it points to, or once the Decision it points to is closed as its Task was dropped (`DecisionClosed`, which also announces Now again) (`NotificationService`); the delivery rules, pure in `domain/delivery.ts`, and their timing (`notification_timing`, one row: the at-desk hold, the away delay, batching, quiet hours), applied by `NotificationDelivery`: the desktop and phone held inside quiet hours with one summary at their end, the phone waiting while any user is at the desk (The Office is away only when every user is: the latest activity of any user decides), sent through the `PhonePush` port (`RecordingPhonePush` until task 28's Web Push); and Now and the status strip as one read model shared by every user (`NowService`, pushed whole as `now.changed`), with each user's own Since you left beside it (`GET /now/since-you-left` for the requester: where their last absence began and the outcomes since), and what only events tell, kept in its own tables: each started Task's outcomes (`task_outcomes`), each user's activity by their id, which says where their Since you left begins (`user_activity`), and tokens by day (`day_tokens`, measured from `thread_token_counts`).

**Talks to:** nothing calls it. It reacts to the events of Work, Pipelines, Conversations and the Engine, and reads the rest through its ports, bound in [app.module.ts](../../app.module.ts): `OfficeTasks` to Work's `TaskService`, `DeskLimit` to Work's `OfficeLimits`, `StartQueue` to Work's `QueueService` (Now's queue, first place first), `OfficeInitiatives` to Work's `InitiativeService` (Now's Shaping: the Initiatives in Shaping, oldest first, with their Tasks so far, announced again on Work's Initiative and Task membership events and People's duty and hiring events), `KnownPeople` to People's `RoleCards` (`holderOf(duty)` alone: whoever holds Default person to talk to speaks the Office kinds, the Caretaker while nobody does; whoever shapes Initiatives tells an Initiative done, the UI's voice while nobody does, and is Now's shaper of each Initiative in Shaping, none while nobody does), `OpenDecisions` to Conversations' `DecisionService`, `TaskStageProgress` to Pipelines' `TaskStagesService`, `AccountUsage` to the Engine's `UsageWindowState`, `OfficeFireAlarm` to Work's `FireAlarmService` and `ResumePlans` to Pipelines' `AlarmResumes`: while the alarm is on, Now carries it (`Now.fireAlarm`: stopping until each Task it paused has a plan, then each plan and the total), read afresh on every read, since a cache cools with no event. The `show_office_status` of whoever holds Default person to talk to (`OfficeStatusOfficeTools`, on the Engine's registry that `imports` must provide) gives the Agent Now in words (`officeStatusText`) and posts the Office status card through `OfficeStatusCards`, bound to Conversations' `ThreadService`; `NotificationsPortsForTestsModule` provides a registry of its own. Office-updates' `OfficeUpdated` and `OfficeUpdateFailed` raise `office.update.done` and `office.update.failed`, pointing at Settings › Updates (`office-update`), whose page activity handles them, as does the next result.

**Traps:**
- In-app and the desktop live in the browser: the service routes each Notification and sends it, with its channels and those quiet hours hold, as `notification.raised` (with the ids it `replaces`: a collapse takes the place of the Outcome or the collapse shown before); the web's channel adapters show it and ignore `phone`. The phone is a channel outside the browser, pushed through `PhonePush` here.
- Delivery runs on The Office's clock (`Schedule.now`, `Schedule.once`), never `new Date()`; waits are in memory and set again at boot and on a timing change from the open Notifications (`phone_pushed_at`, `held`), so a wait that ends decides again from the latest activity.
- A Notification that gathers others (`collapsed-outcomes`, `quiet-hours-summary`) is not a kind of the tree, so not a row of the grid; it clears once none it gathers is open. The Outcomes a collapse gathers stay open, out of the list (`shownOf`), until each is handled.
- Delivery acts only on Notifications the clock has reached (`raisedBy`), and batching only on Outcomes raised within the window before now: tests that raise on a clock of their own (2001 in `notification-service.full.test.ts`, 2100 in `notification-delivery.full.test.ts`) stay apart from the other files. The delivery test keeps the timing and the activity in fixtures (`ports/delivery.fixtures.ts`): both are one row for every file.
- A Decision raises `needs-you.decision` only when it waits on the user on a Task: none while put to a Consultant, on no Task, or in a chat, where it waits inline (spec §2.7), told by the event's Thread's `home`, so a test publishing `DecisionOpened` or `DecisionReopened` gives its Thread a `home`.
- The routing is one table for every test file, which run at once: a test that changes it changes only levels no other file raises, and gives them back.
- Opening a page handles what points to it: the web reports the page with each activity (`POST /activity`, for the signed-in user), and opening a Task handles its outcomes, opening Now the 5-hour window's.
- Since you left is not in `Now`: the web reads it again on each `now.changed`, so a new outcome or a user's Since you left moving announces `now.changed` even when Now itself is as announced (`announceInBackground(true)`). Tests that report activity name a user of their own (`signedInAs` with a random id), since the rows are by user for every test file.
- `EventBus.publish` waits for its handlers, so Now is read and announced in the background (`announceInBackground`), one read after a burst of events.
- Tokens today count how much each Thread's tokens so far grew since its last count; a turn's own count replacing its running one makes the growth negative, which is right.
- "Today" is the service's local day (`officeDayOf`).
- An Office kind's Notification carries a short line (`shortLine`, `short_line`) for the status strip's slot, made by the same function as its line and never in a person's voice, as the strip names who speaks beside it. Other kinds have none; the strip shows their line, as it does for an Office kind's raised before the column (2026-11-14), which nothing fills in.
- An engine down points to the Office with its engine's id (`pointsTo.engineId`), so each engine's is raised on its own and handled only when a turn on that engine ends; one kept from before engines were named has none and any engine's turn handles it. The window kinds do the same: each engine's 5-hour window is compared with its own last reading (`windowPercents`, in memory), its Notifications name the engine and point to `{ kind: "office", engineId }`, and its reset clears only its own nearly used; opening Now clears every engine's. Now's `usageWindows` lists each engine read, by id, with its 5-hour and 7-day windows.
- A used-up usage window (`office.window.used-up`, raised on Engine's `UsageWindowUsedUp`, in the `office.window` row) is handled by its own `used-up-window-reset` on `UsageWindowReset` for that engine, or a later refusal moving the reset on, never by `window-reset`: a 5-hour reading going down says nothing of a used-up 7-day window. A Task paused by the usage window raises "Task paused" (`taskPausedByUsageWindow`, worded with `usageWindowWords`) only from a running Task with the refusal on its `TaskPaused`; a refusal moving a paused Task's resume on, and the Initiative's Resume handing a Task back to the window, raise none. Its reset time is worded in the service's local time, "14:00" on the day, with the day otherwise.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

NotificationsModule

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

### adapters/websocket/

- `notifications-web-events.ts`: NotificationsWebEvents

### application/

- `notification-delivery.ts`: NotificationDelivery
- `notification-routing.ts`: NotificationRouting
- `notification-service.ts`: Page, NotificationService
- `now-service.ts`: NowService
- Tests: notification-delivery.full.test.ts, notification-service.full.test.ts, now-service.full.test.ts, now-service.test.ts, since-you-left.test.ts, test-project-check.test.ts

### domain/

- `delivery.ts`: passesQuietHours, withQuietHours, raisedBy, shownOf, isOutcome, outcomeToJoin, outcomesOf, collapsedOutcomes, quietHoursSummary, isHeld, emptiedGatherings, PhoneDelivery, phoneDeliveryOf, outcomesLine, summaryLine
- `notification-events.ts`: NotificationRaised, NotificationsCleared, RoutingChanged, TimingChanged
- `notification-kinds.ts`: NOTIFICATION_KINDS, NotificationKind, CHANNELS, Channel, ChannelSettings, Routing, DEFAULT_ROUTING, WINDOW_NEARLY_USED_PERCENT, levelsOf, ROUTING_LEVELS, isRoutingLevel, RoutedChannel, routedChannel, channelsOf, isGroup, withChannelSet, withLevelReset
- `notification-timing.ts`: TimeOfDay, QuietHours, NotificationTiming, DEFAULT_TIMING, minutesMs, inQuietHours, quietHoursEnd
- `notification.ts`: Pointer, GatheringKind, Notification, NotificationDraft, notificationOf, decisionWaiting, gateWaiting, taskDone, Failure, taskFailed, taskPaused, taskPausedByUsageWindow, UsedUpWindowWords, initiativeDone, windowNearlyUsed, windowReset, windowUsedUp, engineDown, officeUpdated, officeUpdateFailed, windowMove, Handling, handles, samePointer
- `now-events.ts`: NowChanged
- `now.ts`: OfficeTask, OfficeInitiative, InitiativeTask, ShapingInitiative, NowFireAlarm, TaskResume, OpenDecision, StageOfTask, UsageWindow, EngineUsageWindows, WaitingDecision, WaitingGate, NeedsYouItem, CurrentStage, RunningTask, FinishedTask, QueuedOnNow, QueuedTask, AlarmPausedTask, FireAlarmOnNow, Desks, Now, SinceYouLeft, sinceYouLeftOf, StartedTask, NowParts, nowOf, waitingGateOf, currentStageOf
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
- `notifications-ports.fixtures.ts`: OfficeTasksForTests, OfficeInitiativesForTests, OpenDecisionsForTests, TaskStageProgressForTests, DeskLimitForTests, StartQueueForTests, KnownPeopleForTests, AccountUsageForTests, OfficeStatusCardsForTests, OfficeFireAlarmForTests, ResumePlansForTests, NotificationsPortsForTestsModule
- `office-day-figures.ts`: ThreadTokens, OfficeDayFigures
- `office-fire-alarm.ts`: OfficeFireAlarm
- `office-initiatives.ts`: OfficeInitiatives
- `office-status-cards.ts`: OfficeStatusCards
- `office-tasks.ts`: OfficeTasks
- `open-decisions.ts`: OpenDecisions
- `phone-push.ts`: PhonePush
- `resume-plans.ts`: ResumePlans
- `start-queue.ts`: StartQueue
- `task-outcome-repository.ts`: TaskOutcomeRepository
- `task-stage-progress.ts`: TaskStageProgress
- `user-activity-repository.ts`: UserActivityRepository
