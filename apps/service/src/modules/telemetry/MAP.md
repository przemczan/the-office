# Telemetry: module map

**Owns:** Stats (spec [2.11](../../../../../docs/spec/2.11-stats.md), [5.3](../../../../../docs/spec/5.3-modules.md#defaults)), whose Nest module is `StatsModule`, with no table of its own:
- the basic stats (`BasicStats`, `GET /stats/basic`), read afresh on each request from what other modules already keep: the last 30 office days' tokens, the Usage windows now, and this week's top Tasks, Tasks done and Stage retries (pure `domain/basic-stats.ts`: `weekStartOf`, `weekStatsOf`, `countedTokens`);
- the full stats (`FullStats`, `GET /stats/full?range&split&project`), read afresh on each request from the Grafana in use: its state (`GrafanaInUse`: not-on, starting, failed, then unreachable, rejected, no-data or full), tokens and estimated cost over time by the split, the 10 most expensive Tasks (per Stage and per try, each try with the models and engines it ran on) and Initiatives (per Task, with its models and engines, and its own Threads), each engine's Usage windows over time and the lane of the Agent Stage runs that ran (pure `domain/full-stats.ts`: `fullStatsSpanOf`, `stepsOf`, `usageBucketsOf`, `costliestOf`, `windowsOverTimeOf`, `runningOf`, `holdsNoData`);
- System health (`SystemHealth`, `GET /stats/system-health?range`), Office-wide: 1 h from the platform's Health readings whatever the telemetry setting (each reading a point, requests and queries a minute its count × 12), 24 h by 5 min, 7 d by the hour and 30 d by 6 h (UTC, each point's `at` its step's end) from the Grafana in use through `StatsSource.systemHealth`, one Grafana request per block (responsiveness, CPU and memory, requests, database), with the full stats' states (`application/grafana-reads.ts`, shared with `FullStats`); Load now on every range (pure `domain/system-health.ts`);
- Settings › Telemetry's Test of the user's own Grafana (`GrafanaCheck`, `POST /stats/grafana-check`): reachable naming the Prometheus and Loki data sources found, rejected, unreachable with why, or no-data-sources naming Prometheus or Loki, asked afresh through `StatsSource.dataSources`. Its route is here, not with the platform's settings routes, as the platform can't import a module.
The telemetry plumbing every module uses (the exporters, `Telemetry`, the logger, Settings › Telemetry, the bundled Grafana) is not here but in `src/platform/telemetry/`.

**Talks to:** nothing calls it, but its Office tools: `TelemetryOfficeActions` (`adapters/office-actions/`) registers `save_telemetry` (Settings › Telemetry's Save, `PUT /settings/telemetry`; a person's call that gives a header value or a Grafana read token is refused, and the saved ones are kept), `check_grafana` and `start_bundled_grafana` in the Engine's `OfficeToolRegistry`, so `StatsModule`'s `imports` carry the Engine. A person's `check_grafana` goes through `GrafanaCheck.checkAsPerson`, which sends the saved read token only to the saved read address (`GrafanaInUse.savedReadAddress`); the user's route keeps `check`. It reads through its ports, bound in [app.module.ts](../../app.module.ts): `DayTokens` to Notifications' `DayTokenHistory` (`day_tokens`), `EngineWindows` to the Engine's `UsageWindowsNow` (`EngineModels.engines()` with `UsageWindowState`), `StageRunTotals` and `RunningStageRuns` to Pipelines' (from `UsageHistoryModule`: the Stage runs started since a time with their tokens and whether each is a Stage retry; the Agent Stage runs overlapping a range with their engine and Stage name), `StageRunEngines` to Pipelines' `StageRunEngines` (each Stage run of the Tasks named, by number, with its engine's name at the time, the engine it stood in for and its switches, from `stage_runs`), `OfficeTasks` to Work's `TaskService` (`doneSince`, from `task_state_changes`, and `findAll` for titles and Projects), `OfficeInitiatives` to Work's `InitiativeService` (`titlesOf`: name and the Projects its Tasks are in), `ProjectNames` to Projects' `ProjectService` (`namesOf`), and `StatsSource` to the Grafana adapter `GrafanaStatsSource` (`adapters/grafana/`; tests and the e2e service bind `ScriptedStatsSource`, set through `POST /api/e2e/stats-source`). `GrafanaInUse` is bound inside the module to `SettingsGrafanaInUse` (`adapters/platform/`), over the platform's `SavedTelemetrySetting`, `RunningTelemetrySettings` and `BundledGrafanaKeeper.status` from `TelemetryHttpModule`: none while OTEL_* set telemetry; the bundled Grafana at `BUNDLED_GRAFANA_READ_ADDRESS` with no token; or the user's own endpoint's saved Grafana read address with its read token, sent as Bearer, and none when it has no read address. For System health, also bound there: `HealthReadings` to the platform's `SystemHealthRecorder` (`lastHour`), `SessionsRunning` to Conversations' `ThreadService.sessionsWorking` (Threads answering whose person is working, the Live view's rule), `StageRunsRunning` to Pipelines' `StageRunsRunningNow` (Agent and Script Stage runs while their runner runs, counted in memory by the Stage interpreter; a Gate isn't) and `BrowserConnections` to the WebSocket platform's `EventStream.openConnections`. Each port answers the module's own small types; the bound services satisfy them structurally.

**Traps:**
- The saved choice is read on each request, so a saved Grafana read address and token apply at once, without a restart; only the export settings wait for the next start.
- The check asks the data sources afresh, never from `GrafanaDataSourceCache`, and without its fallback uids: an address whose listings answer but not as Grafana does is unreachable ("The answer isn't Grafana's."). A check with no token uses the saved read token, whatever address it is given, as saving does.
- A 403 on `/api/datasources` is a Viewer token, not a refusal; a 403 on `/api/frontend/settings` is the token refused.
- Tokens per day and the Usage windows (now and over time) are Office-wide: the basic stats' Project filter narrows only the top Tasks, Tasks done and Stage retries, through each Task's Project. A run or a done Task whose Task isn't found is left out.
- The top Tasks count Stage runs only (`stage_runs.tokens`), so a Task's planning Thread, a person's own Thread on it and Consultations aren't in it, while the full stats' totals, from what The Office sent Grafana, include every engine call, chats and Consultations too: the basic and full totals aren't meant to match.
- Every count leaves cache reads out (`countedTokens`); tokens per day still gives all four kinds, and a kind of a day below zero (a turn running over midnight) answers 0.
- "This week" starts at `weekStartOf(now)` on The Office's clock (`Schedule.now`): local midnight of the Monday of the calendar day `officeDayOf` reads, so it agrees with "today" across a change of clock. A Stage retry is any run this week whose Stage already had a run on the Task, whenever that one ran.
- An engine without Usage windows answers `none`; the web leaves it out, and the full stats leave it out of the windows over time.
- Task, Initiative and Stage run ids are only in Loki (the `office.engine.call` records), never in the metrics' attributes: the most expensive lists come from the logs, tokens and estimated cost over time from the metrics.
- The full stats' Project filter narrows by the Project's name now (`office.project`), as the metrics and logs carry names: a renamed Project's data from before the rename falls outside it. The lane narrows by each Task's Project id instead. When none of the filter's Projects is known, usage and the most expensive aren't read and answer empty.
- The full stats' buckets are fixed steps in UTC (24 h by the hour, 7 d by 6 h, 30 d by the day; the Usage windows by 15 min, 1 h, 6 h), aligned to the epoch, not office days.
- The first failing read, in the order usage, most expensive, Usage windows, gives the state: unreachable or rejected wins over the reads that answered. No data means no usage point above zero, no Task or Initiative and no Usage window point.
- `office.stage.run` in the `office.engine.call` records is the run's number on its Task, not its id: the most expensive tries are keyed by it, and `costliestOf` matches them to `StageRunEngines` by Task and number. A piece of a try is a Stand-in when its run stood in for another engine and the piece's engine isn't that one. An engine is named by the run's names, then `EngineWindows`' names now, then "Removed engine"; never by its id.
- A Task or Initiative The Office no longer knows is left out of the most expensive lists and the lane, so a list can hold fewer than 10.
- The Prometheus and Loki metric, label and data source names the Grafana adapter reads live only in `adapters/grafana/grafana-queries.ts`, as grafana/otel-lgtm at the pinned image stores what Telemetry sends; on every bump of the pin the Grafana live check (`grafana-stats-source.live.test.ts`, [testing](../../../docs/testing.md#the-grafana-live-check)) confirms them and re-records `recorded/*.json`.
- System health's partial failure: a block whose Grafana request failed goes into `unansweredBlocks` with null figures; all four failing gives the first failure's state, and no block holding data `no-data`. Its 24 h, 7 d and 30 d PromQL reads the names otel-lgtm stores the platform's System health metrics under (`_seconds`, `_bytes`, `_ratio` suffixes); `recorded/system-health-*.json` are written by hand, not yet re-recorded by the live check (the requests' and database's bucket frames by a script, kept to a few rows and bounds). PgInstrumentation sends its own `db_client_connection_pending_requests`, labelled `db_client_connection_pool_name`: the waiting query keeps to the series without that label, The Office's.
- System health's histogram buckets (every route's or table's label set times 15 bounds, several thousand series, sampled every 10 s) are what costs: any PromQL selection of them over 7 d opens every chunk in it (about 2 s whatever the resolution) and reading every raw sample takes 15 s. So each block reads them once (`bucketsQuery`: each step's increase by `le` and row, sampled every quarter step through a subquery one sample longer than the step), and the adapter takes every p95 and Max from that one answer (`histogram-quantile.ts`, PromQL's `histogram_quantile` for classic buckets); never add a query over `_bucket`, nor read them over the whole range. Max is the quantile 1, the highest bucket's bound that counted one: "at most", except that what a counter counted between its last sample and a restart (a reset), at most a quarter step, is missed. Counts and total times stay read raw from `_count` and `_sum`.
- 1 h never asks Grafana, so it answers `read` with telemetry Off; nothing of it is stored.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

GrafanaStatsSource, ScriptedStatsSource, BrowserConnections, HealthReadings, SessionsRunning, StageRunsRunning, StatsSource, StatsModule

## HTTP routes (under `/api`)

- `GET /stats/basic`: StatsController.readBasic
- `GET /stats/full`: StatsController.readFull
- `GET /stats/system-health`: StatsController.readSystemHealth

## Files

### ./

- `stats.module.ts`: StatsModuleOptions, StatsModule

### adapters/grafana/

- `fake-grafana.fixtures.ts`: TakenRequest, FakeAnswer, FakeGrafana, closedPort
- `grafana-data-sources.ts`: GrafanaDataSources, NamedDataSource, GrafanaDataSourceCache, checkDataSources
- `grafana-frames.ts`: dsQueryAnswerSchema, FramePoint, FrameSeries, QueryResults, NOT_GRAFANA, resultsOf, refusalWords, labelOf, lastValueOf
- `grafana-http.ts`: GRAFANA_TIMEOUT_MS, GrafanaHttpAnswer, callGrafana, unansweredWords
- `grafana-queries.ts`: PROMETHEUS_TYPE, LOKI_TYPE, DEFAULT_PROMETHEUS_UID, DEFAULT_LOKI_UID, LABELS, SPLIT_LABELS, REF, DataSourceRef, DsQuery, DsQueryBody, usageQueryBody, windowsQueryBody, costliestTopQueryBody, costliestBreakdownQueryBody, systemHealthQueryBodies, alternatives
- `grafana-scenario.fixtures.ts`: SCENARIO, ScenarioCall, SCENARIO_CALLS, countedTokensOf, RecordedAnswer, RecordingName, recorded, rerecord, recordedRange
- `grafana-stats-source.ts`: GrafanaStatsSource
- `histogram-quantile.ts`: Bucket, boundOf, histogramQuantile
- Tests: grafana-stats-source.full.test.ts, grafana-stats-source.live.test.ts, grafana-stats-source.system-health.test.ts, grafana-stats-source.test.ts, histogram-quantile.test.ts

### adapters/http/

- `stats-responses.ts`: toBasicStatsResponse, toFullStatsResponse, toSystemHealthResponse
- `stats.controller.ts`: StatsController
- `telemetry-office-actions.controller.ts`: TelemetryOfficeActionsController
- Tests: stats.controller.test.ts, telemetry-settings.controller.test.ts

### adapters/office-actions/

- `telemetry-office-actions.ts`: TelemetryCaller, TelemetryOfficeActions
- Tests: telemetry-office-actions.test.ts

### adapters/platform/

- `settings-grafana-in-use.ts`: SettingsGrafanaInUse
- Tests: settings-grafana-in-use.test.ts

### adapters/scripted/

- `scripted-stats-source.ts`: ScriptedStatsFailure, ScriptedStats, ScriptedStatsCall, ScriptedStatsSource

### application/

- `basic-stats.ts`: BasicStatsRead, BasicStats
- `full-stats.ts`: FullStatsQuery, FullStatsFigures, FullStatsRead, FullStats
- `grafana-check.ts`: GrafanaDataSourceKind, GrafanaCheckAnswer, GrafanaCheck
- `grafana-reads.ts`: GrafanaUnread, readFromGrafana, answered, isRead, failedRead
- `system-health.ts`: LoadNow, HealthReadingsRead, SystemHealthRead, SystemHealth
- Tests: full-stats.test.ts, grafana-check.test.ts, system-health.test.ts

### domain/

- `basic-stats.ts`: STATS_DAYS, TOP_TASKS, StatsTokens, StatsProjectFilter, StatsStageRun, StatsTask, TopTask, WeekStats, countedTokens, weekStartOf, weekStatsOf
- `full-stats.ts`: FullStatsRange, FullStatsSplit, Spend, SeriesPoint, NamedSeries, UsageSeries, StageRunSpend, TaskSpend, InitiativeTaskSpend, InitiativeSpend, CostliestSpend, UsageWindowName, WindowSeries, StatsStageRunSpan, StatsInitiative, StatsNamedEngine, StatsStageRunEngines, StatsEngineName, StatsProjectName, COSTLIEST, FullStatsSpan, fullStatsSpanOf, stepStartOf, stepEndOf, stepsOf, UsageBucket, usageBucketsOf, RanOn, REMOVED_ENGINE, StageTry, StageSpend, CostliestTask, CostliestInitiative, CostliestInitiativeTask, Costliest, costliestOf, WindowPoint, WindowsOverTime, StatsEngineWithWindows, windowsOverTimeOf, RunningStageRun, runningOf, holdsNoData
- `system-health.ts`: SystemHealthRange, GrafanaHealthRange, HEALTH_BLOCKS, HealthBlock, HEALTH_READING_STEP_SECONDS, HealthSpan, healthSpanOf, HealthHourReading, SlowestFigures, SlowestRoute, SlowestQuery, HealthHour, ResponsivenessSeries, CpuAndMemorySeries, RequestsSeries, DatabaseSeries, HealthSeries, HealthPoint, HealthFigures, lastHourFiguresOf, grafanaFiguresOf, holdsNoHealthData
- Tests: basic-stats.full.test.ts, basic-stats.test.ts, full-stats.test.ts, system-health.test.ts

### ports/

- `browser-connections.ts`: BrowserConnections
- `day-tokens.ts`: StatsDay, DayTokens
- `engine-windows.ts`: StatsUsageWindow, StatsEngineWindows, StatsEngine, EngineWindows
- `grafana-in-use.ts`: GrafanaNow, GrafanaInUse
- `health-readings.ts`: HealthReadings
- `office-initiatives.ts`: OfficeInitiatives
- `office-tasks.ts`: OfficeTasks
- `project-names.ts`: ProjectNames
- `running-stage-runs.ts`: RunningStageRuns
- `sessions-running.ts`: SessionsRunning
- `stage-run-engines.ts`: StageRunEngines
- `stage-run-totals.ts`: StageRunTotals
- `stage-runs-running.ts`: StageRunsRunning
- `stats-source.ts`: GrafanaAccess, SteppedRange, ProjectNamesFilter, UsageQuery, CostliestQuery, StatsSourceAnswer, HealthSeriesRead, DataSourcesFound, StatsSource
