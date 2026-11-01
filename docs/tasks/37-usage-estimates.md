# 37 · Usage estimates

Status: in progress

## Goal

Before a Task starts, the user sees its Usage estimate: what its whole Pipeline is expected to use. It is given in the measures the user ticks in Settings › Office limits: tokens, the 5-hour window, the 7-day window and cost in dollars. It shows on Ready Tasks, in the Start flow and in the queue.

The estimate comes from history: the median of done Tasks' Stage runs for the same Project and Pipeline, Stage by Stage, summed. Below 3 done Tasks it comes from the Planner's token estimate in the Plan. Cost comes from Model prices the user sets in Settings › Engines, so it works on every engine.

Caps are per account for the Claude Code engines, one set for the OpenAI-compatible API: the two Claude Code engines spend the same account's credits, so they share a Window cap on each window (only they have windows) and a Daily cap on tokens and on dollars; the OpenAI-compatible API's endpoints share one set of Daily caps. A Start that would pass a cap its Pipeline's engines fall under waits in the queue until that cap resets, unless every exceeded cap resets within the prompt cache's hour.

## Definition of Done

- [ ] Each Agent Stage run keeps its engine and model, and the usage windows read as it starts and as it ends. Each reading carries when it was read and the Office's tokens so far on the engines with windows. Check: Pipelines and Engine tests with the scripted engine; the migration.
- [x] The Engine counts each day's tokens by engine id and model, kind by kind, from every turn of every session. "Today" starts at local midnight on the service, as in §2.7. Check: Engine tests; the migration.
- [ ] Settings › Engines sets a Model price for each model it offers: input, output, cache writes and cache reads, in dollars per million tokens. They are kept in the database. A model with no price gives "no cost", which never holds a Start. Check: service tests of the settings and of a cost; e2e test of the prices.
- [ ] A Task's Usage estimate is per engine, the engine being the one each Stage's Role picks.
  - For each Stage, a sample is the sum of that Stage's runs in one done Task of the same Project and Pipeline, among the last 20, so loops and send-backs count. The median is taken of each token kind.
  - A window sample counts only when both readings exist, the window didn't reset during the run, and the Office's token total didn't go down. The window's change is scaled by the run's share of the Office's tokens between the readings.
  - Cost is the median tokens at the current Model prices.
  - Below 3 done Tasks, the Planner's tokens stand in, split evenly over the Agent Stages. Their window % and cost come from Office-wide ratios to tokens. With no history at all they are "no estimate".

  Check: domain tests of medians, resets, missing readings, prices and the fallback.
- [ ] The Planner's `write_plan` takes an optional token estimate, shown with the Plan. Check: Work tests; the contract's schemas.
- [ ] Settings › Office limits ticks the measures (any number; none turns estimates off; tokens and the 5-hour window by default), and sets the caps: one set for the Claude Code engines' account, one for the OpenAI-compatible API. Window caps default to 90%; the Daily caps are off unless set. Check: service tests; e2e test of the card.
- [ ] Start waits in the queue when a ticked measure's cap that an engine the Task uses falls under would be passed (the Task's estimates on the engines under one cap add up):
  - A window: its use, plus the estimates of Tasks started since the reading, plus this Task's estimate. A window with no reading, or whose reset has passed, counts as unused.
  - A Daily cap: the day's actual use on the engines under it, plus what is left of the estimates of Tasks in progress, plus this Task's.

  A Task with no estimate waits only when the use alone passes the cap. The reason names the cap's engines, the cap, the use, the estimate and the reset. The Task starts anyway when every exceeded cap resets within an hour. The queue is released on each new reading, an hour before the earliest reset that frees a waiting Task, and at that reset. Check: domain tests of each cap and the hour; Work tests of the timers and of two Starts on one reading.
- [ ] The estimate, or "no estimate", shows with where it came from (history of n Tasks, or the Planner):
  - on Ready Task cards;
  - on the Task page's Ready block;
  - in the Start flow;
  - on queued Tasks on the board and on Now.

  Check: e2e tests.
- [ ] Seen once live on the Test Project with the Agent SDK engine and the cheapest model. Check: the run summarised in State, covering:
  - a Stage run's readings;
  - how fine `utilization` is;
  - a Start held by a lowered cap and released.

## Read first

- [Spec §2.1](../spec/2.1-work.md), "A queue for Start" and "Usage estimates"; [§2.2](../spec/2.2-people.md), Limits; [§5.4](../spec/5.4-the-engine.md), the usage windows and Model prices; [§8](../spec/8-open-questions-and-risks.md), Tier 3's usage estimates.
- The [work map](../../apps/service/src/modules/work/MAP.md), the [pipelines map](../../apps/service/src/modules/pipelines/MAP.md) and the [engine map](../../apps/service/src/modules/engine/MAP.md).
- The reference's lessons: `.scratch/the-office/research/factory-reference.md` §3b and §3c (l. 106–145).

Leave out:
- Per-Stage and Planning estimates, and a check before each Stage: the gate is at Start only.
- A Notification for a Task waiting on a cap.
- Polling the windows between runs, and the CLI's OAuth usage endpoint (§5.4).
- The engine's own `total_cost_usd` for estimates and caps.
- Pricing a subagent's model apart from its session's.
- The phone.

The click-through has no screen for estimates, caps or prices. The nearest is Settings › Office limits' "The 5-hour window" card (`settings.js`, `limitsSection`), marked "a later ticket". These screens follow the existing cards' patterns.

Decided with the user on 2026-11-01:
- The measures, offered Office-wide: tokens (input, output and cache writes, as every token count), the 5-hour window %, the 7-day window % and cost in dollars. They are checkboxes; any number may be ticked, and none turns estimates off. Tokens and the 5-hour window are ticked by default. A window or a cap holds Starts only while its measure is ticked.
- Only a Task at Start gets an estimate, for its whole Pipeline.
- History comes first: the median of done Tasks' Stage runs for the same Project and Pipeline, Stage by Stage, summed. It wins at 3 done Tasks, taken from the last 20.
- Below that, the Planner's token estimate in the Plan stands in. Window % and cost are derived from Office-wide ratios to tokens. With no history at all they show "no estimate", which never holds a Start.
- Caps are per account for the Claude Code engines, one set for the OpenAI-compatible API (amended by the user on 2026-11-01: the Agent SDK engine and the `-p` fallback spend the same account's credits, so they share one set; the API endpoints share one set for now).
  - The Claude Code engines' account has a 5-hour and a 7-day Window cap, 90% by default. The OpenAI-compatible API has no windows, so no Window caps.
  - Each set has a Daily cap on tokens and one on dollars, off unless set.
- Cost comes from a Model price per model, set in Settings, not from the engine's reported cost, so it works on every engine.
- Pending estimates:
  - For a window, each Task started since the last reading adds its estimate until a new reading arrives.
  - For a Daily cap, the day's actual use plus the pending estimates.

Chosen while writing, for the user to review:
- "Engine" is each of `ENGINES` as a Role card names it. The two Claude Code engines read the same account's windows and share its caps (the user, 2026-11-01). The API endpoints of the OpenAI-compatible API share its one set of caps.
- Model prices live in the Engine module (`model_prices`, keyed by engine id and model, as caps and each day's use are, so a Claude model has one price on both Claude Code engines (the user, 2026-11-01); four numerics per million tokens, nullable as a whole: no row is no price). They are edited in Settings › Engines with the rest of its draft and sent whole by `PUT /settings/engines`. No prices are seeded.
- A Stage run's cost is priced when the estimate is computed, from its tokens kind by kind and the current prices. A price change therefore reaches history, and no cost is stored. A Task's cost estimate is "no cost" when any Stage's model has no price.
- For a Daily cap, the pending part is what is left of each Task in progress's estimate (estimate minus what it has used), so nothing is counted twice.
- The hour exception covers Daily caps as well: their reset is local midnight.
- Pipelines owns the history estimate, from `stage_runs`. Work owns the following:
  - the Task's Usage estimate, from history or else the Plan;
  - the measures and caps (`work_settings` and `engine_caps`);
  - the wait.

  Work reads the windows and the day's use through ports bound to Engine. There is no new module.
- Raw readings are kept on the run, so the sample rules can change without a migration. The token-share scaling removes parallel runs and chats. The user's own use outside The Office still counts in.
- The last reading and the Office's token total live in memory. After a restart no Task waits on a window until a session reads again, and samples spanning the restart are dropped.
- Existing done Tasks have no engine, model or readings. Their tokens still count, priced at the Stage's Role's current model.

## Steps

- [x] 0. Write this file; settle the open questions with the user; amend spec §2.1, §2.2, §2.7, §3, §4, §5.4 and §8; add the glossary's "Usage estimate", "Window cap", "Daily cap" and "Model price", and amend "Queue"; refine `coverage.md`'s row; link from the README. Commit.
- [x] 1a. Readings through a Stage Thread, in Engine and Conversations, about 65k:
  - `EngineSessions` keeps the Office's tokens so far on engines with windows. `UsageWindowState` keeps when each reading was read. A reading carries both (`readAt`, `officeTokensSoFar`).
  - Conversations' Stage Thread gains `usageWindows()`, which reads the session's windows by the usage query (no model call). It is undefined on an engine without the `usageWindows` capability, or when the read fails. A window whose answer lacks `utilization` or `resets_at` has not begun and counts as unused, 0% with no reset; each window is judged on its own (decided in step 1b, so an idle 5-hour window no longer loses the 7-day one).
  - Scripted engine scripts give the windows.
  - Commit.

  Read: the State; `engine/MAP.md`; `engine/application/engine-sessions.ts` (`WatchedSession` by symbol, `readUsageWindows` l. 131–141); `engine/application/usage-window-state.ts`; `engine/domain/usage-windows.ts`; `engine/ports/engine-session.ts` (`readUsageWindows`); `engine/adapters/claude-code/sdk-events.ts` (`usageWindows`, l. 212–229, where a missing `utilization` becomes 0); `pipelines/ports/stage-threads.ts` (`StageTurn` l. 64–71, `StageThread` by symbol); Conversations' adapter of `StageThreads` (LSP `goToImplementation`).
- [x] 1b. Stage runs keep engine, model and readings, in Pipelines, about 60k:
  - A migration: `stage_runs.engine`, `model` (text, nullable for older runs), and `usage_windows_at_start` and `usage_windows_at_end` (jsonb, nullable). It goes through the repo's drizzle generate script.
  - `AgentStageRunner` records the session's engine and model, and reads the windows after the session opens and after the run's last turn.
  - Commit.

  Read: the State; `pipelines/MAP.md`; `pipelines/adapters/postgres/stage-runs.schema.ts`; `pipelines/domain/stage-run.ts` (`StageTokens`, `addTokens` by symbol); `pipelines/application/agent-stage-runner.ts` (`readResult` l. 386–420, `open` by symbol); `pipelines/ports/stage-run-repository.ts` (`saveTokens`); the latest migration in `apps/service/drizzle/`.
- [x] 1c. The day's use per engine id and model, in Engine, about 60k:
  - `engine_day_usage` (day, engine id, model, the four token kinds), added to on every turn's end in `WatchedSession`. "Today" starts at local midnight on the service, as Notifications' `day_tokens` counts it.
  - `DayUsage.today(engineId)` gives the tokens by model, exported for Work's port.
  - Caps, readings and each day's use are keyed by an engine id, not the `engine` kind (the user, 2026-11-01, for task 47's list of engines): `claude-code` for both Claude Code engines, `openai-compatible-api` for the API, mapped in one place, Engine's `engineIdOf`.
  - Commit.

  Read: the State; `engine/application/engine-sessions.ts` (`WatchedSession`); `notifications/adapters/postgres/notifications.schema.ts` (`dayTokens`, l. 43–60) and how Notifications fixes the day (grep `dayTokens`); `engine/adapters/postgres/engine-settings.schema.ts`.
- [x] 2a. Model prices, in Engine, about 70k:
  - `model_prices` (a migration), keyed by engine id and model.
  - `EngineSettings` and its edit carry each offered model's price. Prices of models no longer offered are dropped on save.
  - `ModelPrices.costOf(engineId, model, tokens)` gives dollars, or undefined with no price. It is exported.
  - Contract schemas.
  - Commit.

  Read: the State; `engine/domain/engine-settings.ts` (`EngineSettings`, `EngineSettingsEdit`, `changedEngineSettings`); `engine/application/engine-settings-service.ts`; `engine/application/engine-models.ts`; `engine/adapters/postgres/postgres-engine-settings.ts`; `engine/adapters/http/engine-settings.controller.ts`; `packages/contracts/src/engines.ts`.
- [x] 2b. Web, Settings › Engines' Model prices, about 55k: a Prices card listing each offered model (the Claude Code engines' as `GET` lists them, and each drafted API endpoint's) with four price fields, in the section's one draft, Save and Discard. e2e test. Commit.

  Read: the State; `apps/web/src/surfaces/settings/MAP.md` (Engines); `settings/engines/engines-section.tsx`, `engine-settings-draft.ts`; `apps/web/src/api/engine.ts`; `apps/web/e2e/MAP.md`.
- [x] 3a. The history estimate, in Pipelines, about 75k:
  - `domain/usage-history.ts`:
    - a Stage's samples over the last 20 done Tasks, and the median of each token kind;
    - the window samples that count, and their change scaled by the run's token share;
    - the sample count;
    - the Office-wide ratios of window % and of priced cost to tokens.
  - `UsageHistory.of(doneTaskIds)` (Work names the done Tasks of the Project and Pipeline; decided in step 3a) gives, per Stage key, its median tokens and window changes with the sample count. `UsageHistory.ratios(doneTaskIds)` gives the ratios. Both are exported for Work's port.
  - Commit.

  Read: the State; `pipelines/MAP.md` (Talks to); `pipelines/ports/stage-run-repository.ts` and its Postgres adapter (list queries by symbol); `pipelines/ports/started-tasks.ts`; the [module template](../../apps/service/docs/module-template.md), on exporting an application service.
- [x] 3b. The Planner's estimate and the Task's Usage estimate, in Work and the contracts, about 90k:
  - `write_plan` takes `estimatedTokens` (optional; left out, the Task keeps its own). `PUT /tasks/:id/plan` and the Task's contract carry it.
  - `domain/usage-estimate.ts`:
    - per engine, from each Stage's Role's engine and model;
    - from history at 3 samples (`UsageHistory.of`, given the Project's done Tasks on the Pipeline), else the Plan's tokens over the Agent Stages with the ratios (`UsageHistory.ratios`, given every done Task);
    - cost priced through a port to `ModelPrices`;
    - only the ticked measures, and `null` with none ticked.
  - `GET /tasks/:id/start` carries it. `GET /usage-estimates` gives every Ready and queued Task's.
  - Commit.

  Read: the State; `pipelines/domain/usage-history.ts` (`StageUsage`, `UsageRatios`, `countedTokens`); `work/adapters/office-tools/planning-office-tools.ts` (`registerWritePlan`, l. 50–68); `work/domain/planning-changes.ts` (`proposePlan`); `work/domain/task.ts` (`Task`); `work/ports/known-pipelines.ts`, `known-people.ts` (the Stages and each Role's engine and model); `packages/contracts/src/work.ts` (`taskSchema`, `startCheckSchema` l. 225–235); `work/application/start-service.ts` (`check`); `app.module.ts` (Work's port bindings).
- [x] 4. The measures and caps, in Work, about 70k:
  - `work_settings` gains the ticked measures, and `engine_caps` (one row per engine id: `claude-code`, the Claude Code engines' account, and `openai-compatible-api`; 5-hour %, 7-day %, daily tokens, daily dollars, each nullable) comes with a migration. A Stage's engine reaches its row through Engine's `engineIdOf`, the one mapping. Window caps default to 90% on `claude-code`.
  - `GET`/`PUT /settings/usage`, with an event that releases the queue.
  - Contract schemas.
  - Commit.

  Read: the State; `work/adapters/postgres/work-settings.schema.ts`; `work/ports/work-settings.ts`; `work/application/office-limits.ts`; `work/adapters/http/office-limits.controller.ts`; `work/domain/office-limit-events.ts`; `engine/domain/engines.ts` (`ENGINES`), `engine/ports/agent-engine.ts` (`usageWindows` capability).
- [x] 5a. The window wait, in Work, about 85k:
  - `StartConditions` gains, per engine id the Task's engines fall under (by `engineIdOf`; its estimates on those engines added up), the windows (a port `AccountWindows` bound to `UsageWindowState`, asked by engine id; only `claude-code` has windows), the caps, the ticked measures and the estimate.
  - `startReasons` adds `windowWaits`:
    - unused with no reading or a passed reset;
    - held when the use, plus the estimates of Tasks started since `readAt`, plus this Task's, passes the cap;
    - the hour exception.

    `releaseQueue` adds each Task it starts.
  - `QueueService` releases on `UsageWindowsChanged`, and on a timer an hour before, and at, the earliest reset that frees a waiting Task. The timer is set again after each release and cleared at shutdown.
  - Commit. `npm run verify:linux`.

  Read: the State; `work/domain/task-start.ts` (`startReasons` l. 69–94, `StartConditions` by symbol); `work/domain/queue.ts` (`releaseQueue`, l. 106–140); `work/application/start-conditions.ts`; `work/application/queue-service.ts`; `notifications/ports/account-usage.ts` (the same port's pattern).

  Traps: Start, every release and every queue change hold Starts (`holdStarts`). The queue and `work_settings` are shared by every test file, so a test that lowers a cap overrides it with `WorkSettingsForTests`.
- [ ] 5b. The Daily caps, in Work, about 60k:
  - `dailyCapWaits`: the day's use on the cap's engine id (a port bound to `DayUsage.today(engineId)`, cost priced by `ModelPrices`), plus what is left of each Task in progress's estimate, plus this Task's; the hour exception with local midnight as the reset.
  - The release timer covers midnight.
  - Commit.

  Read: the State; step 5a's code; `pipelines/ports/task-usage.ts` and Conversations' `TaskTokens` (a Task's tokens so far).
- [ ] 6a. Web, Settings › Office limits' Usage card, about 70k:
  - the measures as checkboxes;
  - a row per engine id (`claude-code`, the Claude Code engines' account, with its Window caps; `openai-compatible-api`) with its Daily caps, which are off until set;
  - the windows' use and resets, as the click-through's card shows;
  - Save and Discard.

  e2e test. Commit.

  Read: the State; `apps/web/src/surfaces/settings/MAP.md`; `settings/office-limits/office-limits-section.tsx`; `apps/web/src/api/work.ts` (the Office-wide limit's query and mutation); click-through `settings.js`, `limitsSection` (l. 121–149); `apps/web/e2e/MAP.md`.
- [ ] 6b. Web, the estimate where a Task starts, about 80k:
  - The Plan shows the Planner's token estimate (`task.estimatedTokens`), on the Task page's Plan.
  - One `UsageEstimateLine` gives the ticked measures in the UI's words, per engine when the Task uses several, with "no estimate" or "no cost" where there is none and where the estimate came from.
  - It shows on Ready Task cards, the Ready block, the Start note, and queued Tasks on the board and on Now.
  - A cap wait's reason shows as the service words it.

  e2e tests on the scripted engine. Commit.

  Read: the State; `apps/web/src/surfaces/work/MAP.md`; `work/start-action.tsx` (`StartNote`, l. 106–128); `work/ready-block.tsx`; `work/queue-parts.tsx`; `work/board.tsx` (the card, l. 180–220); `now/now-page.tsx` (`QueueFeed` by symbol); `apps/web/src/api/work.ts`.
- [ ] 7. The live check on the Test Project, Agent SDK engine, cheapest model, about 80k.

  It is needed because two things are seen only on a real account:
  - whether `utilization` is a whole number, in which case a small run's change reads 0 and the medians round to 0;
  - what `get_usage` answers at a run's start (engine-check l. 280 saw it without `resets_at` or `utilization`).

  Run a one-line Task to Done twice and read both runs' readings. Lower the Claude Code engines' 5-hour cap below the use and see a Start wait, then raise it and see the Task start. Record what was seen in State, and adjust the sample rule if `utilization` is coarse. Commit.

  Read: [the Test Project](test-project.md); [testing](../../apps/service/docs/testing.md) (live checks).
- [ ] 8. Close: every box ticked with its check, `npm run verify:linux`; archive the Progress log; the task `done` here and in the README. Commit.

## State

- Steps 1a–5a done; next, 5b. Engine: `EngineSessions.readUsageWindows` reads the windows into `UsageWindowState` (`readAt`, `officeTokensSoFar`); a window not begun is 0% with no `resetsAt`. Engine ids (`claude-code`, `openai-compatible-api`) key caps, readings, day use (`DayUsage.today`) and Model prices; `engineIdOf` is the one mapping, task 47 replaces it.
- Pipelines: `StageRun` keeps `engine`, `model` and both readings (0068). `UsageHistory.of(doneTaskIds)` / `ratios(doneTaskIds)` in `UsageHistoryModule`, over the latest 20; rules in `pipelines/domain/usage-history.ts`. Prices: `model_prices` (0070), `ModelPrices.costOf`; web card in Settings › Engines.
- Planner's estimate (3b): `Task.estimatedTokens` (`tasks.estimated_tokens` bigint, 0071), written by `write_plan`'s optional `estimatedTokens`, carried by `PUT /tasks/:id/plan` and `taskSchema` (nullable); left out keeps the Task's; a whole number above 0. The web's `PlanConfirmation` leaves it out; the Plan doesn't show it yet (added to 6b).
- Usage estimate (3b): `work/domain/usage-estimate.ts` (`historyUsage`, `plannerUsage`, `tasksInHistory`, `stageEngineAndModel`), `application/usage-estimates.ts` (`UsageEstimates.of(task, everyTask)`, `ofReadyTasks()`), in `StartCheck.usageEstimate` and `GET /usage-estimates` (`usage-estimates.controller.ts`); contract `usageEstimateSchema` (`basis`: history of n Tasks, planner, or none; `engines`: ticked measures only, null where none). Ports `UsageHistory` and `ModelPrices` (Work's own types), bound in `app.module.ts`; fakes in `work-ports.fixtures.ts`. `KnownPerson.card` gains `engine`, `model`; `KnownPipelines.find` gives `KnownPipeline` (Stage keys, models).
- Grouped by engine id (the user, 2026-11-01, corrected in step 4): a Stage's engine is its Role's, then `engineIdOf`, so Stages on both Claude Code engines give one `claude-code` estimate, weighed against one set of caps; the contract's `engineUsageEstimateSchema` carries `engineId`. Chosen in 3b, for the user to review: the history's Task count is the most samples any Agent Stage has; a Stage that never ran adds nothing; a window is estimated only when every Stage on the engine that ran has a change of it, and only on an engine id one of whose engines reads windows (`EngineSessions.capabilitiesOf`, used directly, as Engine never needs Work); cost "no cost" when any Stage that ran has no price; a vacant Role's Stage is left out (Start refuses it anyway); the Planner's tokens are split over the Stages with a person. A Stage's model is its own or else its Role's, as the runner opens it (`stageEngineAndModel`; task 47 replaces it).
- Measures and caps (4): `WorkSettings.usageSettings()` / `changeUsageSettings()` (`domain/usage-settings.ts`: `UsageSettings`, `EngineCaps`, `everyEngineCaps`, `DEFAULT_USAGE_SETTINGS`), kept in `work_settings.usage_measures` (null is the default, tokens and 5-hour) and `engine_caps` (no row is the default: 90% Window caps on `claude-code`, Daily caps off), migration 0072 (`office_wide_limit` now nullable too). `OfficeLimits.usageSettings`/`changeUsageSettings`, `GET`/`PUT /settings/usage` (`UsageSettingsController`), contract `usageSettingsSchema` (each measure once, every engine id once, `windows` present exactly where `engineIdHasUsageWindows`; caps null when off; window 1–100 whole %). `UsageSettingsChanged` releases the queue; not yet a web event (add in 6a for the card's refresh). `hasUsageWindows(engineId)` in Engine's `engines.ts`, mirrored in contracts. The estimate keeps every measure and the ticked list, so 5a/5b weigh caps on the ticked ones.
- Trap for 5b: every scripted session in every test file adds to today's `engine_day_usage`; Work's tests bind their own day's use.
- Window wait (5a): `domain/cap-waits.ts` (`exceededWindowCaps` → `ExceededCap[]` with words and `resetsAt`; `capWaits` applies the hour over every exceeded cap, so 5b adds its Daily caps to the same list; `nextCapRelease`; `withStartedSinceReading`). `StartConditions.usage: UsageAtStart` (`now`, ticked `measures`, this Task's `estimate` per engine id, `windows` per engine id with Window caps the Task's Stages spend on, from `UsageEstimates.engineIdsOf`, so "no estimate" still meets the caps). `capWaitsAtStart` in `task-start.ts`; `releaseQueue` adds each Task it starts to the later ones' windows and returns `capResets`. `StartConditionsReader.ofEach` reads settings and Tasks once per release. Port `AccountWindows` (`UsageWindowState.of(engineId)`), fake `AccountWindowsForTests` (no reading by default). Engine's new `UsageWindowsRead` fires on every reading; `QueueService` then forgets the earlier starts (`StartsSinceReading`, in memory, written by `StartService.start` and each release) and releases; it also releases on `TaskQueued`, which sets the cap timer for a queuing Start, and clears the timer at shutdown.
- Chosen in 5a, for the user to review: "passes" is above the cap, so a Start reaching exactly 90% goes; a Task with no estimate of a window is weighed on the reading's use alone, without the Tasks started since; a window not begun (no `resetsAt`) counts as unused like a passed reset; the Tasks started since a reading are counted from memory, so a restart, which forgets the reading too, forgets them. Wait words: "The Claude Code engines' 5-hour window would pass its 90% cap: 80% used, 6% expected of the Tasks started since it was read and 6% of this Task. It resets at 12:00." (another day: "on Thu 5 Nov at 14:30", the service's clock).
- Trap: tasks.controller.test's history test starts and finishes a real Task for its done id; the fake history answers by the first named done Task it was given usages for.

## Progress

- 2026-11-01 · step 0: wrote the task file, amended spec §2.1, §2.2, §2.7, §3, §4, §5.4 and §8 and the glossary with the user's answers; next, step 1a, the readings through a Stage Thread.
- 2026-11-01 · step 1a: readings with `readAt` and the Office's tokens so far, through `StageThread.usageWindows()` (Engine, Conversations, Pipelines' port); caps reworded per account; next, step 1b, Stage runs keep engine, model and readings.
- 2026-11-01 · step 1b: Stage runs keep engine, model and the windows read as the session opens and after its last turn (migration 0068); a window not begun now counts as unused, judged one at a time; next, step 1c, the day's use per engine and model.
- 2026-11-01 · step 1c: each day's use per engine id and model in `engine_day_usage` (migration 0069), added on every turn's end, `DayUsage.today(engineId)`; caps, readings and day use keyed by engine id via `engineIdOf` (steps 4–6a reworded); next, step 2a, Model prices.
- 2026-11-01 · step 2a: Model prices in `model_prices` (migration 0070) keyed by engine id and model, carried whole by `GET`/`PUT /settings/engines` as every offered model with its price or none; `ModelPrices.costOf(engineId, model, tokens)` exported; next, step 2b, the Prices card.
- 2026-11-01 · step 2b: Settings › Engines' Model prices card, a row of four prices per offered model in the section's one draft, a new API endpoint's priced before Save by contracts' `apiEndpointIdFor` mirror; e2e in `people.e2e.ts`; next, step 3a, the history estimate.
- 2026-11-01 · step 3a: `UsageHistory.of(doneTaskIds)` (each Stage's median tokens and window changes, sample counts) and `ratios(doneTaskIds)` (window % and dollars per token) over the latest 20 done Tasks, in its own `UsageHistoryModule` for Work; next, step 3b, the Planner's estimate and the Task's Usage estimate.
- 2026-11-01 · step 3b: the Planner's `estimatedTokens` on the Plan (migration 0071) through `write_plan` and `PUT /tasks/:id/plan`; the Task's Usage estimate per engine, from history at 3 done Tasks or the Planner's tokens by Office-wide ratios, in the Start check and `GET /usage-estimates`; next, step 4, the measures and caps.
- 2026-11-02 · step 4: the ticked measures and each engine id's caps in `work_settings` and `engine_caps` (migration 0072) through `GET`/`PUT /settings/usage`, whose `UsageSettingsChanged` releases the queue; estimates read the ticked measures and are grouped by engine id, not engine; next, step 5a, the window wait.
- 2026-11-02 · step 5a: Start waits on a ticked Window cap its estimate would pass, with the Tasks started since the reading and the hour's exception (`domain/cap-waits.ts`); the queue releases on Engine's new `UsageWindowsRead`, on `TaskQueued` and on a timer an hour before and at the reset; next, step 5b, the Daily caps.
