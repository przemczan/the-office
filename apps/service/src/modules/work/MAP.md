# Work: module map

**Owns:** Ideas, Initiatives (shaped from an Idea, confirmed, dropped, done once their Tasks are: `initiative-changes.ts`; the Projects one spans are its Tasks', which name it), Tasks (states, priority, Tags (`task-tags.ts`, set by the user and by the Planner's `write_tags`), manual order, Plan, Definition of Done, the Task's Pipeline id, the Tasks it waits for: `blockedBy`, `task-dependencies.ts`) and Attachments of an Idea, an Initiative or a Task (`ideas`, `initiatives`, `tasks`, `attachments`); Office settings in one row (`work_settings`: the Office-wide limit and the ticked measures, which Settings › Office limits changes; the repository answers each default until it is saved) and the caps per engine (`engine_caps`, `domain/usage-settings.ts`: one set per engine Engine's `EngineModels` lists, which `OfficeLimits` fills in with `everyEngineCaps` and checks with `namesEveryEngine`, the repository keeping only those saved; Window caps exactly where the account has windows, `hasUsageWindows`, which `OfficeLimits.capsProblem` refuses otherwise, 90% until saved; Daily caps on tokens and dollars, off until set), both through `GET`/`PUT /settings/usage`, which publishes `UsageSettingsChanged`; screenshots attached from Stages (`StageScreenshots`); the Office tools for Ideas and Tasks, whose records (`domain/record-words.ts`) are also what a mention in a chat gives the Agent, through Conversations' `WorkRecords` (which also gives a Link card its Task's title); an Initiative's record (`initiativeRecordText`) briefs its shaping Thread through Conversations' `InitiativeThreadSetups` (`ShapingThreadSetup`) and is what a mention gives; the CTO's Office tools there (`ShapingOfficeTools`: its outcome, Tasks and their dependencies, an `InitiativeEdit`; its `read_initiative` reads any Initiative by id, so every chat has it too) write straight onto it while it is shaping, as the user writes its outcome (`PUT /initiatives/:id/outcome`), and once it is active draft each change as a Proposal the user applies (`InitiativeService.changeByCto`). The full-text search over Tasks, Ideas, Initiatives and document Attachments (`SearchService` over the `WorkSearch` port: `GET /tasks?query=` for the board, `GET /search` for the top bar, narrowed by the Project filter it is given, `domain/project-filter.ts`, before each kind is cut to its best 50, with how many more match in other Projects), each word the start of a word in the record (`domain/search.ts`). Saved views (`saved_views`, `SavedViewService`, `/saved-views`): the board's filters under a name, unique in any case, kept as `keptBoardFilters` leaves them and never with the Project filter. Start and the one Office-wide queue (`queue`, `domain/queue.ts`, `StartService`, `QueueService`, `/queue`): `startReasons` sorts refusals from waits (the Office-wide limit, the person's Task limit, a ticked Window cap or Daily cap the Task's estimate would pass on an engine id it spends on, `domain/cap-waits.ts`: a window's reading, plus what the Tasks started since it are expected to use, `StartsSinceReading`, plus this Task's; a window unread, not begun or past its reset is unused; a day's use, priced by the Model prices (a model with no price adds no dollars), plus what is left of each started Task's estimate, `DailyCaps`, plus this Task's, resetting at local midnight; a Task with no estimate is weighed on the rest alone; none when every cap passed resets within the hour); Start on waits alone queues the Task, which stays Ready; `QueueService.release` starts the queued Tasks that can, first place first, and takes out those whose turn meets a refusal. The Plan's files to change (`filesToChange`, `domain/files-to-change.ts`), written by `write_plan` and confirmed with the Plan (`PUT /tasks/:id/plan`); an Overlap with a started Task of the same Project (`domain/task-overlap.ts`) is in the start check and refuses Start until the user answers `start-anyway` or `queue-behind`, which queues the Task behind those Tasks (`queue.behind`) until each is Done or Dropped. The fire alarm (spec 2.8, `fire_alarm`, one row seeded off, `FireAlarmRepository`, `FireAlarmService`, `GET /fire-alarm`, `POST /fire-alarm/sound`, `POST /fire-alarm/all-clear`): sounding it pauses every Task In progress or Waiting on you as paused by the alarm, then publishes `AlarmSounded` with its hard stop 60 s on (`Task.pausedByAlarm`, `pauseTaskForAlarm`, `TaskPaused` with `by: "alarm"`), apart from the user's Pause; while it is on Start and every release wait with "The fire alarm is on." (`HeldAtStart.fireAlarmOn`), and a Resume is kept as the alarm holding the Task. The all clear (`giveAllClear`, `giveTaskAllClear`) resumes each Task the alarm paused unless the user holds it (`TaskHeldAtAllClear`, their own Pause from then) or drops it, then turns the alarm off and publishes `AllClearGiven` with the ids, which releases the queue. Usage estimates (spec §2.1, `domain/usage-estimate.ts`, `UsageEstimates`, in `GET /tasks/:id/start` and `GET /usage-estimates` for every Ready Task): per engine id of the engine and model the cascade gives each Agent Stage's Role in the Task's Project (`KnownEngineCascade`), as the Stage runner opens its session, from the done Tasks of the Project and Pipeline once the history has 3, else from the Planner's `estimatedTokens` (written by `write_plan`, confirmed with the Plan), its cost by the Office-wide dollars per token; window % either way is the tokens times the engine id's Office-wide window % per token; only the ticked measures are answered, none with none ticked.

**Talks to:** through ports bound in [app.module.ts](../../app.module.ts): `KnownProjects` to `ProjectService`, `ProjectWorktrees` to `TaskWorktrees`, `KnownPeople` to `RoleCards`, `KnownEngineCascade` to People's `EngineCascade` (each Agent Stage's engine and model in the Task's Project, for the Usage estimate), `KnownPipelines` to `PipelineLibrary`, `SessionPeople`, `SessionTasks`, `SessionInitiatives` (the Initiative a shaping session writes onto), `TaskThreads`, `InitiativeThreads` (the shaping Thread with the CTO, opened as an Idea is shaped when a CTO is hired, else started by the user: `POST /initiatives/:id/shaping`) and `IdeaCards` (the card `capture_idea` posts in the chat) to `ThreadService`, `TaskDecisions` to `DecisionService`, `ProposalDrafts` (the CTO's Proposals on an active Initiative, and Devops' Projects to onboard) to `ProposalService`, `NewProjects` (adding a Project from a Proposal, by its folder or by its Repository URL cloned first, and its dry run) to `ProjectsFromRepositories`. Pipelines reacts to its events and moves started Tasks through `TaskService`. The queue releases on a started Task's `TaskStateChanged` to done or dropped, on `OfficeWideLimitChanged`, on `UsageSettingsChanged`, on People's `RoleCardChanged` (a Task limit raised), on Engine's `UsageWindowsRead` (every reading, changed or not), on `TaskQueued`, and on a timer an hour before and at the reset that frees a Task a cap holds (`nextCapRelease`, set again after each release), and once as the service starts (`office.ts`, after every module's start and after `FireAlarmService.finishSounding` pauses what a sounding the service stopped during left running, never in a test app), and takes out a Task that leaves Ready. `FireAlarmForThreads` (`adapters/conversations/`) gives Conversations' `FireAlarmInThreads` the alarm to read and tells it when it sounds and which Tasks go on at the all clear; Notifications reads the alarm for Now through `FireAlarmService.read`; Pipelines holds Stages on `TaskPaused` by the alarm and `AlarmSounded`, and at boot through `TaskService.holdForFireAlarm`. Work applies Proposals of the Office-wide limit with `OfficeLimitProposals` (`adapters/conversations/`), which fills Conversations' `ProposalAppliers` as Work starts and judges one by the contracts' rule Settings saves by, of a Project to onboard with `ProjectProposals` (the Project through `NewProjects`, then its Onboard Task through `OnboardingService`, which opens the Task's worktree itself since the Task skips Planning; `propose_project` is `OnboardingOfficeTools`), and of an Initiative with `InitiativeProposals`, judged as applying judges (`initiativeEditProblems`) and applied under the Initiative's hold; Usage estimates read the history through `UsageHistory`, bound to Pipelines' `UsageHistory` (from `UsageHistoryModule`, never `PipelinesModule`), price each Stage's median through `ModelPrices`, bound to Engine's, and take window % per token through `AccountWindowRatios`, bound to Engine's `UsageWindowSamples`; Start reads the windows through `AccountWindows`, bound to Engine's `UsageWindowState`, the day's use through `DayUsage`, bound to Engine's, and each started Task's Stage Threads' tokens by engine id through `TaskTokens`, bound to Conversations'; and take the engines and their names from Engine's `EngineModels`, an engine having windows by its kind (`hasUsageWindows`), so the estimate and Office limits give windows only on a Claude Code engine and the cap words name the engine; `KnownPeople` gives each Role's engine and model. `WorkPortsForTestsModule` provides the registry, and fakes of them (`UsageHistoryForTests`, `ModelPricesForTests`, `AccountWindowRatiosForTests`), so no Work test reads the shared `stage_runs` or `usage_window_samples`.

**Traps:** a Project's onboarding is read from its Onboard Task alone (`isOnboardTask`, one per Project by a partial unique index; `projectOnboardingOf`), never from the Onboard Pipeline, which any Task may follow; Work serves it at `GET /onboardings` because Projects can't ask Work without the two Nest modules importing each other. A Task joins an Initiative only through `InitiativeRepository.addTask`, and the done check (`InitiativeService`, on a Task's `TaskStateChanged` to done or dropped, and on Confirm) goes through `InitiativeRepository.update`: both hold the Initiative's row, so no Task joins one becoming done. Whether the CTO may change an Initiative straight away is decided from the row as held (`InitiativeNotShaping`, thrown in the hold), never from a read before it; only then, outside the hold, is the change judged and drafted as a Proposal. Each CTO change judges what it asks before the state (`requireOpenTo` last), so a wrong or no-op request is never drafted. A dependency of an Initiative's Task changes holding the Initiative first and the dependencies after (`InitiativeRepository.changeDependencies`), the one order any hold of both takes. Start reads the Task's blockers in its own hold (`HeldAtStart`), and every change of dependencies takes one lock and reads every Task (`TaskRepository.changeDependencies`), so no two changes close a cycle; use those, never `update`, for either. The Task holds only its Pipeline's id; the Task's own copy of its Stages lives in Pipelines (`task_stages`), as decided with the user in task 10. A document's text is on disk, so the search keeps its own copy in `attachment_texts`, written with the Attachment as it is added and filled at start for those added before (`AttachmentService.fillDocumentTexts`); a searched field and the query split into words alike (`search-vector.ts`, `searchWords`), so change both together. Every test file shares the `work_settings` row and `engine_caps`, which each Start and estimate reads: a test that lowers the limit or changes the measures or caps overrides `WorkSettings` with `WorkSettingsForTests`, and the Postgres adapter's test rolls its transaction back. Work's test apps read the windows from `AccountWindowsForTests` (no reading unless a test gives one), never the Engine's reading every session updates, and the day's use from `DayUsageForTests` (none unless given), never `engine_day_usage`, which every scripted session in every file adds to; a started Task's use so far comes from `TaskTokensForTests` (none unless given). Start, every release and every queue change hold Starts (`holdStarts`), so two never take one desk; a release reads the other modules' conditions before the hold. The queue is shared by every test file too, and a release in any test app weighs every queued row with that app's ports: only `tasks.controller.test.ts` queues Tasks, and drops each after its test. The fire alarm is read in the hold of Starts, after sounding has turned it on and before it pauses the started Tasks (`TaskRepository.updateEveryStarted` holds Starts), so no Start slips past it; a Resume reads it again after its save. The all clear changes the Tasks before it turns the alarm off and publishes their events only after, so a service stopped between finds them paused again by `finishSounding`. Its row holds every file's Starts and its sounding pauses every file's started Tasks: a test sounds a `FireAlarmRepositoryForTests` with a `TaskRepository` narrowed to its own Project (`tasks.controller.test.ts`), turns it off before its drops, and the Postgres adapter's test rolls its transaction back. A Task's record lists its state changes from `task_state_changes`, written only from a `TaskChange`'s `stateChange` (`saveTask`, `insertTask`, the queue's `saveStarted`): a new way of changing or adding a Task saves through them, or its moves go unkept; Tasks from before the table say their earlier moves weren't kept. A `project` Proposal applied again after its Onboard Task failed carries on with the Project at its repository, under its name, not yet onboarded (`NewProjects.findByPath`; a Project by Repository URL is drafted with its clone's folder as the path, `NewProjects.clonePathOf`, so this finds it too). Applying a Project by Repository URL waits for the whole clone inside the apply request.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

FireAlarmService, IdeaService, OfficeLimits, QueueService, StageScreenshots, TaskRecords, TaskService, AttachmentAdded, AttachmentMoved, AttachmentRemoved, IdeaCaptured, IdeaDropped, IdeaRestored, IdeaShaped, IdeaShapedIntoInitiative, AlarmSounded, AllClearGiven, InitiativeCreated, InitiativeStateChanged, OfficeWideLimitChanged, UsageSettingsChanged, TaskLeftQueue, TaskMovedUpInQueue, TaskQueued, TaskCreated, TaskDefinitionOfDoneConfirmed, TaskDefinitionOfDoneProposed, TaskPaused, TaskPipelineConfirmed, TaskPipelineProposed, TaskPlanConfirmed, TaskPlanProposed, TaskPriorityChanged, TaskTagsChanged, TaskReordered, TaskResumed, TaskStarted, TaskStateChanged, TaskStopped, WorkModule

## Domain events

- `domain/attachment-events.ts`: AttachmentAdded, AttachmentMoved, AttachmentRemoved
- `domain/fire-alarm-events.ts`: AlarmSounded, AllClearGiven
- `domain/idea-events.ts`: IdeaCaptured, IdeaShaped, IdeaShapedIntoInitiative, IdeaDropped, IdeaRestored
- `domain/initiative-events.ts`: InitiativeCreated, InitiativeStateChanged, InitiativeOutcomeWritten
- `domain/office-limit-events.ts`: OfficeWideLimitChanged, UsageSettingsChanged
- `domain/queue-events.ts`: TaskQueued, TaskLeftQueue, TaskMovedUpInQueue
- `domain/saved-view-events.ts`: SavedViewSaved, SavedViewRemoved
- `domain/task-events.ts`: TaskCreated, TaskStateChanged, TaskPriorityChanged, TaskTagsChanged, TaskReordered, TaskPlanProposed, TaskPlanConfirmed, TaskDefinitionOfDoneProposed, TaskDefinitionOfDoneConfirmed, TaskPipelineProposed, TaskPipelineConfirmed, TaskPaused, TaskStopped, TaskHeldAtAllClear, TaskResumed, TaskDependencyAdded, TaskDependencyRemoved, TaskStarted

## HTTP routes (under `/api`)

- `GET /ideas/:id/attachments`: AttachmentsController.listOfIdea
- `GET /initiatives/:id/attachments`: AttachmentsController.listOfInitiative
- `GET /tasks/:id/attachments`: AttachmentsController.listOfTask
- `POST /ideas/:id/attachments/links`: AttachmentsController.addLinkToIdea
- `POST /initiatives/:id/attachments/links`: AttachmentsController.addLinkToInitiative
- `POST /tasks/:id/attachments/links`: AttachmentsController.addLinkToTask
- `GET /attachments/:id/content`: AttachmentsController.content
- `DELETE /attachments/:id`: AttachmentsController.remove
- `GET /fire-alarm`: FireAlarmController.read
- `POST /fire-alarm/sound`: FireAlarmController.sound
- `POST /fire-alarm/all-clear`: FireAlarmController.allClear
- `POST /ideas`: IdeasController.capture
- `GET /ideas`: IdeasController.list
- `GET /ideas/:id`: IdeasController.read
- `POST /ideas/:id/shape`: IdeasController.shape
- `POST /ideas/:id/initiative`: IdeasController.shapeIntoInitiative
- `POST /ideas/:id/plan`: IdeasController.shapeAndPlan
- `POST /ideas/:id/drop`: IdeasController.drop
- `POST /ideas/:id/restore`: IdeasController.restore
- `GET /initiatives`: InitiativesController.list
- `GET /initiatives/:id`: InitiativesController.read
- `POST /initiatives/:id/confirm`: InitiativesController.confirm
- `PUT /initiatives/:id/outcome`: InitiativesController.writeOutcome
- `POST /initiatives/:id/drop`: InitiativesController.drop
- `POST /initiatives/:id/shaping`: InitiativesController.shape
- `POST /initiatives/:id/tasks`: InitiativesController.addTask
- `GET /settings/office-wide-limit`: OfficeLimitsController.read
- `PUT /settings/office-wide-limit`: OfficeLimitsController.change
- `GET /onboardings`: OnboardingsController.list
- `GET /queue`: QueueController.list
- `DELETE /queue/:taskId`: QueueController.takeOut
- `POST /queue/:taskId/move-up`: QueueController.moveUp
- `GET /saved-views`: SavedViewsController.list
- `POST /saved-views`: SavedViewsController.save
- `DELETE /saved-views/:id`: SavedViewsController.remove
- `GET /search`: SearchController.everything
- `POST /tasks`: TasksController.create
- `GET /tasks`: TasksController.list
- `GET /tasks/:id`: TasksController.read
- `PUT /tasks/:id/priority`: TasksController.changePriority
- `PUT /tasks/:id/tags`: TasksController.changeTags
- `PUT /tasks/:id/place`: TasksController.reorder
- `POST /tasks/:id/dependencies`: TasksController.addDependency
- `DELETE /tasks/:id/dependencies/:blockerId`: TasksController.removeDependency
- `POST /tasks/:id/planning`: TasksController.plan
- `PUT /tasks/:id/plan`: TasksController.confirmPlan
- `PUT /tasks/:id/definition-of-done`: TasksController.confirmDefinitionOfDone
- `PUT /tasks/:id/pipeline`: TasksController.confirmPipeline
- `POST /tasks/:id/ready`: TasksController.markReady
- `GET /tasks/:id/readiness`: TasksController.readiness
- `GET /tasks/:id/start`: TasksController.startCheck
- `POST /tasks/:id/start`: TasksController.start
- `POST /tasks/:id/pause`: TasksController.pause
- `POST /tasks/:id/stop`: TasksController.stop
- `POST /tasks/:id/resume`: TasksController.resume
- `POST /tasks/:id/drop`: TasksController.drop
- `GET /usage-estimates`: UsageEstimatesController.list
- `GET /settings/usage`: UsageSettingsController.read
- `PUT /settings/usage`: UsageSettingsController.change

## Tables

- `adapters/postgres/fire-alarm.schema.ts`: fire_alarm
- `adapters/postgres/queue.schema.ts`: queue
- `adapters/postgres/saved-views.schema.ts`: saved_views
- `adapters/postgres/work-settings.schema.ts`: work_settings, engine_caps
- `adapters/postgres/work.schema.ts`: ideas, initiatives, tasks, task_state_changes, attachments, attachment_texts

## Files

### ./

- `work-application.fixtures.ts`: WorkApplication, startWorkApplication, webEventsOf, sendJson
- `work.module.ts`: WorkModuleOptions, WorkModule

### adapters/conversations/

- `fire-alarm-for-threads.ts`: FireAlarmForThreads
- `initiative-proposals.ts`: InitiativeProposals
- `mentioned-work-records.ts`: MentionedWorkRecords
- `office-limit-proposals.ts`: OfficeLimitProposals
- `planning-thread-setup.ts`: PLANNING_OFFICE_TOOLS, PlanningThreadSetup
- `project-proposals.ts`: ProjectProposals
- `shaping-thread-setup.ts`: SHAPING_OFFICE_TOOLS, ShapingThreadSetup
- Tests: initiative-proposals.test.ts, mentioned-work-records.test.ts, office-limit-proposals.test.ts, planning-thread-setup.test.ts, shaping-thread-setup.test.ts

### adapters/filesystem/

- `filesystem-attachment-files.ts`: FilesystemAttachmentFiles
- `worktree-files.ts`: readWorktreeFile, FilesystemWorktreeFiles

### adapters/http/

- `attachments.controller.ts`: ATTACHMENT_UPLOAD_ROUTES, AttachmentsController
- `fire-alarm.controller.ts`: FireAlarmController
- `ideas.controller.ts`: IdeasController
- `initiatives.controller.ts`: InitiativesController
- `office-limits.controller.ts`: OfficeLimitsController
- `onboardings.controller.ts`: OnboardingsController
- `queue.controller.ts`: QueueController
- `saved-views.controller.ts`: SavedViewsController
- `search.controller.ts`: SearchController
- `tasks.controller.ts`: TasksController
- `usage-estimates.controller.ts`: UsageEstimatesController
- `usage-settings.controller.ts`: UsageSettingsController
- `work-refusals.filter.ts`: WorkRefusalsFilter
- `work-responses.ts`: toIdeaResponse, toInitiativeResponse, toTaskResponse, toAttachmentResponse, toSearchResultsResponse, toOwnerResponse, toSavedViewResponse, toQueueResponse, toUsageEstimateResponse, toUsageSettingsResponse
- Tests: attachments.controller.test.ts, ideas.controller.test.ts, initiatives.controller.test.ts, office-limits.controller.test.ts, saved-views.controller.test.ts, search.controller.test.ts, tasks.controller.test.ts, usage-settings.controller.test.ts

### adapters/office-tools/

- `attachment-office-tools.ts`: ATTACH_FILE, ATTACH_LINK, AttachmentOfficeTools
- `onboarding-office-tools.ts`: OnboardingOfficeTools
- `planning-office-tools.ts`: WRITE_PLAN, WRITE_DEFINITION_OF_DONE, PROPOSE_PIPELINE, READ_ATTACHMENT, WRITE_TAGS, DOCUMENT_READ_LIMIT, PlanningOfficeTools
- `shaping-office-tools.ts`: READ_INITIATIVE, WRITE_OUTCOME, ADD_TASK, ADD_DEPENDENCY, REMOVE_DEPENDENCY, ShapingOfficeTools
- `work-office-tools.ts`: LIST_TASKS, READ_TASK, LIST_IDEAS, READ_IDEA, CREATE_TASK, WorkOfficeTools
- `work-tool-answers.ts`: OfficeToolResult, WorkToolRefused, answered, personInSession
- Tests: attachment-office-tools.test.ts, onboarding-office-tools.test.ts, planning-office-tools.test.ts, shaping-office-tools.test.ts, work-office-tools.test.ts

### adapters/postgres/

- `fire-alarm.schema.ts`: fireAlarm
- `postgres-attachment-repository.ts`: PostgresAttachmentRepository
- `postgres-fire-alarm-repository.ts`: PostgresFireAlarmRepository
- `postgres-idea-repository.ts`: PostgresIdeaRepository
- `postgres-initiative-repository.ts`: PostgresInitiativeRepository
- `postgres-queue-repository.ts`: PostgresQueueRepository
- `postgres-saved-view-repository.ts`: PostgresSavedViewRepository
- `postgres-task-repository.ts`: PostgresTaskRepository
- `postgres-work-search.ts`: PostgresWorkSearch
- `postgres-work-settings.ts`: PostgresWorkSettings
- `queue.schema.ts`: queue
- `saved-views.schema.ts`: savedViews
- `search-vector.ts`: searchVectorOf
- `work-rows.ts`: Transaction, IdeaRow, InitiativeRow, TaskRow, AttachmentRow, canBeRowId, holdManualOrder, holdStarts, everyTaskHoldingDependencies, changeDependenciesHeld, heldTask, saveTask, insertTask, keepStateChange, stateChangesOf, takenOrders, toIdeaRow, toIdea, toInitiativeRow, toInitiative, toTaskRow, toTask, ownerColumns, toAttachmentRow, toAttachment
- `work-settings.schema.ts`: workSettings, engineCaps
- `work.schema.ts`: ideas, initiatives, tasks, taskStateChanges, attachments, attachmentTexts
- Tests: postgres-work-repositories.test.ts

### adapters/websocket/

- `work-web-events.ts`: WorkWebEvents

### application/

- `attachment-service.ts`: UploadedFile, OpenedFile, DocumentText, AttachmentService
- `daily-caps.ts`: DailyCaps
- `fire-alarm-service.ts`: FireAlarmService, AllClearChoices
- `idea-service.ts`: IdeaService
- `initiative-service.ts`: CtoChange, InitiativeService
- `office-limits.ts`: OfficeLimits
- `onboarding-service.ts`: OnboardingService
- `planning-service.ts`: PlanningService
- `queue-service.ts`: QueueService
- `saved-view-service.ts`: SavedViewService
- `search-service.ts`: Found, InOtherProjects, SearchResults, SearchService
- `stage-screenshots.ts`: ScreenshotsAttaching, StageScreenshots
- `start-conditions.ts`: StartConditionsReader
- `start-service.ts`: StartCheck, StartService
- `starts-since-reading.ts`: StartsSinceReading
- `task-records.ts`: TaskRecord, TaskRecords
- `task-service.ts`: TaskService
- `usage-estimates.ts`: TaskUsageEstimate, UsageEstimates
- Tests: fire-alarm-test-project-check.test.ts, planning-test-project-check.test.ts, shaping-with-the-cto.test.ts, stage-screenshots.test.ts, task-records.test.ts, test-project-check.test.ts

### domain/

- `attachment-changes.ts`: AttachmentChange, Adding, addLink, addFile, moveAttachment, removeAttachment
- `attachment-events.ts`: AttachmentAdded, AttachmentMoved, AttachmentRemoved
- `attachment-not-found.ts`: AttachmentNotFound
- `attachment-refused.ts`: AttachmentRefused
- `attachment.ts`: AttachmentOwner, Attachment, AttachmentKind, NewLink, NewFile, ATTACHMENT_SIZE_LIMIT, SCREENSHOT_SIZE_LIMIT, mediaTypeOf, storedFileKind, attachmentLines, attachmentKindWords, trimmedNewLink, newLinkProblems, newFileProblems
- `author.ts`: Author, THE_USER, authorWords
- `cap-waits.ts`: PROMPT_CACHE_HOUR, WindowReading, AccountWindowsReading, WindowsAtStart, DayUse, NO_DAY_USE, DailyCapsAtStart, UsageAtStart, ExceededCap, CapWaits, NO_CAP_WAITS, capWaits, exceededCaps, exceededWindowCaps, exceededDailyCaps, withStarted, dayUseOf, plusDayUse, leftOfEstimate, nextMidnight, nextCapRelease
- `files-to-change.ts`: normalizedFilesToChange, filesToChangeProblems, covers
- `fire-alarm-events.ts`: AlarmSounded, AllClearGiven
- `fire-alarm.ts`: FireAlarm, FIRE_ALARM_OFF, FIRE_ALARM_ON, hardStopAt
- `idea-changes.ts`: IdeaChange, captureIdea, Shaping, shapeIdeaIntoTask, ShapingIntoInitiative, shapeIdeaIntoInitiative, dropIdea, restoreIdea, attachingToIdeaProblems
- `idea-events.ts`: IdeaCaptured, IdeaShaped, IdeaShapedIntoInitiative, IdeaDropped, IdeaRestored
- `idea-not-found.ts`: IdeaNotFound
- `idea-refused.ts`: IdeaRefused
- `idea.ts`: IdeaState, Idea, NewIdea, trimmedNewIdea, newIdeaProblems
- `initiative-changes.ts`: InitiativeChange, confirmInitiative, dropInitiative, finishInitiative, addTaskToInitiative, InitiativeChangeRoute, writeOutcome, addCtoTask, requireCtoTaskAllowed, addDependencyOfItsTask, removeDependencyOfItsTask, tasksByInitiative, initiativeProjectIds
- `initiative-edit.ts`: InitiativeEdit, newTaskOf, initiativeEditProblems
- `initiative-events.ts`: InitiativeCreated, InitiativeStateChanged, InitiativeOutcomeWritten
- `initiative-not-found.ts`: InitiativeNotFound
- `initiative-not-shaping.ts`: InitiativeNotShaping
- `initiative-refused.ts`: InitiativeRefused
- `initiative.ts`: INITIATIVE_STATES, InitiativeState, Initiative
- `manual-order.ts`: boardOrder, orderAfter, Neighbours, placementBetween, compareOrders
- `office-limit-events.ts`: OfficeWideLimitChanged, UsageSettingsChanged
- `onboarding.ts`: ONBOARD_PIPELINE, ONBOARD_TASK_TITLE, onboardTaskPlan, ONBOARD_TASK_DEFINITION_OF_DONE, OnboardTaskSetting, createOnboardTask, OnboardingState, ProjectOnboarding, projectOnboardingOf
- `planning-changes.ts`: PlanWriting, proposePlan, confirmPlan, proposeDefinitionOfDone, confirmDefinitionOfDone, proposePipeline, confirmPipeline
- `planning.ts`: PLANNER, PLANNING_THREAD_TITLE, PLANNING_INSTRUCTIONS, PlanningProject, PlanningPipeline, PlanningRecord, planningBrief, confirmationWords
- `project-filter.ts`: ProjectFilter, isInProjectFilter
- `queue-events.ts`: TaskQueued, LeavingQueue, TaskLeftQueue, TaskMovedUpInQueue
- `queue.ts`: QueuedTask, OverlapChoice, Starting, startOrQueue, queueOrder, Release, releaseQueue, moveUpInQueue
- `record-words.ts`: taskRecordText, initiativeRecordText, ideaRecordText, whereOf
- `saved-view-events.ts`: SavedViewSaved, SavedViewRemoved
- `saved-view-not-found.ts`: SavedViewNotFound
- `saved-view-refused.ts`: SavedViewRefused
- `saved-view.ts`: SAVED_VIEW_NAME_LENGTH, BoardFilters, SavedView, NewSavedView, keptBoardFilters, newSavedViewProblems, saveView
- `search.ts`: MAX_SEARCH_WORDS, SEARCH_RESULT_LIMIT, SEARCHED_TEXT_LIMIT, searchWords, searchedText
- `shaping.ts`: CTO, SHAPING_THREAD_TITLE, SHAPING_INSTRUCTIONS, SHAPING_OPENING
- `state-change.ts`: StateChangeCause, BY_THE_PIPELINE, BY_THE_FIRE_ALARM, BY_THE_QUEUE, StateChange, stateChangeLines
- `task-changes.ts`: TaskChange, withStateChange, NewTaskSetting, createTask, changeTaskState, undoPlanningMove, markTaskReady, changeStartedTaskState, pauseTask, pauseTaskForAlarm, stopTask, resumeTask, AllClearChoice, giveTaskAllClear, changePriority, reorderTask
- `task-dependencies.ts`: addDependency, createdWaitingFor, newTaskBlockerProblems, removeDependency, blockingTasks, blockedProblems
- `task-events.ts`: TaskCreated, TaskStateChanged, TaskPriorityChanged, TaskTagsChanged, TaskReordered, TaskPlanProposed, TaskPlanConfirmed, TaskDefinitionOfDoneProposed, TaskDefinitionOfDoneConfirmed, TaskPipelineProposed, TaskPipelineConfirmed, PausedBy, TaskPaused, TaskStopped, TaskHeldAtAllClear, TaskResumed, TaskDependencyAdded, TaskDependencyRemoved, TaskStarted
- `task-not-found.ts`: TaskNotFound
- `task-overlap.ts`: Overlap, overlapsOf, overlapWords
- `task-refused.ts`: TaskRefused
- `task-start.ts`: StartingStage, DEFAULT_OFFICE_WIDE_LIMIT, TaskLimit, StartingPerson, StartConditions, HeldAtStart, StartReasons, firstAgentStage, startReasons, capWaitsAtStart, startTask
- `task-states.ts`: TASK_STATE_NAMES, NOT_STARTED_STATES, STARTED_STATES, stateChangeProblems, ReadinessLine, readinessLines, openDecisionProblems
- `task-tags.ts`: MAX_TAGS, MAX_TAG_LENGTH, normalizedTags, tagsProblems, changeTags
- `task.ts`: TASK_STATES, TaskState, PRIORITIES, Priority, Task, ProposedPipeline, NewTask, trimmedNewTask, newTaskProblems
- `title.ts`: titleProblem
- `usage-estimate.ts`: HISTORY_WINS_AT, USAGE_MEASURES, UsageMeasure, DEFAULT_USAGE_MEASURES, StageTokens, UsageWindowName, StageUsage, StageUsages, WindowRatios, EngineWindowRatios, PipelineStage, EstimatedStage, EngineWindows, EngineUsage, UsageEstimateBasis, UsageEstimate, tasksInHistory, historyUsage, plannerUsage, countedTokens
- `usage-settings.ts`: DEFAULT_WINDOW_CAP, WindowCaps, EngineCaps, UsageSettings, defaultEngineCaps, DEFAULT_USAGE_SETTINGS, namesEveryEngine, windowCapsWhereWindows, everyEngineCaps
- `work.fixtures.ts`: anIdea, anInitiative, aTask, aPlannedTask, aLink, NO_USAGE_AT_START
- Tests: attachment-changes.test.ts, cap-waits.test.ts, idea-changes.test.ts, initiative-changes.test.ts, initiative-edit.test.ts, manual-order.test.ts, onboarding.test.ts, planning-changes.test.ts, planning.test.ts, project-filter.test.ts, queue.test.ts, search.test.ts, state-change.test.ts, task-changes.test.ts, task-dependencies.test.ts, task-overlap.test.ts, task-start.test.ts, task-states.test.ts, task-tags.test.ts, usage-estimate.test.ts

### ports/

- `account-window-ratios.ts`: AccountWindowRatios
- `account-windows.ts`: AccountWindows
- `attachment-files.ts`: AttachmentFiles
- `attachment-repository.ts`: AttachmentRepository
- `day-usage.ts`: ModelDayUsage, DayUsage
- `fire-alarm-repository.ts`: FireAlarmRepository
- `idea-cards.ts`: IdeaCards
- `idea-repository.ts`: IdeaUpdate, ShapedIdea, IdeaShapedIntoInitiative, IdeaRepository
- `initiative-repository.ts`: InitiativeUpdate, InitiativeRepository
- `initiative-threads.ts`: InitiativeThreadOpening, InitiativeThreads
- `known-engine-cascade.ts`: KnownEngineCascade
- `known-people.ts`: KnownPeople, KnownPerson
- `known-pipelines.ts`: KnownPipelines, KnownPipeline
- `known-projects.ts`: KnownProject, KnownProjects
- `model-prices.ts`: ModelPrices
- `new-projects.ts`: AddedProject, NewProjects
- `project-worktrees.ts`: TaskWorktree, ProjectWorktrees
- `proposal-drafts.ts`: ProposedInitiativeChange, ProposedProject, WorkProposedChange, ProposalDrafts
- `queue-repository.ts`: HeldForRelease, QueueRepository
- `saved-view-repository.ts`: SavedViewRepository
- `session-initiatives.ts`: SessionInitiatives
- `session-people.ts`: SessionPeople
- `session-tasks.ts`: SessionTasks
- `task-decisions.ts`: TaskDecisions
- `task-repository.ts`: TaskUpdate, NeighbourIds, TaskRepository
- `task-threads.ts`: TaskThreadOpening, TaskThreads
- `task-tokens.ts`: EngineIdTokens, TaskTokens
- `usage-history.ts`: UsageHistory
- `work-ports.fixtures.ts`: UNKNOWN_PROJECT, KnownProjectsForTests, NewProjectsForTests, ProjectWorktreesForTests, KnownPeopleForTests, KnownEngineCascadeForTests, WorkSettingsForTests, FireAlarmRepositoryForTests, SessionPeopleForTests, UNKNOWN_SESSION, IdeaCardsForTests, SessionTasksForTests, SessionInitiativesForTests, TaskThreadsForTests, InitiativeThreadsForTests, TaskDecisionsForTests, ProposalDraftsForTests, UsageHistoryForTests, ModelPricesForTests, AccountWindowsForTests, AccountWindowRatiosForTests, DayUsageForTests, TaskTokensForTests, WorkPortsForTestsModule
- `work-search.ts`: SearchMatches, WorkSearch
- `work-settings.ts`: WorkSettings
- `worktree-files.ts`: WorktreeFile, WorktreeFileLimits, WorktreeFiles
