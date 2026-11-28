# Work: module map

## Owns

- Tasks (states, Kind, priority, Tags, Description, Plan, Definition of Done, Pipeline id, dependencies, Archive mark, commit message, pull request end, History), Ideas, Initiatives (shaping, planning Threads, a Pipeline per Project, Short name, branches, Pause), Attachments (of an Idea, Initiative, Task or Thread).
- Start, the Office-wide queue, Usage estimates, Office limits and engine caps (`work_settings`, `engine_caps`), the fire alarm (`fire_alarm`), Saved views, the full-text search.
- Off-board Tasks (`domain/off-board-task.ts`, `madeFor`): Onboard, Set up the run environment, Set up test targets (no new ones made), Conflict resolution; Publishing Tasks.
- The planner's, shaper's and asking Threads' Briefs and instructions (`WORK_PROMPT_TEMPLATES`), Days, Ways back, Branch cleanup, a Task's and an Initiative's engine override and per-person settings.
- Office actions: `WorkOfficeActions` (`adapters/office-actions/`), its routes derived by `work-office-actions.controller.ts`; `WorkSettingsOfficeActions` for limits and Usage. A new action on a Work record is made this way, never a hand-written route plus tool.

## Talks to

- Pipelines: `StartedTasks` (bound to `TaskService` straight), `TaskGates`→`TaskGateRuns`, `StageResults`→`StageResultWords`, `UsageHistory` (all through `UsageHistoryModule`, never `PipelinesModule`); Pipelines fills `TaskStageEdits`, `TaskEngineChecks`, `TaskStartOvers`; `PipelineInitiatives`→`InitiativeService.withPipelines`; `KnownPipelines`→`PipelineLibrary`.
- Projects: `KnownProjects`→`ProjectService`, `ProjectWorktrees`→`TaskWorktrees`, `TaskPullRequests`→`PullRequestRecords`, `ProjectBranchDeletions`→`BranchDeletions`, `ProjectInitiativeBranches`→`InitiativeBranches`, `NewProjects`→`ProjectsFromRepositories`.
- Projects, filled by Work: `TaskBases`, `IssueTasks`, `TestTargetsSetUpTasks`; Work forwards to `IssueWriteBack` and listens to `PullRequestMerged/Closed/Reopened` (`PullRequestOutcomes`).
- People: `KnownPeople`→`RoleCards` (`holderOf`, `dutyHolders`), `KnownEngineCascade`→`EngineCascade`; registers on `AvatarSources`; People reads the overrides through `WorkEngineLevelsModule` (database only).
- Conversations: `SessionPeople`/`SessionTasks`/`SessionInitiatives`→`SessionThreads`, `TaskThreads`/`InitiativeThreads`→`WorkThreads`, `ThreadTurns`→`ConversationsThreadTurns` (in memory), `IdeaCards`→`ThreadCards`, `TaskDecisions`→`DecisionService`, `ProposalDrafts`→`ProposalService`.
- Conversations, filled by Work: `ProposalAppliers` (Bug Tasks, Office limit, Projects, Initiatives), `MessageImages`, `FireAlarmInThreads`, `WorkRecords`.
- Engine: `AccountWindows`→`UsageWindowState`, `DayUsage`, `ModelPrices`, `AccountWindowRatios`→`UsageWindowSamples`, `EngineModels`, `EngineReferenceLock`, `EngineSettingsChecks`, `officeActionTool`; import `engineThroughStandIns` and `engineToRunOn` from Engine's index only.
- Notifications: `DayOutcomes`→`DayFigures` (`DayFiguresModule`), and it reads the alarm through `FireAlarmService.read`. Busy work: `ScheduledExitHold` is a Start wait. Devices: the `TaskConnectedDevices` registry. Activity: `OnboardingService`.
- The bindings are in [app.module.ts](../../app.module.ts); `office.ts` starts archiving, `DroppedInitiativeTasks`, `DroppedTaskDecisions.closeLeftOpen`, `PlanningAfterRestart`, `UsageWindowResumes`, Branch cleanup and the first queue release.

## Traps

- Never run git inside a database hold: `InitiativeBranching` makes branches first, judges in the hold and removes what it made on failure (`KeyedLocks`); Projects uses `createRef`, never `setRef`. `holdsUnpublished` too runs before the hold.
- Hold order: the Initiative's row, then dependencies, then Task rows in id order (`updateWithTasks`, `changeDependencies`, `changeTask`); deadlocks run again through the platform's `retriedTransaction`.
- Start, every release and every queue change hold Starts (`holdStarts`); the fire alarm is read in that hold on its own transaction (`heldFireAlarm`, `FOR SHARE`), never a second pooled connection.
- Dependency changes take one lock and read every Task (`TaskRepository.changeDependencies`, `changeEveryDependency`); never `update` for them, or two changes close a cycle.
- Moves outside `NEXT_STATES` (Shaping→Backlog by Confirm, Ready→Planning by a changing Save) ride on the saved event as `leftReady`. Nothing may assume a Ready Task was planned, has a worktree or a planning Thread, or has both parts written.
- `task_state_changes` is written only from a `TaskChange`'s `stateChange` (`saveTask`, `insertTask`, `saveStarted`): a new way to change a Task saves through them. Move reads the planning history from it, never the state.
- `pausedBy` (`alarm`, `initiative`, `usage-window`) and `madeFor` are single fields, never flags. `resumeTaskAtReset` is a no-op once a Task is no longer paused by the window, as the reset and the early resume race.
- `firstAgentStage` must count a Stage naming only a duty; read duties with `withDutiesHeld` (one `dutyHolders` read).
- Search: a field and the query split alike (`search-vector.ts`, `searchWords`), so change both. `attachment_texts` keeps documents' text; files from before migration 0114 are judged at start (`onApplicationBootstrap`).
- Replacing a file: `AttachmentFiles.replace` keeps `<id>.previous` until the row is updated, one Task at a time; the content route answers `Cache-Control: no-cache`. An HTML file shows only under the sandboxing CSP.
- Shared test state: `work_settings`, `engine_caps`, the queue and the fire alarm's row are shared by every test file. Override with `WorkSettingsForTests`, `AccountWindowsForTests`, `DayUsageForTests`, `TaskTokensForTests`, `FireAlarmRepositoryForTests`, `ownProjectsQueue`; only three test files queue Tasks, and drop them after. Short names are Office-wide, so tests give unique titles.
- `WorkPortsForTestsModule` fakes `UsageHistory`, `ModelPrices` and `AccountWindowRatios`, so no test reads `stage_runs`; `TaskBasesForTests` stands in for Projects' `TaskBases`; test apps register `START_OVER_WORK_FOR_TESTS`. `TaskArchiving` never starts in a test app.
- `TaskStageEdits` throws while nothing is registered; `startWorkApplication` registers a lookup answering none.
- Everything that weighs a Start (`startReasons`, `startTask`, `releaseQueue`, `StartsSinceReading.record`) goes through `usageOnStandIns`; a release uses one `UsageEstimates.estimator`; `StartConditions.ofEach` reads nothing for no queued Task.
- A Task of an Initiative with a Pipeline never falls back to the base branch: `taskBranchBase` refuses without the branch. A Publishing Task's branch is the Initiative's; never name `office/<task>` for it. `tasks_open_publishing_task_per_project` catches racing settles.
- Prompt template texts load at use time (`PromptTemplates.textsOf`), never in a constructor; records go into a template whole as values. `work-prompts.golden.ts` is never edited to pass a test, only regenerated for a deliberate text change.
- Repositories' `find` goes through the platform's `readOnce` (the same objects within a GET: never change them); every write runs through `forgettingReads`.
- `TaskRepository.list()` reads every Task whole, for the cycle checks only; add a targeted query rather than filtering it.
- Authors are `{ kind: "user", user: UserRef | null }`; jsonb may hold `{kind:"user"}` with no key, so read through `authorOf`/`causeOf` (`work-rows.ts`).
- Rollback: the old `planning_thread_id(s)` and `planning_*` columns and `tasks.model` are still written for the previous release (`toInitiativeRow`, `taskRowUpdate`); keep writing them.
- An engine override's save reads, checks and writes under `EngineReferenceLock`, and publishes after.
- Ways back, Resume, Restart from… and Drops run under the shared `TaskLocks` (`TaskLocksModule`); an Initiative's Drop or Pause takes every Task's lock (`runAll`).
- `dropTask` refuses a person's Drop of a started Task, and Pipelines' `StaffingHolds` drops as a person.
- The office day comes from `platform/office-day.ts`, never a copy; `DayFiguresModule` doesn't import Work.
- Projects can't ask Work (the Nest modules would import each other), so Work serves `GET /onboardings`.
- Recording a pull request's end is idempotent by outcome and number.

## Spec

- [2.1 Work](../../../../../docs/spec/2.1-work.md), [2.1.2 Ideas and Attachments](../../../../../docs/spec/2.1.2-ideas-and-attachments.md), [2.1.3 Tasks](../../../../../docs/spec/2.1.3-tasks.md)
- [2.1.4 Initiatives](../../../../../docs/spec/2.1.4-initiatives.md), [2.1.5 Planning and Start](../../../../../docs/spec/2.1.5-planning-and-start.md), [2.1.6 Board and search](../../../../../docs/spec/2.1.6-board-and-search.md)
- [2.8 Fire alarm](../../../../../docs/spec/2.8-fire-alarm.md), [5.4.5 Engines and cascade](../../../../../docs/spec/5.4.5-engines-and-cascade.md), [5.4.6 Stand-in Engines](../../../../../docs/spec/5.4.6-stand-in-engines-and-usage-windows.md), [5.5 Git and isolation](../../../../../docs/spec/5.5-git-and-isolation.md), [6 Permissions](../../../../../docs/spec/6-permissions-and-safety.md)

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

FireAlarmService, IdeaService, InitiativeService, InitiativeArchiving, BranchCleanup, DroppedInitiativeTasks, DroppedTaskDecisions, PlanningAfterRestart, OfficeLimits, OffBoardTaskReader, OffBoardTasks, OnboardingService, isOffBoardTask, OffBoardTask, OffBoardTaskKind, OffBoardTaskStart, OffBoardTaskStatus, ProjectOffBoardTasks, toOffBoardTaskResponse, toOffBoardTaskStartResponse, toProjectOffBoardTasksResponse, QueueService, RunEnvironmentSetUps, StageScreenshots, TaskArchiving, connectedDeviceLine, TaskConnectedDevices, TaskConnectedDevice, TaskConnectedDevicesLister, TaskRecords, EngineStandIn, TaskStageEdits, TaskStageEditLookup, TaskStartOvers, StartOverWork, StartedOverWork, StartingOverUser, TaskEngineChecks, TaskEngineChange, TaskEngineCheck, TaskEngineLevels, TaskEngineMove, TaskService, WorkEngineLevels, ConversationsThreadTurns, WorkEngineLevelsModule, UsageWindowResumes, AttachmentAdded, AttachmentMoved, AttachmentRemoved, AttachmentReplaced, IdeaCaptured, IdeaDropped, IdeaRestored, IdeaShaped, IdeaShapedIntoInitiative, AlarmSounded, AllClearGiven, InitiativeCreated, InitiativeStateChanged, InitiativeNotFound, initiativeBranchOf, OfficeWideLimitChanged, UsageSettingsChanged, TaskLeftQueue, TaskMovedUpInQueue, TaskQueued, TaskQueueReasonsChanged, TaskAddedToInitiative, TaskCreated, TaskDiscarded, TaskDefinitionOfDoneConfirmed, TaskDefinitionOfDoneProposed, TaskDefinitionOfDoneSaved, TaskDependencyRemoved, TaskPaused, UsageWindowRefusal, TaskPipelineConfirmed, TaskMovedToProject, TaskPipelineProposed, TaskPlanConfirmed, TaskPlanProposed, TaskPlanSaved, TaskPriorityChanged, TaskTagsChanged, TaskReopened, TaskReordered, TaskResumed, TaskStarted, TaskStartedOver, TaskStateChanged, TaskStopped, TaskTakenOutOfInitiative, TaskWentOnOnStandIn, TaskRefused, LEFT_THE_WORKSTATION, STARTED_STATES, TASK_STATE_NAMES, WorkModule, TaskLocks, TaskLocksModule

## Domain events

- `domain/attachment-events.ts`: AttachmentAdded, AttachmentReplaced, AttachmentMoved, AttachmentRemoved
- `domain/fire-alarm-events.ts`: AlarmSounded, AllClearGiven
- `domain/idea-events.ts`: IdeaCaptured, IdeaEdited, IdeaShaped, IdeaShapedIntoInitiative, IdeaDropped, IdeaRestored
- `domain/initiative-events.ts`: InitiativeCreated, InitiativeStateChanged, InitiativeBranchDeleted, InitiativeArchived, InitiativeRestored, InitiativeOutcomeWritten, InitiativePipelineChosen, InitiativePipelinesSet, InitiativeEngineOverrideSet, InitiativeShortNameWritten, InitiativeBranchMade, InitiativePaused, InitiativeResumed, InitiativePlanningStarted
- `domain/office-limit-events.ts`: OfficeWideLimitChanged, ArchivePeriodChanged, UsageSettingsChanged
- `domain/queue-events.ts`: TaskQueued, TaskLeftQueue, TaskQueueReasonsChanged, TaskMovedUpInQueue
- `domain/saved-view-events.ts`: SavedViewSaved, SavedViewRemoved
- `domain/task-events.ts`: TaskCreated, TaskDiscarded, TaskStateChanged, TaskArchived, TaskRestored, TaskPriorityChanged, TaskTitleChanged, TaskKindChanged, TaskEngineOverrideSet, TaskInitiativeEngineOverrideChanged, TaskBugDetailsChanged, TaskDescriptionChanged, TaskCommitMessageChanged, TaskBranchDeleted, TaskPullRequestEnded, TaskPullRequestReopened, TaskTagsChanged, TaskReordered, TaskPlanProposed, TaskPlanSaved, TaskMovedToProject, TaskPlanConfirmed, TaskDefinitionOfDoneProposed, TaskDefinitionOfDoneSaved, TaskDefinitionOfDoneConfirmed, TaskPipelineProposed, TaskPipelineConfirmed, TaskMarkedPlanned, TaskAcceptedInAutoMode, TaskMarkedReadyAsItStands, TaskRewrittenInInitiative, TaskPaused, TaskStopped, TaskHeldAtAllClear, TaskResumed, TaskWentOnOnStandIn, TaskDependencyAdded, TaskDependencyRemoved, TaskAddedToInitiative, TaskTakenOutOfInitiative, TaskStarted, TaskStartedOver, TaskReopened

## HTTP routes (under `/api`)

- `GET /settings/archive-period`: ArchivePeriodController.read
- `GET /ideas/:id/attachments`: AttachmentsController.listOfIdea
- `GET /initiatives/:id/attachments`: AttachmentsController.listOfInitiative
- `GET /tasks/:id/attachments`: AttachmentsController.listOfTask
- `POST /ideas/:id/attachments/links`: AttachmentsController.addLinkToIdea
- `POST /initiatives/:id/attachments/links`: AttachmentsController.addLinkToInitiative
- `GET /attachments/:id/content`: AttachmentsController.content
- `DELETE /attachments/:id`: AttachmentsController.remove
- `GET /settings/auto-mode`: AutoModeController.read
- `GET /tasks/:id/branch`: BranchDeletionsController.taskBranch
- `GET /tasks/:id/branch-deletion`: BranchDeletionsController.taskPreview
- `POST /tasks/:id/branch-deletion`: BranchDeletionsController.deleteTaskBranch
- `GET /initiatives/:id/branches`: BranchDeletionsController.initiativeBranches
- `GET /initiatives/:id/projects/:projectId/branch-deletion`: BranchDeletionsController.initiativePreview
- `POST /initiatives/:id/projects/:projectId/branch-deletion`: BranchDeletionsController.deleteInitiativeBranch
- `GET /days/:day`: DaysController.read
- `GET /fire-alarm`: FireAlarmController.read
- `POST /fire-alarm/all-clear`: FireAlarmController.allClear
- `POST /ideas`: IdeasController.capture
- `GET /ideas`: IdeasController.list
- `GET /ideas/:id`: IdeasController.read
- `GET /ideas/:id/history`: IdeasController.history
- `GET /initiatives`: InitiativesController.list
- `GET /initiatives/archived`: InitiativesController.archived
- `GET /initiatives/:id`: InitiativesController.read
- `GET /initiatives/:id/history`: InitiativesController.history
- `PUT /initiatives/:id/pipelines`: InitiativesController.setPipelines
- `POST /initiatives/:id/shaping`: InitiativesController.shape
- `POST /initiatives/:id/planning`: InitiativesController.plan
- `POST /initiatives/:id/plan-with`: InitiativesController.planWith
- `GET /projects/:id/off-board-tasks`: OffBoardTasksController.ofProject
- `GET /settings/office-wide-limit`: OfficeLimitsController.read
- `GET /onboardings`: OnboardingsController.list
- `GET /roles/:roleKey/tasks`: PersonTasksController.list
- `GET /queue`: QueueController.list
- `GET /saved-views`: SavedViewsController.list
- `GET /search`: SearchController.everything
- `POST /tasks`: TasksController.create
- `GET /tasks`: TasksController.list
- `GET /tasks/:id`: TasksController.read
- `GET /tasks/:id/history`: TasksController.history
- `PUT /tasks/:id/caused-by`: TasksController.changeCausedBy
- `PUT /tasks/:id/found-in-version`: TasksController.changeFoundInVersion
- `PUT /tasks/:id/tags`: TasksController.changeTags
- `GET /tasks/:id/readiness`: TasksController.readiness
- `GET /tasks/:id/start`: TasksController.startCheck
- `GET /tasks/:id/ways-back`: TasksController.waysBackOf
- `GET /tasks/:id/move`: TasksController.moveCheck
- `GET /projects/:id/test-targets/set-up-task`: TestTargetsSetUpsController.read
- `GET /usage-estimates`: UsageEstimatesController.list
- `GET /settings/usage`: UsageSettingsController.read

## Tables

- `adapters/postgres/fire-alarm.schema.ts`: fire_alarm
- `adapters/postgres/queue.schema.ts`: queue
- `adapters/postgres/saved-views.schema.ts`: saved_views
- `adapters/postgres/work-settings.schema.ts`: work_settings, engine_caps
- `adapters/postgres/work.schema.ts`: ideas, initiatives, initiative_planning_threads, tasks, task_state_changes, record_edits, attachments, attachment_texts

## Files

### ./

- `attachments.controller.fixtures.ts`: attachmentsHttp
- `index.fixtures.ts`: ownProjectsQueue, workModuleForTests
- `initiatives.controller.fixtures.ts`: aProjectId, initiativesHttp
- `search.controller.fixtures.ts`: NONE_IN_OTHER_PROJECTS, searchHttp
- `task-locks.module.ts`: TaskLocksModule
- `task-thread-records.fixtures.ts`: aPersonsThread, taskThreads
- `tasks.controller.fixtures.ts`: TasksHttpTest, MY_PLAN, nothing, blockedBy, HOUR, MANY_REQUESTS_TEST_MS, tasksHttp
- `work-application.fixtures.ts`: WorkApplication, startWorkApplication, START_OVER_WORK_FOR_TESTS, workModuleForTests, webEventsOf, sendJson
- `work-engine-levels.module.ts`: WorkEngineLevelsModule
- `work.module.ts`: WorkModuleOptions, WorkModule

### adapters/conversations/

- `bug-task-proposals.ts`: BugTaskProposals
- `calling-rule.ts`: withCallingRule
- `conversations-thread-turns.ts`: ConversationsThreadTurns
- `fire-alarm-for-threads.ts`: FireAlarmForThreads
- `initiative-branch-reads.ts`: initiativeBranchReads
- `initiative-proposals.ts`: InitiativeProposals
- `initiative-thread-records.ts`: SHAPING_OFFICE_TOOLS, INITIATIVE_PLANNING_OFFICE_TOOLS, InitiativeThreadRecords
- `mentioned-work-records.ts`: MentionedWorkRecords
- `office-limit-proposals.ts`: OfficeLimitProposals
- `project-proposals.ts`: ProjectProposals
- `task-thread-records.ts`: PLANNING_OFFICE_TOOLS, TaskThreadRecords
- `thread-message-images.ts`: ThreadMessageImages
- Tests: bug-task-proposals.test.ts, fire-alarm-for-threads.test.ts, initiative-proposals.full.test.ts, initiative-thread-records.full.test.ts, mentioned-work-records.full.test.ts, office-limit-proposals.full.test.ts, task-thread-records.full.test.ts, task-thread-records.test.ts, thread-message-images.test.ts

### adapters/filesystem/

- `filesystem-attachment-files.ts`: FilesystemAttachmentFiles
- `worktree-files.ts`: readWorktreeFile, FilesystemWorktreeFiles
- Tests: filesystem-attachment-files.full.test.ts

### adapters/http/

- `archive-period.controller.ts`: ArchivePeriodController
- `attachments.controller.ts`: ATTACHMENT_UPLOAD_ROUTES, AttachmentsController
- `auto-mode.controller.ts`: AutoModeController
- `branch-deletions.controller.ts`: BranchDeletionsController
- `day-summary-response.ts`: toDaySummaryResponse
- `days.controller.ts`: DaysController
- `fire-alarm.controller.ts`: FireAlarmController
- `ideas.controller.ts`: IdeasController
- `initiative-response.ts`: initiativeResponse, readyTasksStartedResponse, initiativePauseResponse
- `initiatives.controller.ts`: InitiativesController
- `off-board-task-responses.ts`: toOffBoardTaskResponse, toProjectOffBoardTasksResponse, toOffBoardTaskStartResponse
- `off-board-tasks.controller.ts`: OffBoardTasksController
- `office-limits.controller.ts`: OfficeLimitsController
- `onboardings.controller.ts`: OnboardingsController
- `person-tasks.controller.ts`: PersonTasksController
- `queue.controller.ts`: QueueController
- `saved-views.controller.ts`: SavedViewsController
- `search.controller.ts`: SearchController
- `searched-query.ts`: searchedQuery
- `signed-in-author.ts`: authorOf
- `task-responses.ts`: TaskResponses
- `tasks.controller.ts`: TasksController
- `test-targets-set-ups.controller.ts`: TestTargetsSetUpsController
- `usage-estimates.controller.ts`: UsageEstimatesController
- `usage-settings.controller.ts`: UsageSettingsController
- `work-office-actions.controller.ts`: WorkOfficeActionsController
- `work-refusals.filter.ts`: WorkRefusalsFilter
- `work-responses.ts`: toIdeaResponse, toInitiativeResponse, toArchivedInitiativesPageResponse, toTaskResponse, toTaskSummaryResponse, toPullRequestEndedByResponse, toAttachmentResponse, toSearchResultsResponse, toOwnerResponse, toSavedViewResponse, toQueueResponse, toUsageEstimateResponse, toUsageSettingsResponse, toHistoryResponse, toFireAlarmResponse
- `work-settings-office-actions.controller.ts`: WorkSettingsOfficeActionsController
- Tests: attachments.controller.full.test.ts, attachments.controller.test.ts, codex-usage.controller.test.ts, days.controller.test.ts, ideas.controller.full.test.ts, ideas.controller.test.ts, initiatives.controller.full.test.ts, initiatives.controller.test.ts, office-limits.controller.test.ts, person-tasks.controller.test.ts, records-name-the-user.test.ts, saved-views.controller.full.test.ts, saved-views.controller.test.ts, search.controller.full.test.ts, search.controller.test.ts, task-kinds.controller.test.ts, task-walks.full.test.ts, task-walks.test.ts, task-ways-back.controller.test.ts, tasks.controller.full.test.ts, tasks.controller.test.ts, test-targets-set-ups.controller.test.ts, usage-settings.controller.full.test.ts, usage-settings.controller.test.ts, usage-window-pause.controller.test.ts, work-engine.controller.test.ts

### adapters/office-actions/

- `work-office-actions.ts`: WorkOfficeActions
- `work-settings-office-actions.ts`: WorkSettingsOfficeActions
- `work-subject-snapshots.ts`: WorkSubjectSnapshots
- Tests: moving-work-office-actions.test.ts, work-office-actions.test.ts, work-settings-office-actions.test.ts

### adapters/office-tools/

- `attachment-office-tools.ts`: ATTACH_FILE, AttachmentOfficeTools, attachedWords
- `onboarding-office-tools.ts`: OnboardingOfficeTools
- `planning-office-tools.ts`: START_PLANNING, WRITE_PLAN, WRITE_DEFINITION_OF_DONE, PROPOSE_PIPELINE, WRITE_TAGS, MARK_PLANNED, WRITE_KIND, WRITE_BUG_DETAILS, PlanningOfficeTools
- `shaping-office-tools.ts`: READ_INITIATIVE, ShapingOfficeTools
- `work-office-tools.ts`: LIST_TASKS, READ_TASK, LIST_IDEAS, READ_IDEA, READ_ATTACHMENT, CREATE_TASK, CREATE_INITIATIVE, ATTACHMENT_ANSWER_BUDGET, WorkOfficeTools
- `work-tool-answers.ts`: OfficeToolResult, WorkToolRefused, answered, refusalOf, personInSession
- Tests: attachment-office-tools.full.test.ts, attachment-office-tools.test.ts, choose-pipeline.test.ts, onboarding-office-tools.full.test.ts, planning-office-tools.full.test.ts, shaping-office-tools.full.test.ts, work-office-tools.full.test.ts

### adapters/pdf/

- `pdf.fixtures.ts`: aPdf
- `unpdf-pdf-pages.ts`: UnpdfPdfPages

### adapters/people/

- `avatar-source-from-work.ts`: AvatarSourceFromWork
- `memory-task-title-source.ts`: MemoryTaskTitleSourceFromWork
- `work-engine-levels.ts`: WorkEngineLevels

### adapters/postgres/

- `board-order.ts`: BoardOrderColumns, boardOrderOf
- `fire-alarm.schema.ts`: fireAlarm
- `id-prefix.ts`: idStartingWith
- `postgres-attachment-repository.ts`: PostgresAttachmentRepository
- `postgres-day-records.ts`: PostgresDayRecords
- `postgres-fire-alarm-repository.ts`: PostgresFireAlarmRepository, heldFireAlarm
- `postgres-idea-repository.ts`: PostgresIdeaRepository
- `postgres-initiative-repository.ts`: PostgresInitiativeRepository
- `postgres-queue-repository.fixtures.ts`: OwnProjectsQueueRepository, ownProjectsQueue
- `postgres-queue-repository.ts`: PostgresQueueRepository
- `postgres-record-edits.ts`: PostgresRecordEdits
- `postgres-saved-view-repository.ts`: PostgresSavedViewRepository
- `postgres-task-repository.ts`: PostgresTaskRepository
- `postgres-work-repositories.fixtures.ts`: WorkRepositories, startWorkRepositories, aProjectId, workRecords
- `postgres-work-search.ts`: initiativeVector, PostgresWorkSearch
- `postgres-work-settings.ts`: PostgresWorkSettings
- `queue.schema.ts`: queue
- `saved-views.schema.ts`: savedViews
- `search-vector.ts`: searchVectorOf, TaskSearchColumns, taskSearchVector, matching, bestFirst
- `work-earlier-records.ts`: WorkEarlierRecords
- `work-rows.ts`: Transaction, IdeaRow, InitiativeRow, InitiativeRowWithThreads, initiativeColumns, savePlanningThreads, TaskRow, AttachmentRow, canBeRowId, holdManualOrder, holdShortNames, holdStarts, everyTaskHoldingDependencies, changeDependenciesHeld, changeEveryDependencyHeld, heldTask, saveTask, insertTask, keepStateChange, keepEdits, editsOf, stateChangesOf, authorOf, takenOrders, toIdeaRow, toIdea, toInitiativeRow, toInitiative, toTaskRow, WrittenTaskRow, WrittenInitiativeRow, taskRowUpdate, initiativeRowUpdate, toTask, TaskSummaryRow, TASK_SUMMARY_COLUMNS, toTaskSummary, ownerColumns, toAttachmentRow, toAttachment
- `work-settings.schema.ts`: workSettings, engineCaps
- `work.schema.ts`: AuthorRow, StateChangeCauseRow, ProjectMoveRow, PullRequestEndRow, BranchDeletionRow, ideas, InitiativePipelineRow, InitiativeBranchRow, initiatives, initiativePlanningThreads, tasks, taskStateChanges, recordEdits, attachments, attachmentTexts
- Tests: initiative-pipeline-per-project-migration.test.ts, initiative-planning-threads-migration.test.ts, initiative-planning-threads-table-migration.test.ts, initiative-planning-with-user-migration.test.ts, paused-by-migration.test.ts, postgres-task-repository.full.test.ts, postgres-task-repository.test.ts, postgres-work-repositories.full.test.ts, postgres-work-repositories.test.ts, task-kinds-migration.test.ts, work-earlier-records.test.ts

### adapters/projects/

- `issue-write-back-forwarding.ts`: IssueWriteBackForwarding
- `projects-issue-task-registration.ts`: ProjectsIssueTaskRegistration
- `projects-task-base-registration.ts`: ProjectsTaskBaseRegistration
- `projects-test-targets-set-up-task-registration.ts`: ProjectsTestTargetsSetUpTaskRegistration
- Tests: projects-task-base-registration.test.ts

### adapters/prompt-templates/

- `work-prompt-templates-registration.ts`: WorkPromptTemplates
- Tests: work-prompt-templates-registration.test.ts, work-prompt-templates-saved.test.ts

### adapters/websocket/

- `work-web-events.ts`: WorkWebEvents

### adapters/zip/

- `yauzl-zip-files.ts`: YauzlZipFiles
- `zip.fixtures.ts`: aZip

### application/

- `attachment-service.ts`: UploadedFile, WorktreeUpload, WorktreeAttaching, OpenedFile, Picture, ZipEntryRead, AttachmentService
- `branch-cleanup.ts`: BRANCH_CLEANUP, BRANCH_CLEANUP_EVERY_MS, KnownBranch, BranchCleanup
- `conflict-resolutions.ts`: ConflictResolution, ConflictResolutions
- `daily-caps.ts`: DailyCaps
- `day-summary.ts`: DaySummary, DaySummaries
- `dependency-events.ts`: publishDependencyChanges
- `dropped-initiative-tasks.ts`: ITS_INITIATIVE_WAS_DROPPED, DroppedInitiativeTasks
- `dropped-task-decisions.ts`: DroppedTaskDecisions
- `duty-holders.ts`: withDutiesHeld
- `engine-override-choice.ts`: engineOverrideProblems, taskPeopleProblems
- `fire-alarm-service.ts`: FireAlarmService, AllClearChoices
- `idea-records.ts`: IdeaRecords
- `idea-service.ts`: IdeaService
- `initiative-archiving.ts`: INITIATIVE_ARCHIVING, InitiativeArchiving
- `initiative-branching.ts`: InitiativeBranching
- `initiative-membership.ts`: InitiativeMembership
- `initiative-pause.ts`: InitiativePauseOutcome, InitiativePause
- `initiative-planning.ts`: InitiativePlanning
- `initiative-service.ts`: PipelinesBlockChoice, InitiativeOnPipeline, ShapingThreadOpening, InitiativeService
- `initiative-start.ts`: QueuedInRun, RefusedInRun, ReadyTasksStarted, InitiativeStart
- `initiative-task-locks.ts`: holdingTheInitiativesTasks
- `off-board-task-reader.ts`: OffBoardTaskReader
- `off-board-tasks.ts`: OffBoardTasks
- `office-limits.ts`: OfficeLimits
- `onboarding-service.ts`: OnboardingService
- `person-tasks.ts`: PersonTask, PersonTaskPage, PersonTasksRequest, PersonTasks
- `pipeline-choice.ts`: pipelineChoiceIn
- `planning-after-restart.ts`: PlanningAfterRestart
- `planning-service.ts`: PlanningThread, MarkedPlanned, PlanningService
- `pull-request-outcomes.ts`: PullRequestOutcomes
- `queue-service.ts`: QueueService
- `removed-engine-caps.ts`: RemovedEngineCaps
- `run-environment-set-ups.ts`: RunEnvironmentSetUps
- `saved-view-service.ts`: SavedViewService
- `search-service.ts`: Found, InOtherProjects, SearchResults, SearchService
- `stage-screenshots.ts`: ScreenshotsAttaching, StageScreenshots
- `start-conditions.ts`: StartConditionsReader
- `start-service.ts`: StartCheck, StartChoices, StartService
- `starts-since-reading.ts`: StartsSinceReading
- `task-archiving.ts`: TASK_ARCHIVING, TaskArchiving
- `task-connected-devices.ts`: TaskConnectedDevice, TaskConnectedDevicesLister, connectedDeviceLine, TaskConnectedDevices
- `task-engine-checks.ts`: TaskEngineCheck, TaskEngineChecks, pipelineChoiceProblems, TaskEngineChange, TaskEngineLevels, TaskEngineMove
- `task-locks.ts`: TaskLocks
- `task-records.ts`: TaskRecord, TaskRecords
- `task-service.ts`: TaskDependencyLinks, TaskService
- `task-stage-edits.ts`: TaskStageEditLookup, TaskStageEdits
- `task-start-overs.ts`: StartingOverUser, StartedOverWork, StartOverWork, TaskStartOvers
- `task-ways-back.ts`: TaskWaysBackAnswer, TaskWaysBack
- `test-targets-set-ups.ts`: TestTargetsSetUps
- `usage-estimates.ts`: TaskUsageEstimate, TaskEstimator, UsageEstimates, TaskCascade
- `usage-window-resumes.ts`: UsageWindowResumes
- `work-engine-level-moves.ts`: WorkEngineLevelMoves
- Tests: branch-cleanup.test.ts, conflict-resolutions.test.ts, dropped-task-decisions.test.ts, fire-alarm-test-project-check.test.ts, initiative-archiving.full.test.ts, initiative-pipeline-test-project-check.test.ts, initiative-planning.test.ts, initiative-service.test.ts, off-board-tasks.test.ts, planning-after-restart.test.ts, planning-test-project-check.test.ts, publishing-tasks.test.ts, pull-request-outcomes.full.test.ts, pull-request-outcomes.test.ts, removed-engine-caps.full.test.ts, run-environment-set-ups.full.test.ts, shaping-with-the-cto.full.test.ts, stage-screenshots.test.ts, starts-since-reading.full.test.ts, task-archiving.full.test.ts, task-connected-devices.test.ts, task-records.full.test.ts, task-service.test.ts, task-ways-back.test.ts, test-project-check.test.ts

### domain/

- `asking.ts`: askingInstructions, AskingRecord, askingBrief
- `attachment-changes.ts`: AttachmentChange, Adding, addLink, addFile, attachmentToReplace, replaceFile, moveAttachment, removeAttachment
- `attachment-events.ts`: AttachmentAdded, AttachmentReplaced, AttachmentMoved, AttachmentRemoved
- `attachment-not-found.ts`: AttachmentNotFound
- `attachment-refused.ts`: AttachmentRefused
- `attachment.ts`: AttachmentOwner, Attachment, AttachmentKind, NewFile, NewLink, ATTACHMENT_SIZE_LIMIT, SCREENSHOT_SIZE_LIMIT, mediaTypeOf, storedFileKind, isText, isTextFile, isPdf, StoredFileAttachment, isZip, FileReading, fileReadingOf, ZipEntry, ZipEntryReading, zipEntryReadingOf, zipEntryLine, HOW_TO_READ_ATTACHMENTS, attachmentLines, attachmentKindWords, trimmedNewLink, newLinkProblems, newFileProblems
- `author.ts`: UserRef, Author, userBehind, byTheUser, byThePerson, authorWords, ArchivedBy, BY_THE_DAILY_RUN, archivedByWords
- `branch-deletion.ts`: BranchDeletedBy, BY_DELETE_MERGED_BRANCHES, DeletedBranchCopy, BranchDeletionRecord, recordTaskBranchDeletion, recordInitiativeBranchDeletion, branchDeletionWords, taskBranchOf, taskIdOfBranch, shortNameOfBranch, initiativeBranchOfTask, taskBranchDeletionRefusal, initiativeBranchDeletionRefusal
- `cap-waits.ts`: PROMPT_CACHE_HOUR, WindowReading, AccountWindowsReading, UsedUpWindowReading, UsedUpAtStart, WindowsAtStart, DayUse, NO_DAY_USE, DailyCapsAtStart, UsageAtStart, ExceededCap, CapWaits, NO_CAP_WAITS, capWaits, startWaitsForUsage, usedUpWindows, exceededCaps, exceededWindowCaps, exceededDailyCaps, withStarted, windowsWithStarted, dailyWithStarted, dayUseOf, plusDayUse, leftOfEstimate, nextMidnight, nextCapRelease, resetWords, shortResetWords
- `conflict-resolution.ts`: RESOLVE_CONFLICTS_PIPELINE, ConflictingPullRequest, conflictResolutionTitle, conflictResolutionDescription, conflictResolutionPlan, conflictResolutionDefinitionOfDone, createConflictResolutionTask, isOpenConflictResolution
- `day-summary.ts`: DayInitiative, DayTaskDone, DayPullRequestMerged, DayFailedOrDropped, DayIdea, DayTaskStarted, DayFacts, DayGroups, taskDoneOf, groupDay
- `drop-reason.ts`: DropReason, DropReasonKind, MAX_DROP_REASON_TEXT, keptDropReason, dropReasonProblems
- `duties.ts`: SHAPES_INITIATIVES, PLANS, NOBODY_SHAPES_INITIATIVES, NOBODY_PLANS
- `files-to-change.ts`: normalizedFilesToChange, filesToChangeProblems, covers
- `fire-alarm-events.ts`: AlarmSounded, AllClearGiven
- `fire-alarm-refused.ts`: FireAlarmRefused
- `fire-alarm.ts`: FIRE_ALARM_WAYS, FireAlarmWay, FireAlarm, FIRE_ALARM_OFF, FIRE_ALARM_ON, FIRE_ALARM_STRICTER_ONLY, hardStopAt, isStricter, stopsEveryWalk, holdsAtStageBoundary, FireAlarmSounding, soundingOf, holdsResume
- `idea-changes.ts`: IdeaChange, captureIdea, editIdea, Shaping, IdeaTaskShaping, shapeIdeaIntoTask, ShapingIntoInitiative, shapeIdeaIntoInitiative, dropIdea, restoreIdea, attachingToIdeaProblems
- `idea-events.ts`: IdeaCaptured, IdeaEdited, IdeaShaped, IdeaShapedIntoInitiative, IdeaDropped, IdeaRestored
- `idea-not-found.ts`: IdeaNotFound
- `idea-refused.ts`: IdeaRefused
- `idea.ts`: IdeaState, Idea, NewIdea, IdeaEdit, trimmedNewIdea, newIdeaProblems
- `initiative-archive.ts`: ARCHIVE_PAGE_SIZE, ArchiveStateFilter, ArchiveSearch, ArchivedInitiative, ArchivePage, isInitiativeArchived, isEndedOnTheBoard, archiveInitiative, restoreInitiative, initiativeArchivePeriodStart, archiveInitiativeIfDue
- `initiative-changes.ts`: InitiativeChange, InitiativeTasksChange, ConfirmBranching, NewInitiative, createInitiative, confirmInitiative, backToShapingProblems, backToShaping, projectsWithPipeline, chooseInitiativePipeline, setInitiativePipelines, writeShortName, addBranch, dropInitiative, dropLeftOpenTasks, finishInitiative, InitiativeSettling, settleInitiative, InitiativeTaskAdded, blockingItsPublishingTask, addTaskToInitiative, InitiativeChangeRoute, changeRouteOf, writeOutcome, requireShaperTaskAllowed, addDependencyOfItsTask, removeDependencyOfItsTask, changeTitleOfItsTask, changeDescriptionOfItsTask, tasksByInitiative
- `initiative-edit.ts`: InitiativeEdit, newTaskOf, sameTitleWords, sameDescriptionWords, initiativeEditProblems, PipelineEditNames
- `initiative-events.ts`: InitiativeCreated, InitiativeStateChanged, InitiativeBranchDeleted, InitiativeArchived, InitiativeRestored, InitiativeOutcomeWritten, InitiativePipelineChosen, InitiativePipelinesSet, InitiativeEngineOverrideSet, InitiativeShortNameWritten, InitiativeBranchMade, InitiativePaused, InitiativeResumed, InitiativePlanningStarted
- `initiative-membership.ts`: InitiativeMembershipChange, MembershipGrounds, addToInitiative, takeOutOfInitiative
- `initiative-not-found.ts`: InitiativeNotFound
- `initiative-not-shaping.ts`: InitiativeNotShaping
- `initiative-pause.ts`: INITIATIVE_PAUSED, isInitiativePaused, pauseInitiative, resumeInitiative
- `initiative-pipeline.ts`: initiativePipelineChangeProblems, startedPublishingTask
- `initiative-planning.ts`: INITIATIVE_PLANNING_THREAD_TITLE, initiativePlanningAfterRestartOpening, initiativePlanningOpening, initiativePlanningInstructions, initiativePlanningProblems, stillPlanningWords, InitiativePlanningStart, startInitiativePlanning, startPlanningInInitiative, RewritingThread, rewritingProblems, rewriteInInitiative, unplannedBlockers, InitiativePlanningProject, OpenTaskDecision, InitiativePlanningRecord, initiativePlanningBrief
- `initiative-refused.ts`: InitiativeRefused
- `initiative-section.ts`: LONG_PLAN_CHARACTERS, initiativeSection
- `initiative-start.ts`: readyTasksToStart
- `initiative.ts`: INITIATIVE_STATES, InitiativeState, Initiative, InitiativePlanningThread, latestPlanningThread, planningThreadOf, InitiativeBranch, InitiativePipeline, pipelineIn, hasAnyPipeline, isPipelineFixed, initiativeProjectIds
- `linked-records.ts`: TaskLinks, linkedRecordsSection, linkedRecordLines, linkedTaskWords, linkedIdeaWords, whereOf, linkedInitiativeWords
- `manual-order.ts`: boardOrder, orderAfter, Neighbours, placementBetween, compareOrders
- `off-board-task.ts`: OFF_BOARD_TASK_KINDS, OffBoardTaskKind, isOffBoardTask, isOpenOffBoardTask, OffBoardTaskStatus, OffBoardTask, ProjectOffBoardTasks, OffBoardTaskStart, OffBoardStageRun, OffBoardTaskParts, offBoardTaskOf, dropReasonWords, projectOffBoardTasksOf, newestMadeFirst
- `office-limit-events.ts`: OfficeWideLimitChanged, ArchivePeriodChanged, UsageSettingsChanged
- `onboarding.ts`: ONBOARD_PIPELINE, ONBOARD_TASK_TITLE, onboardTaskPlan, ONBOARD_TASK_DEFINITION_OF_DONE, createOnboardTask, OnboardingState, ProjectOnboarding, projectOnboardingOf, latestOnboardingsOf
- `pdf-text.ts`: pdfTextOf
- `person-tasks.ts`: WORK_FILTERS, WorkFilter, WORK_FILTER_STATES, WAITS_ON_YOU_IN_ITS_STATE, PipelineWithStages, stagesWorkedBy, partIn, UNTITLED_THREAD
- `pipeline-commands.ts`: PipelineCommands, TaskPipelineChoice, TaskPipelineProject, taskPipelineProblems, brokenPipelineWords, missingCommands, missingCommandsWords
- `planning-changes.ts`: writePlan, confirmPlan, writeDefinitionOfDone, confirmDefinitionOfDone, proposePipeline, confirmPipeline, markingPlannedProblems, markPlanned, acceptInAutoMode
- `planning.ts`: PLANNING_THREAD_TITLE, planningInstructions, makeAPlanOpening, planningAfterRestartOpening, PlanningProject, ProjectCommandsInBrief, PlanningPipeline, NO_WORKTREE_YET, PlanningRecord, InitiativeBranchStart, planningBrief, kindValues, bugDetailsWords, worktreeValues, planValues, attachmentValues, defaultPipelineWords, ProjectPipelinesInBrief, pipelineGroups, pipelineLibraryLines, commandLines
- `project-filter.ts`: ProjectFilter, isInProjectFilter
- `publishing-task.ts`: PublishingProject, PublishingGrounds, PUBLISHING_TASK_NEVER_PLANNED, publishingTaskTitle, publishingModeWords, publishingTaskPlan, publishingTaskDefinitionOfDone, publishingTaskFiles, createPublishingTask, publishingCandidates, projectsToPublish, swapPublishingPipeline, lastPublishedBy, unfinishedPublishingTask, doneTasksIn
- `queue-events.ts`: TaskQueued, LeavingQueue, TaskLeftQueue, TaskQueueReasonsChanged, TaskMovedUpInQueue
- `queue.ts`: QueuedTask, OverlapChoice, Starting, startOrQueue, behindWaits, queueOrder, Release, releaseQueue, moveUpInQueue, moveToTopOfQueue
- `record-edits.ts`: EditedField, EditedRecordKind, EditedRecord, RecordEdit, taskEditedFields, ideaEditedFields, initiativeEditedFields, withEdits, withTaskEdits, withIdeaEdits, withInitiativeEdits, HistoryEntry, historyOf, historyEntryWords, historyLines, taskHistoryLines
- `record-words.ts`: HandoverNote, AllStageResults, DecisionWaitingOnTheUser, TaskRecordParts, taskRecordText, InitiativeRecord, initiativeRecordText, initiativePipelineLines, outcomeWords, initiativeTaskLine, ShapedInto, ideaRecordText
- `rendered-text.ts`: renderedText, flagField
- `run-environment-set-up.ts`: SET_UP_RUN_ENVIRONMENT_PIPELINE, RUN_ENVIRONMENT_SET_UP_TITLE, runEnvironmentSetUpPlan, RUN_ENVIRONMENT_SET_UP_DEFINITION_OF_DONE, createRunEnvironmentSetUpTask, isOpenRunEnvironmentSetUp
- `saved-view-events.ts`: SavedViewSaved, SavedViewRemoved
- `saved-view-not-found.ts`: SavedViewNotFound
- `saved-view-refused.ts`: SavedViewRefused
- `saved-view.ts`: SAVED_VIEW_NAME_LENGTH, BoardFilters, SavedView, NewSavedView, keptBoardFilters, newSavedViewProblems, saveView
- `search.ts`: MAX_SEARCH_WORDS, SEARCH_RESULT_LIMIT, SEARCHED_TEXT_LIMIT, searchWords, idPrefixOf, TaskMatch, taskMatchOf, searchedText
- `shaping.ts`: SHAPING_THREAD_TITLE, shapingInstructions, shapingOpeningOf, ShapingProject, IdeaProject, shapingBrief
- `short-name.ts`: SHORT_NAME_MAX_LENGTH, initiativeBranchOf, derivedShortName, shortNameProblems
- `stand-ins-at-start.fixtures.ts`: WORK_AND_PERSONAL, fiveHourAt, estimateOn, LAB, onWorkWithPersonal, onWorkWithStandIns
- `stand-ins-at-start.ts`: EngineStandIn, StandInEngineAtStart, StandInsAtStart, EngineForcedBy, NO_STAND_INS, UsageOnStandIns, UsageCapsChoice, onStandIns, standInsWithStarted
- `start-past-limits.ts`: StartPastLimits, startPastLimits
- `start-past-usage-caps.ts`: EngineToRunOn, StartPastUsageCaps, startPastUsageCaps
- `state-change.ts`: AutoModeConfirmation, BranchReset, WayBackStep, UserWayBack, PersonAuthor, PersonWayBack, byWayBack, StateChangeCause, BY_THE_PIPELINE, BY_THE_FIRE_ALARM, BY_THE_USAGE_WINDOW, userBehind, StateChange, stateChangeCauseWords, wayBackWords
- `task-archive.ts`: DEFAULT_ARCHIVE_PERIOD, isArchived, archiveTask, restoreTask, archiveCutoff, archivePeriodStart, archiveIfDue, isFinishedOnTheBoard
- `task-branch-base.ts`: TaskBranchBase, taskBranchBase, initiativeBranchGoneRefusal
- `task-changes.ts`: TaskChange, withStateChange, NewTaskOrigin, NewTaskSetting, createTask, changeTaskState, PlanningThread, startPlanningTask, undoPlanningMove, moveToBacklogOnConfirm, moveToShapingOnBackToShaping, MarkReadyChoice, markTaskReady, changeStartedTaskState, pauseTask, pauseTaskForAlarm, pauseTaskForUsageWindow, taskWentOnOnStandIn, resumeTaskAtReset, resumeTaskFreedByUsageWindow, stopTask, pauseTaskForInitiative, resumeTaskForInitiative, resumeTask, restartTask, wayBackTakenBy, StartingOver, startTaskOver, Reopening, reopenTask, AllClearChoice, giveTaskAllClear, dropTask, DropAnswer, dropTaskAsAnswered, startedTaskDropWords, changeKind, changeCausedBy, MAX_FOUND_IN_VERSION, changeFoundInVersion, changePriority, reorderTask, INITIATIVE_PAUSED_RESUME
- `task-commit-message.ts`: changeCommitMessage, publishCommitMessage, defaultCommitMessage, commitMessageOf
- `task-dependencies.ts`: DependencyChange, DependencyChanges, dependencyChanges, createdWaitingFor, newTaskBlockerProblems, blockPublishingTask, removeDependency, blockingTasks, blockedProblems
- `task-description.ts`: NO_DESCRIPTION, descriptionSection, descriptionWords, changeTitle, changeDescription
- `task-events.ts`: TaskCreated, TaskDiscarded, TaskStateChanged, TaskArchived, TaskRestored, TaskPriorityChanged, TaskTitleChanged, TaskKindChanged, TaskEngineOverrideSet, TaskInitiativeEngineOverrideChanged, TaskBugDetailsChanged, TaskDescriptionChanged, TaskCommitMessageChanged, TaskBranchDeleted, TaskPullRequestEnded, TaskPullRequestReopened, TaskTagsChanged, TaskReordered, TaskPlanProposed, TaskPlanSaved, TaskMovedToProject, TaskPlanConfirmed, TaskDefinitionOfDoneProposed, TaskDefinitionOfDoneSaved, TaskDefinitionOfDoneConfirmed, TaskPipelineProposed, TaskPipelineConfirmed, TaskMarkedPlanned, TaskAcceptedInAutoMode, TaskMarkedReadyAsItStands, TaskRewrittenInInitiative, PausedBy, UsageWindowRefusal, TaskPaused, TaskStopped, TaskHeldAtAllClear, TaskResumed, TaskWentOnOnStandIn, TaskDependencyAdded, TaskDependencyRemoved, TaskAddedToInitiative, TaskTakenOutOfInitiative, TaskStarted, TaskStartedOver, TaskReopened
- `task-kind-words.ts`: TASK_KIND_NAMES, TASK_KIND_PLURALS, COMMIT_TYPES
- `task-made-for.ts`: MadeTaskSetting, MadeTaskWords, createTaskMadeFor
- `task-move.ts`: MOVED_AS_IT_OPENED, MoveGrounds, moveProblems, moveTask
- `task-not-found.ts`: TaskNotFound
- `task-overlap.ts`: Overlap, overlapsOf, overlapWords
- `task-pull-request.ts`: PullRequestMergeMethod, PullRequestEndedBy, PullRequestEnd, recordPullRequestEnd, clearPullRequestEnd, pullRequestEndWords
- `task-refused.ts`: TaskRefused
- `task-start.ts`: StartingStage, DEFAULT_OFFICE_WIDE_LIMIT, LimitsChoice, TaskLimit, StartingPerson, StartingProject, InitiativeBranchProblem, StartConditions, BrokenPipelineAtStart, HeldAtStart, StartReasons, firstAgentStage, startReasons, reasonsBesideUsage, startTask, usageOnStandIns, limitWaits
- `task-states.ts`: TASK_STATE_NAMES, CONFIRM_ITS_INITIATIVE, NOT_STARTED_STATES, STARTED_STATES, OPEN_STATES, STATES_A_START_WEIGHS, stateChangeProblems, moveProblems, ReadinessLine, readinessLines, CONDITIONS_KEPT_WHEN_CONFIRMING, openDecisionProblems, INITIATIVE_PAUSED_RESUME, ALARM_HOLDS_THE_TASK, ALARM_HOLDS_RESTART, USAGE_WINDOW_HOLDS_THE_TASK, LEFT_THE_WORKSTATION, startOverRefusalWords, WayBackHolds, restartProblems, PUBLISHING_TASK_NOT_STARTED_OVER, CONFLICT_RESOLUTION_NOT_STARTED_OVER, startOverProblems, ReopenTo, ReopenGrounds, PUBLISHING_TASK_NOT_REOPENED, CONFLICT_RESOLUTION_NOT_REOPENED, OFFICE_TASK_NOT_REOPENED, reopenProblems, WayBackOffer, WaysBack, WaysBackGrounds, waysBackOf
- `task-tags.ts`: MAX_TAGS, MAX_TAG_LENGTH, normalizedTags, tagsProblems, changeTags
- `task.ts`: TASK_STATES, TaskState, TASK_MADE_FOR, TaskMadeFor, TASK_HOLDERS, TaskHolder, isPublishingTask, TASK_KINDS, TaskKind, PRIORITIES, Priority, Task, TaskTextField, TaskSummary, ProjectMove, TaskWithPipeline, hasPipeline, NO_PIPELINE_YET, ProposedPipeline, NewTask, trimmedNewTask, newTaskProblems
- `test-targets-set-up.ts`: isOpenTestTargetsSetUp
- `text-lines.ts`: DEFAULT_LINE_COUNT, MAX_LINE_COUNT, DEFAULT_CONTEXT_LINES, MAX_CONTEXT_LINES, LineReading, LinesPart, LineReader, lineReader, lineCountWords
- `title.ts`: TITLE_LENGTH, titleProblem
- `usage-estimate.ts`: HISTORY_WINS_AT, USAGE_MEASURES, UsageMeasure, DEFAULT_USAGE_MEASURES, StageTokens, UsageWindowName, StageUsage, StageUsages, WindowRatios, EngineWindowRatios, PipelineStage, EstimatedStage, EngineWindows, EngineUsage, UsageEstimateBasis, UsageEstimate, tasksInHistory, historyUsage, plannerUsage, movedTo, mergedUsage, countedTokens
- `usage-settings.ts`: DEFAULT_WINDOW_CAP, WindowCaps, EngineCaps, UsageSettings, defaultEngineCaps, DEFAULT_USAGE_SETTINGS, namesEveryEngine, windowCapsWhereWindows, everyEngineCaps
- `wait.ts`: Wait, reasonsOf, shortReasonsOf
- `who-asked.ts`: AskedMove, TaskWhoAsked, taskWhoAsked, taskWhoAskedSection, initiativePlanningOpenedBy
- `work-engine.ts`: TaskModelAndEffort, TaskPersonEngine, TaskEngineLevels, TaskEngineMove, TaskEngineChange, sameEngine, changeTaskEngine, changeInitiativeEngine, taskEngineMoves, inheritedEngineMoves, pipelineChoiceMoves, removedEngineChanges, TaskOnItsEngine, tasksOnTheirEngines, onTask, inInitiative, moveTaskEngine, moveInitiativeEngine, EngineNames, taskEngineLines, initiativeEngineLines
- `work-prompt-templates.fixtures.ts`: defaultWorkPrompts
- `work-prompt-templates.ts`: PLANNING_INSTRUCTIONS, SHAPING_INSTRUCTIONS, INITIATIVE_PLANNING_INSTRUCTIONS, ASKING_INSTRUCTIONS, SHAPING_OPENING, CREATED_INITIATIVE_SHAPING_OPENING, MAKE_A_PLAN_OPENING, PLANNING_AFTER_RESTART_OPENING, INITIATIVE_PLANNING_OPENING, INITIATIVE_PLANNING_AFTER_RESTART_OPENING, PLANNING_BRIEF, ASKING_BRIEF, SHAPING_BRIEF, INITIATIVE_PLANNING_BRIEF, TASK_WHO_ASKED, WORK_PROMPT_TEMPLATES
- `work-prompts.golden-cases.fixtures.ts`: goldenCaseOutputs
- `work-prompts.golden.ts`: GOLDEN_OUTPUTS
- `work.fixtures.ts`: ANN_LEE, BEN_ITO, anIdea, anInitiative, aPlanningThread, aTask, aPlannedTask, aLink, NO_USAGE_AT_START
- `written-parts.ts`: PlanWriting, WrittenPlanAndDefinitionOfDone, WrittenPlan, writtenParts, trimmedStatements, writtenPlanProblems, planProblems, definitionOfDoneProblems, confirmationWords, planWithFilesToChange
- Tests: asking.full.test.ts, attachment-changes.full.test.ts, branch-deletion.test.ts, cap-waits.full.test.ts, cap-waits.test.ts, conflict-resolution.test.ts, day-summary.test.ts, idea-changes.full.test.ts, initiative-archive.full.test.ts, initiative-changes.full.test.ts, initiative-edit.full.test.ts, initiative-membership.test.ts, initiative-pause.test.ts, initiative-pipeline.test.ts, initiative-planning.test.ts, initiative-section.full.test.ts, initiative-start.test.ts, manual-order.full.test.ts, off-board-task.full.test.ts, onboarding.full.test.ts, person-tasks.test.ts, pipeline-commands.test.ts, planning-changes.full.test.ts, planning.full.test.ts, project-filter.full.test.ts, publishing-task.test.ts, queue.full.test.ts, queue.test.ts, record-words.full.test.ts, run-environment-set-up.full.test.ts, search.full.test.ts, short-name.test.ts, stand-ins-at-start.test.ts, start-past-usage-caps.test.ts, state-change.full.test.ts, task-archive.full.test.ts, task-branch-base.test.ts, task-changes.full.test.ts, task-changes.test.ts, task-commit-message.test.ts, task-dependencies.full.test.ts, task-dependencies.test.ts, task-description.full.test.ts, task-kinds.full.test.ts, task-kinds.test.ts, task-move.full.test.ts, task-overlap.full.test.ts, task-pull-request.test.ts, task-start.full.test.ts, task-start.test.ts, task-states.full.test.ts, task-states.test.ts, task-tags.full.test.ts, task-ways-back.test.ts, test-targets-set-up.full.test.ts, text-lines.full.test.ts, usage-estimate.full.test.ts, usage-window-pause.test.ts, who-asked.test.ts, work-engine.test.ts, work-prompts.golden.test.ts

### ports/

- `account-window-ratios.ts`: AccountWindowRatios
- `account-windows.ts`: AccountWindows
- `attachment-files.ts`: FileReplacement, AttachmentFiles
- `attachment-repository.ts`: AttachmentRepository
- `day-outcomes.ts`: DayTokens, FailedTask, DayOutcomes
- `day-records.ts`: DayRange, DayRecordMoment, DayRecords
- `day-usage.ts`: ModelDayUsage, DayUsage
- `fire-alarm-repository.ts`: FireAlarmRepository
- `idea-cards.ts`: IdeaCards
- `idea-repository.ts`: IdeaUpdate, ShapedIdea, IdeaShapedIntoInitiative, IdeaRepository
- `initiative-repository.ts`: InitiativeUpdate, InitiativeTasksUpdate, InitiativeRepository
- `initiative-threads.ts`: InitiativeThreadWaiting, InitiativeThreadOpening, InitiativeThreads
- `known-engine-cascade.ts`: EngineCascadePlace, StandInsApplying, EngineCascadeLevel, EngineInCascade, KnownEngineCascade
- `known-people.ts`: KnownPeople, KnownPerson
- `known-pipelines.ts`: KnownPipelines, KnownPipeline
- `known-projects.ts`: KnownProject, KnownPublishingMode, KnownProjectCommand, KnownProjects
- `model-prices.ts`: ModelPrices
- `new-projects.ts`: AddedProject, NewProjects
- `pdf-pages.ts`: PdfPages
- `project-branch-deletions.ts`: BranchCopy, BranchWork, BranchDeletionPreview, BranchDeletionRequest, BranchOwner, BranchDeletion, ProjectBranchDeletions
- `project-initiative-branches.ts`: InitiativeBranchMaking, InitiativeBranchRemoval, ProjectInitiativeBranches
- `project-worktrees.ts`: TaskWorktree, TaskBranchCheckout, ProjectWorktrees
- `proposal-drafts.ts`: ProposedInitiativeChange, ProposedProject, WorkProposedChange, ProposalDrafts
- `queue-repository.ts`: HeldForRelease, QueueRepository
- `record-edits.ts`: RecordEdits
- `saved-view-repository.ts`: SavedViewRepository
- `session-initiatives.ts`: SessionInitiativeThread, SessionInitiatives
- `session-people.ts`: SessionPeople
- `session-tasks.ts`: SessionTasks
- `stage-results.ts`: TaskStageResults, TaskStageRunsOutline, StageResults
- `task-decisions.ts`: TaskDecisions
- `task-gates.ts`: TaskGates
- `task-pull-requests.ts`: TaskPullRequest, TaskPullRequests
- `task-repository.ts`: TaskUpdate, NeighbourIds, PersonsTasksQuery, PersonsTasksRead, TaskRepository
- `task-threads.ts`: TaskThreadOpening, TaskThreadStarting, PersonsTaskThread, TaskThreadTitle, TaskThreads
- `task-tokens.ts`: EngineIdTokens, TaskTokens
- `thread-turns.ts`: ThreadTurns
- `usage-history.ts`: UsageHistory
- `work-ports.fixtures.ts`: UNKNOWN_PROJECT, KnownProjectsForTests, NewProjectsForTests, ProjectBranchDeletionsForTests, ProjectInitiativeBranchesForTests, ProjectWorktreesForTests, TaskPullRequestsForTests, StageResultsForTests, TaskGatesForTests, KnownPeopleForTests, KnownEngineCascadeForTests, WorkSettingsForTests, FireAlarmRepositoryForTests, SessionPeopleForTests, UNKNOWN_SESSION, IdeaCardsForTests, SessionTasksForTests, SessionInitiativesForTests, AskedAgain, TaskThreadsForTests, InitiativeThreadsForTests, ThreadTurnsForTests, TaskDecisionsForTests, ProposalDraftsForTests, UsageHistoryForTests, ModelPricesForTests, AccountWindowsForTests, AccountWindowRatiosForTests, DayUsageForTests, DayOutcomesForTests, TaskTokensForTests, TaskBasesForTests, IssueWriteBackForTests, ProjectFeaturesForTests, WorkPortsForTestsModule
- `work-search.ts`: SearchMatches, IdMatches, WorkSearch
- `work-settings.ts`: WorkSettings
- `worktree-files.ts`: WorktreeFile, WorktreeFileLimits, WorktreeFiles
- `zip-files.ts`: ZipFiles
