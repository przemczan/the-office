# Work: module map

**Owns:** Ideas, Initiatives (shaped from an Idea, confirmed, dropped, done once their Tasks are: `initiative-changes.ts`; the Projects one spans are its Tasks', which name it), Tasks (states, priority, Tags (`task-tags.ts`, set by the user and by the Planner's `write_tags`), manual order, Plan, Definition of Done, the Task's Pipeline id, the Tasks it waits for: `blockedBy`, `task-dependencies.ts`) and Attachments of an Idea, an Initiative or a Task (`ideas`, `initiatives`, `tasks`, `attachments`); Office settings in one row (`work_settings`, the Office-wide limit, which Settings › Office limits changes; the repository answers the default until it is saved); screenshots attached from Stages (`StageScreenshots`); the Office tools for Ideas and Tasks, whose records (`domain/record-words.ts`) are also what a mention in a chat gives the Agent, through Conversations' `WorkRecords` (which also gives a Link card its Task's title); an Initiative's record (`initiativeRecordText`) briefs its shaping Thread through Conversations' `InitiativeThreadSetups` (`ShapingThreadSetup`) and is what a mention gives; the CTO's Office tools there (`ShapingOfficeTools`: its outcome, Tasks and their dependencies, an `InitiativeEdit`) write straight onto it while it is shaping, as the user writes its outcome (`PUT /initiatives/:id/outcome`), and once it is active draft each change as a Proposal the user applies (`InitiativeService.changeByCto`). The full-text search over Tasks, Ideas, Initiatives and document Attachments (`SearchService` over the `WorkSearch` port: `GET /tasks?query=` for the board, `GET /search` for the top bar, narrowed by the Project filter it is given, `domain/project-filter.ts`, before each kind is cut to its best 50, with how many more match in other Projects), each word the start of a word in the record (`domain/search.ts`). Saved views (`saved_views`, `SavedViewService`, `/saved-views`): the board's filters under a name, unique in any case, kept as `keptBoardFilters` leaves them and never with the Project filter.

**Talks to:** through ports bound in [app.module.ts](../../app.module.ts): `KnownProjects` to `ProjectService`, `ProjectWorktrees` to `TaskWorktrees`, `KnownPeople` to `RoleCards`, `KnownPipelines` to `PipelineLibrary`, `SessionPeople`, `SessionTasks`, `SessionInitiatives` (the Initiative a shaping session writes onto), `TaskThreads`, `InitiativeThreads` (the shaping Thread with the CTO, opened as an Idea is shaped when a CTO is hired, else started by the user: `POST /initiatives/:id/shaping`) and `IdeaCards` (the card `capture_idea` posts in the chat) to `ThreadService`, `TaskDecisions` to `DecisionService`, `ProposalDrafts` (the CTO's Proposals on an active Initiative, and Devops' Projects to onboard) to `ProposalService`, `NewProjects` (adding a Project from a Proposal, and its dry run) to `ProjectService`. Pipelines reacts to its events and moves started Tasks through `TaskService`. Work applies Proposals of the Office-wide limit with `OfficeLimitProposals` (`adapters/conversations/`), which fills Conversations' `ProposalAppliers` as Work starts and judges one by the contracts' rule Settings saves by, of a Project to onboard with `ProjectProposals` (the Project through `NewProjects`, then its Onboard Task through `OnboardingService`, which opens the Task's worktree itself since the Task skips Planning; `propose_project` is `OnboardingOfficeTools`), and of an Initiative with `InitiativeProposals`, judged as applying judges (`initiativeEditProblems`) and applied under the Initiative's hold; `WorkPortsForTestsModule` provides the registry.

**Traps:** a Project's onboarding is read from its Onboard Task alone (`isOnboardTask`, one per Project by a partial unique index; `projectOnboardingOf`), never from the Onboard Pipeline, which any Task may follow; Work serves it at `GET /onboardings` because Projects can't ask Work without the two Nest modules importing each other. A Task joins an Initiative only through `InitiativeRepository.addTask`, and the done check (`InitiativeService`, on a Task's `TaskStateChanged` to done or dropped, and on Confirm) goes through `InitiativeRepository.update`: both hold the Initiative's row, so no Task joins one becoming done. Whether the CTO may change an Initiative straight away is decided from the row as held (`InitiativeNotShaping`, thrown in the hold), never from a read before it; only then, outside the hold, is the change judged and drafted as a Proposal. Each CTO change judges what it asks before the state (`requireOpenTo` last), so a wrong or no-op request is never drafted. A dependency of an Initiative's Task changes holding the Initiative first and the dependencies after (`InitiativeRepository.changeDependencies`), the one order any hold of both takes. Start reads the Task's blockers in its own hold (`HeldAtStart`), and every change of dependencies takes one lock and reads every Task (`TaskRepository.changeDependencies`), so no two changes close a cycle; use those, never `update`, for either. The Task holds only its Pipeline's id; the Task's own copy of its Stages lives in Pipelines (`task_stages`), as decided with the user in task 10. A document's text is on disk, so the search keeps its own copy in `attachment_texts`, written with the Attachment as it is added and filled at start for those added before (`AttachmentService.fillDocumentTexts`); a searched field and the query split into words alike (`search-vector.ts`, `searchWords`), so change both together. Every test file shares the `work_settings` row each Start reads: a test that lowers the limit overrides `WorkSettings` with `WorkSettingsForTests`.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

IdeaService, OfficeLimits, StageScreenshots, TaskRecords, TaskService, AttachmentAdded, AttachmentMoved, AttachmentRemoved, IdeaCaptured, IdeaDropped, IdeaRestored, IdeaShaped, IdeaShapedIntoInitiative, InitiativeCreated, InitiativeStateChanged, OfficeWideLimitChanged, TaskCreated, TaskDefinitionOfDoneConfirmed, TaskDefinitionOfDoneProposed, TaskPaused, TaskPipelineConfirmed, TaskPipelineProposed, TaskPlanConfirmed, TaskPlanProposed, TaskPriorityChanged, TaskTagsChanged, TaskReordered, TaskResumed, TaskStarted, TaskStateChanged, TaskStopped, WorkModule

## Domain events

- `domain/attachment-events.ts`: AttachmentAdded, AttachmentMoved, AttachmentRemoved
- `domain/idea-events.ts`: IdeaCaptured, IdeaShaped, IdeaShapedIntoInitiative, IdeaDropped, IdeaRestored
- `domain/initiative-events.ts`: InitiativeCreated, InitiativeStateChanged, InitiativeOutcomeWritten
- `domain/office-limit-events.ts`: OfficeWideLimitChanged
- `domain/saved-view-events.ts`: SavedViewSaved, SavedViewRemoved
- `domain/task-events.ts`: TaskCreated, TaskStateChanged, TaskPriorityChanged, TaskTagsChanged, TaskReordered, TaskPlanProposed, TaskPlanConfirmed, TaskDefinitionOfDoneProposed, TaskDefinitionOfDoneConfirmed, TaskPipelineProposed, TaskPipelineConfirmed, TaskPaused, TaskStopped, TaskResumed, TaskDependencyAdded, TaskDependencyRemoved, TaskStarted

## HTTP routes (under `/api`)

- `GET /ideas/:id/attachments`: AttachmentsController.listOfIdea
- `GET /initiatives/:id/attachments`: AttachmentsController.listOfInitiative
- `GET /tasks/:id/attachments`: AttachmentsController.listOfTask
- `POST /ideas/:id/attachments/links`: AttachmentsController.addLinkToIdea
- `POST /initiatives/:id/attachments/links`: AttachmentsController.addLinkToInitiative
- `POST /tasks/:id/attachments/links`: AttachmentsController.addLinkToTask
- `GET /attachments/:id/content`: AttachmentsController.content
- `DELETE /attachments/:id`: AttachmentsController.remove
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

## Tables

- `adapters/postgres/saved-views.schema.ts`: saved_views
- `adapters/postgres/work-settings.schema.ts`: work_settings
- `adapters/postgres/work.schema.ts`: ideas, initiatives, tasks, attachments, attachment_texts

## Files

### ./

- `work-application.fixtures.ts`: WorkApplication, startWorkApplication, webEventsOf, sendJson
- `work.module.ts`: WorkModuleOptions, WorkModule

### adapters/conversations/

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
- `ideas.controller.ts`: IdeasController
- `initiatives.controller.ts`: InitiativesController
- `office-limits.controller.ts`: OfficeLimitsController
- `onboardings.controller.ts`: OnboardingsController
- `saved-views.controller.ts`: SavedViewsController
- `search.controller.ts`: SearchController
- `tasks.controller.ts`: TasksController
- `work-refusals.filter.ts`: WorkRefusalsFilter
- `work-responses.ts`: toIdeaResponse, toInitiativeResponse, toTaskResponse, toAttachmentResponse, toSearchResultsResponse, toOwnerResponse, toSavedViewResponse
- Tests: attachments.controller.test.ts, ideas.controller.test.ts, initiatives.controller.test.ts, office-limits.controller.test.ts, saved-views.controller.test.ts, search.controller.test.ts, tasks.controller.test.ts

### adapters/office-tools/

- `attachment-office-tools.ts`: ATTACH_FILE, ATTACH_LINK, AttachmentOfficeTools
- `onboarding-office-tools.ts`: OnboardingOfficeTools
- `planning-office-tools.ts`: WRITE_PLAN, WRITE_DEFINITION_OF_DONE, PROPOSE_PIPELINE, READ_ATTACHMENT, WRITE_TAGS, DOCUMENT_READ_LIMIT, PlanningOfficeTools
- `shaping-office-tools.ts`: READ_INITIATIVE, WRITE_OUTCOME, ADD_TASK, ADD_DEPENDENCY, REMOVE_DEPENDENCY, ShapingOfficeTools
- `work-office-tools.ts`: LIST_TASKS, READ_TASK, LIST_IDEAS, READ_IDEA, CREATE_TASK, WorkOfficeTools
- `work-tool-answers.ts`: OfficeToolResult, WorkToolRefused, answered, personInSession
- Tests: attachment-office-tools.test.ts, planning-office-tools.test.ts, shaping-office-tools.test.ts, work-office-tools.test.ts

### adapters/postgres/

- `postgres-attachment-repository.ts`: PostgresAttachmentRepository
- `postgres-idea-repository.ts`: PostgresIdeaRepository
- `postgres-initiative-repository.ts`: PostgresInitiativeRepository
- `postgres-saved-view-repository.ts`: PostgresSavedViewRepository
- `postgres-task-repository.ts`: PostgresTaskRepository
- `postgres-work-search.ts`: PostgresWorkSearch
- `postgres-work-settings.ts`: PostgresWorkSettings
- `saved-views.schema.ts`: savedViews
- `search-vector.ts`: searchVectorOf
- `work-rows.ts`: Transaction, IdeaRow, InitiativeRow, TaskRow, AttachmentRow, holdManualOrder, holdStarts, everyTaskHoldingDependencies, changeDependenciesHeld, heldTask, saveTask, takenOrders, toIdeaRow, toIdea, toInitiativeRow, toInitiative, toTaskRow, toTask, ownerColumns, toAttachmentRow, toAttachment
- `work-settings.schema.ts`: workSettings
- `work.schema.ts`: ideas, initiatives, tasks, attachments, attachmentTexts
- Tests: postgres-work-repositories.test.ts

### adapters/websocket/

- `work-web-events.ts`: WorkWebEvents

### application/

- `attachment-service.ts`: UploadedFile, OpenedFile, DocumentText, AttachmentService
- `idea-service.ts`: IdeaService
- `initiative-service.ts`: CtoChange, InitiativeService
- `office-limits.ts`: OfficeLimits
- `onboarding-service.ts`: OnboardingService
- `planning-service.ts`: PlanningService
- `saved-view-service.ts`: SavedViewService
- `search-service.ts`: Found, InOtherProjects, SearchResults, SearchService
- `stage-screenshots.ts`: ScreenshotsAttaching, StageScreenshots
- `start-service.ts`: StartService
- `task-records.ts`: TaskRecord, TaskRecords
- `task-service.ts`: TaskService
- Tests: planning-test-project-check.test.ts, shaping-with-the-cto.test.ts, stage-screenshots.test.ts, task-records.test.ts, test-project-check.test.ts

### domain/

- `attachment-changes.ts`: AttachmentChange, Adding, addLink, addFile, moveAttachment, removeAttachment
- `attachment-events.ts`: AttachmentAdded, AttachmentMoved, AttachmentRemoved
- `attachment-not-found.ts`: AttachmentNotFound
- `attachment-refused.ts`: AttachmentRefused
- `attachment.ts`: AttachmentOwner, Attachment, AttachmentKind, NewLink, NewFile, ATTACHMENT_SIZE_LIMIT, SCREENSHOT_SIZE_LIMIT, mediaTypeOf, storedFileKind, attachmentLines, attachmentKindWords, trimmedNewLink, newLinkProblems, newFileProblems
- `author.ts`: Author, THE_USER
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
- `office-limit-events.ts`: OfficeWideLimitChanged
- `onboarding.ts`: ONBOARD_PIPELINE, ONBOARD_TASK_TITLE, onboardTaskPlan, ONBOARD_TASK_DEFINITION_OF_DONE, OnboardTaskSetting, createOnboardTask, OnboardingState, ProjectOnboarding, projectOnboardingOf
- `planning-changes.ts`: proposePlan, confirmPlan, proposeDefinitionOfDone, confirmDefinitionOfDone, proposePipeline, confirmPipeline
- `planning.ts`: PLANNER, PLANNING_THREAD_TITLE, PLANNING_INSTRUCTIONS, PLANNING_OPENING, PlanningProject, PlanningPipeline, PlanningRecord, planningBrief, confirmationWords
- `project-filter.ts`: ProjectFilter, isInProjectFilter
- `record-words.ts`: taskRecordText, initiativeRecordText, ideaRecordText, whereOf
- `saved-view-events.ts`: SavedViewSaved, SavedViewRemoved
- `saved-view-not-found.ts`: SavedViewNotFound
- `saved-view-refused.ts`: SavedViewRefused
- `saved-view.ts`: SAVED_VIEW_NAME_LENGTH, BoardFilters, SavedView, NewSavedView, keptBoardFilters, newSavedViewProblems, saveView
- `search.ts`: MAX_SEARCH_WORDS, SEARCH_RESULT_LIMIT, SEARCHED_TEXT_LIMIT, searchWords, searchedText
- `shaping.ts`: CTO, SHAPING_THREAD_TITLE, SHAPING_INSTRUCTIONS, SHAPING_OPENING
- `task-changes.ts`: TaskChange, NewTaskSetting, createTask, changeTaskState, undoPlanningMove, markTaskReady, changeStartedTaskState, pauseTask, stopTask, resumeTask, changePriority, reorderTask
- `task-dependencies.ts`: addDependency, createdWaitingFor, removeDependency, blockingTasks, blockedProblems
- `task-events.ts`: TaskCreated, TaskStateChanged, TaskPriorityChanged, TaskTagsChanged, TaskReordered, TaskPlanProposed, TaskPlanConfirmed, TaskDefinitionOfDoneProposed, TaskDefinitionOfDoneConfirmed, TaskPipelineProposed, TaskPipelineConfirmed, TaskPaused, TaskStopped, TaskResumed, TaskDependencyAdded, TaskDependencyRemoved, TaskStarted
- `task-not-found.ts`: TaskNotFound
- `task-refused.ts`: TaskRefused
- `task-start.ts`: StartingStage, DEFAULT_OFFICE_WIDE_LIMIT, TaskLimit, StartingPerson, StartConditions, HeldAtStart, firstAgentStage, startProblems, startTask
- `task-states.ts`: TASK_STATE_NAMES, NOT_STARTED_STATES, STARTED_STATES, stateChangeProblems, ReadinessLine, readinessLines, openDecisionProblems
- `task-tags.ts`: MAX_TAGS, MAX_TAG_LENGTH, normalizedTags, tagsProblems, changeTags
- `task.ts`: TASK_STATES, TaskState, PRIORITIES, Priority, Task, ProposedPipeline, NewTask, trimmedNewTask, newTaskProblems
- `title.ts`: titleProblem
- `work.fixtures.ts`: anIdea, anInitiative, aTask, aPlannedTask, aLink
- Tests: attachment-changes.test.ts, idea-changes.test.ts, initiative-changes.test.ts, initiative-edit.test.ts, manual-order.test.ts, onboarding.test.ts, planning-changes.test.ts, planning.test.ts, project-filter.test.ts, search.test.ts, task-changes.test.ts, task-dependencies.test.ts, task-start.test.ts, task-states.test.ts, task-tags.test.ts

### ports/

- `attachment-files.ts`: AttachmentFiles
- `attachment-repository.ts`: AttachmentRepository
- `idea-cards.ts`: IdeaCards
- `idea-repository.ts`: IdeaUpdate, ShapedIdea, IdeaShapedIntoInitiative, IdeaRepository
- `initiative-repository.ts`: InitiativeUpdate, InitiativeRepository
- `initiative-threads.ts`: InitiativeThreadOpening, InitiativeThreads
- `known-people.ts`: KnownPeople, KnownPerson
- `known-pipelines.ts`: KnownPipelines
- `known-projects.ts`: KnownProject, KnownProjects
- `new-projects.ts`: AddedProject, NewProjects
- `project-worktrees.ts`: TaskWorktree, ProjectWorktrees
- `proposal-drafts.ts`: ProposedInitiativeChange, ProposedProject, WorkProposedChange, ProposalDrafts
- `saved-view-repository.ts`: SavedViewRepository
- `session-initiatives.ts`: SessionInitiatives
- `session-people.ts`: SessionPeople
- `session-tasks.ts`: SessionTasks
- `task-decisions.ts`: TaskDecisions
- `task-repository.ts`: TaskUpdate, NeighbourIds, TaskRepository
- `task-threads.ts`: TaskThreadOpening, TaskThreads
- `work-ports.fixtures.ts`: UNKNOWN_PROJECT, KnownProjectsForTests, NewProjectsForTests, ProjectWorktreesForTests, KnownPeopleForTests, WorkSettingsForTests, SessionPeopleForTests, UNKNOWN_SESSION, IdeaCardsForTests, SessionTasksForTests, SessionInitiativesForTests, TaskThreadsForTests, InitiativeThreadsForTests, TaskDecisionsForTests, ProposalDraftsForTests, WorkPortsForTestsModule
- `work-search.ts`: SearchMatches, WorkSearch
- `work-settings.ts`: WorkSettings
- `worktree-files.ts`: WorktreeFile, WorktreeFileLimits, WorktreeFiles
