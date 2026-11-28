# Conversations: module map

## Owns

- Threads, each one engine session (`threads`, `thread_messages`), and The Office's message log; the session runners `ThreadRunner` (people's Threads) and `StageThreads` (Stage Threads), whose session lives `LiveSessions` owns.
- Decisions (`decisions`: forms, approvals, requests, bug-task), Consultations and calls (`Consultations`, `CallChains`), Proposals (`proposals`, generic over `ProposedChange`, applied through the `ProposalAppliers` registry), Link cards, Idea and Office status cards (`ThreadCards`).
- The Context policy and its settings (`conversations_settings`, Stage context limits), the Office instructions (`office_instructions_versions`), Allow changes (`changes_allowed`), fire alarm lifts (`fire_alarm_lifts`), what the user has seen (`thread_seen`).
- Sub-agents and Processes (`sub_agents_and_processes`, `sub_agent_messages`, `process_output`, `SessionFollowing`), images in messages (`ThreadImages`), tokens per Thread and Task (`TaskTokens`), the Live view's read model, people working on Tasks, `read_threads`.
- Each session's place, Brief and Office tools (`SessionPlaces`, `Briefs`, `HAND_WRITTEN_TOOL_GROUPS`, `OfficeToolRulings`, `HeldCalls`), `run_environment_check`, `change_project_settings`, `CONVERSATIONS_PROMPT_TEMPLATES`.

## Talks to

- Engine (sessions, `OfficeToolRegistry`, `carrySession`, `EngineSessions.standInFor`/`usedUpUntil`), People (`RoleCards`, `Duties`, `EngineCascade` for engine, model and effort at `cascadeLocationOf`; `EngineCascadeModule` through `register`'s `imports`).
- Skills (session skills, `SkillCommands`), MCP servers (`SessionMcpServers`), Prompt templates (`PromptTemplates.textsOf`), Busy work (`BusyWork` for background Sub-agents).
- Projects: `ProjectBases`→`BaseCheckouts`, `ProjectRecordSource`→`ProjectRecords`, `ProjectOutputMasks`→`ProjectService`, `EnvironmentChecks.check`, `RunEnvironmentSwitchRegistry` (filled by Run environments); fills `TestTargetsChatThreads`.
- Work fills `TaskThreadSetups`, `InitiativeThreadSetups`, `WorkRecords`, `FireAlarmInThreads`, `MessageImages` and Bug-task/Initiative/Project appliers; Work and Pipelines reach Conversations through ports bound to `StageThreads`, `StageDecisions`, `ThreadRunner`, `WorkThreads`, `SessionThreads`, `DecisionService`.
- `SessionThreads` is the one service for "which Thread is this session in" (Work, Pipelines, Devices, Test instances); People, Projects and Skills get it through `SessionPeopleForModules`. `ThreadService` serves only the Threads page; bind no other port to it.
- Notifications: `WaitingInConversations`→`WaitingOnTheUser`; Telemetry: `ThreadsAtWork.sessionsWorking()`; Pipelines: `ConsultationsOnTasks`→`TaskConsultations`, `StageThreadMessages`.
- Pipelines' domain takes `CHANGE_PROJECT_SETTINGS_TOOL` and `RUN_ENVIRONMENT_CHECK_TOOL` from `index.domain.ts`.

## Traps

- `MessagesLogged.threadChanged`: a change that alters the Thread with its log passes the stored Thread as `before` to `logMessages`, or the web only reads the log on (`messagesAfter`).
- `conversations-prompts.golden.ts` is never edited; parts render first as text (`renderedPart`, `flagField`, `optionLines`). Test apps providing `SessionPlaces`, `Briefs`, `StageThreads` or `ThreadRunner` import `ConversationsPromptTemplatesForTests`.
- Those test apps also provide `MessageImages`, `ThreadImages`, `MessageImageRules`, `skillCommandsProvider()`, `OfficeInstructions` over `OfficeInstructionsRepositoryForTests`, bind `ConversationsSettingsForTests` (the shared row only ever holds the default), and import `ScheduleModule`.
- `MessageImages` throws while nothing is registered: tests with images provide `MessageImagesInMemory`. Images are typed by their bytes (`pictureMediaTypeOf`), never the browser's media type.
- A session never resumes on another engine (`engine-changed` starts fresh), except a stand-in counting as its own; under an engine override (`Continuation.forced`) no stand-in list applies.
- Moving a Stage session to a stand-in is only `StageThread.switchTo`/`carrySessionToEngine`, in order: end, copy, persist the move, resume; a failed resume moves it back (`moveSessionBack`).
- `LiveSessions` owns every session life; `end` waits for `settle`, so never call it from inside an opening's own chain (use `endSession`). An opening checks `SessionOpening.check` after each await.
- `StageThreads` reads a session with one reader for its whole life; `endSession` waits for it. Stage sessions run with `subAgentsInForeground`.
- A session on an Initiative works in `ProjectBases.folder` even once it reads the Initiative's branch (a readable folder): Claude Code keys transcripts by folder. Its Brief is read before `ready()`, so `listOnInitiative` must not fetch.
- Never hand a session a folder that isn't there: a Task with no worktree reads checkouts as a chat does (`checkoutsPlace`).
- Process output is masked by whole lines (`WholeLines`, `HELD_LINE_MS`); a Task session's text goes through the Project's mask in `sessionLogLines` before it is stored or sent; sessions without a Project use `NO_MASK`.
- A running session can't change its Office tools: `ThreadRunner.answer` resumes one whose tools changed; changed duties start fresh (`duties-changed`), as does an Allow changes switch (`changes-switched`).
- Tools offered follow the Authority alone (`offeredToPerson`); instructions follow held duties (`HeldDuties`). Caretaker narrowing is `CARETAKER_NEVER_TOOLS`/`CARETAKER_ONLY_TOOLS`, pinned by `offered-office-tools.full.test.ts`.
- Never put `read_stage_history` or `read_threads` in `READING_OFFICE_TOOLS` (Agent Stages start from it); they are in `PERSON_READING_OFFICE_TOOLS`. Test apps opening a session without Pipelines' tools stand in for `list_pipelines` and `list_stage_templates`.
- A held call never waits in the tool call: it opens an approval Decision; the identical repeat runs once (`approval_spent_at`). A chat has no Decision to wait in outside the inline form.
- Only `application/thread-runner.test.ts` leaves Threads answering and recovers interrupted answers.
- A Decision with `putTo` is out of `openDecisions()` and raises no Notification; `unansweredOn` keeps it. Chat Decisions never appear in `openDecisions()`.
- `answer_decision` records `atUsersRequest`, never `answeredBy` (the Consultant's alone).
- `decisions.attachmentIds` have no foreign key: `open_decision` checks them as it opens; a reader looks each up.
- Bug-task answers hold the Decision's id (`KeyedLocks`) while Work creates the Task, with no transaction held; only The Office sets `createdTaskId`.
- Applying a Proposal holds its row (`updateProposal`); `office-instructions` and `duties` refuse a stale `from` in `apply` only. A `change` keeps only its rewritten fields and merges onto the card as it is.
- Rollback: `decisions` keeps the one-question columns filled (`oneQuestionView` …), Proposal Role cards keep `hardSwitches` beside `authority`; Proposals of unknown kinds map to `{kind: "unknown"}`.
- The generic `office-action` Proposal's fingerprint is rechecked at apply (`ProposalOutOfDate`); it isn't one transaction with the handler.
- A message counts as answered unless its kind is in `USERS_OWN_MESSAGE_KINDS`: a new user-made kind goes there.
- A list row (`ThreadSummary`) reads everything once per page, never builds a Brief or reads a log; tests count the queries.
- Only the controller reads a skill command (`messageCommand`, `SentWith.skillCommandAmong`); the application never imports the contracts.
- `LiveView` reads again only when a Thread's busy state flips, and does no reads before its first `read`.
- Metric attributes never carry ids (spec §5.2); ids go only on spans and the call record.
- `PostgresConversationsSettings.sizeThreshold` goes through platform `readOnce`; writes run through `forgettingReads`.
- Deleting a chat Thread asks the engine to remove its files (`forgetSession`) before the skills folder goes; Stats and `test_targets_chats` keep rows naming it.
- The proposal-service test boots the real People module; see the test's setup before changing it.
- `StageDecisions.open` with an `id` it has already opens nothing: it answers that Decision and starts its Consultation if it hadn't (`walkDecisionId`).
- Records naming users are claimed by `ConversationsEarlierRecords` only where JSON null, never a field left out.

## Spec

- [2.4 Conversations](../../../../../docs/spec/2.4-conversations.md), [2.4.1 Threads](../../../../../docs/spec/2.4.1-threads.md), [2.4.2 Decisions](../../../../../docs/spec/2.4.2-decisions.md), [2.4.3 Consultations](../../../../../docs/spec/2.4.3-consultations.md)
- [2.4.4 Messages](../../../../../docs/spec/2.4.4-messages.md), [2.4.5 Stopping and restarts](../../../../../docs/spec/2.4.5-stopping-and-restarts.md), [2.4.6 Reading records](../../../../../docs/spec/2.4.6-reading-records.md), [2.5 Context policy](../../../../../docs/spec/2.5-context-policy.md)
- [2.9 Sub-agents and Processes](../../../../../docs/spec/2.9-sub-agents-and-processes.md), [5.4.6 Stand-in Engines](../../../../../docs/spec/5.4.6-stand-in-engines-and-usage-windows.md), [6 Permissions](../../../../../docs/spec/6-permissions-and-safety.md)

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

ContextPolicySettingsService, StageContextLimits, DecisionService, DecisionWaitingOnTheUser, ConsultationsOnTasks, ConsultationOnTask, InitiativeThreadSetups, InitiativeThreadRequest, InitiativeThreadSetup, InitiativeThreadSource, InitiativeBranchReads, FireAlarmInThreads, ThreadsFireAlarm, InterruptedAnswers, SubAgentsAndProcesses, ProposalAppliers, BugTaskApplier, CreatedBugTask, ProposalApplier, SettingProposalApplier, BugTaskFields, StageDecisions, StageDecisionRequest, stageAnswerOf, StageAnswer, decisionSummary, StageThreads, StageSessionSettings, StageThread, StageThreadRequest, StageTurn, SwitchFailed, StageThreadMessages, StageRunWindow, TaskTokens, TaskThreadSetups, TaskThreadRequest, TaskThreadSetup, TaskThreadSource, ThreadRunner, SessionThreads, ThreadCards, ThreadsAtWork, ThreadService, WaitingOnTheUser, InitiativeReply, WorkThreads, InitiativeThreadOpening, TaskThreadStarting, WorkRecords, ProjectWork, TaskSubject, WorkRecordSource, MessageImageOwner, MessageImages, MessageImageSource, NewMessageImage, StoredMessageImage, ConversationsModule, PlanningThreadElsewhere, DecisionAnswered, DecisionClosed, DecisionOpened, DecisionReopened, MessagesLogged, ProposalApplied, ProposalDeclined, ProposalDrafted, ThreadSessionMovedToEngine, TokensCounted, TurnEnded, ProposalService, PipelineStage, ProjectPipelineFields, ProposedInitiativeChange, ProposedPipelineChange, ProposedFeatureSwitches, ProposedProject, ProposedProjectPipelineChange, ProposedSettingChange, ProposedStageTemplateChange, CALLING_RULE, CHANGE_PROJECT_SETTINGS_TOOL, LIST_PIPELINES_TOOL, LIST_STAGE_TEMPLATES_TOOL, PROPOSE_PROJECT_TOOL, PERSON_READING_OFFICE_TOOLS, READ_REPOSITORY_TOOL, READ_STAGE_HISTORY_TOOL, READ_THREADS_TOOL, READING_OFFICE_TOOLS, RUN_ENVIRONMENT_CHECK_TOOL, ProposalRefused

## Domain events

- `domain/conversation-events.ts`: ThreadStarted, ThreadRenamed, ThreadSeen, ThreadDeleted, MessagesLogged, DeliveryMarked, TurnEnded, TokensCounted, ContextRead, ThreadSessionMovedToEngine, ContextOverrideChosen, DecisionOpened, DecisionAnswered, DecisionClosed, DecisionReopened, ProposalDrafted, ProposalApplied, ProposalDeclined, SizeThresholdChanged, OfficeInstructionsChanged, SubAgentOrProcessChanged, SubAgentMessagesKept, ProcessOutputKept, LiveViewChanged

## HTTP routes (under `/api`)

- `GET /decisions/open`: DecisionsController.listOpen
- `GET /tasks/:taskId/decisions/unanswered`: DecisionsController.listUnansweredOn
- `POST /decisions/:id/answer`: DecisionsController.answer
- `GET /fire-alarm/lifts`: FireAlarmLiftsController.list
- `PUT /fire-alarm/lifts/:threadId`: FireAlarmLiftsController.lift
- `DELETE /fire-alarm/lifts/:threadId`: FireAlarmLiftsController.takeBack
- `GET /live-view`: LiveViewController.read
- `GET /settings/office-instructions`: OfficeInstructionsController.read
- `GET /proposals/open`: ProposalsController.listOpen
- `GET /proposals/:id`: ProposalsController.read
- `POST /proposals/:id/apply`: ProposalsController.apply
- `POST /proposals/:id/decline`: ProposalsController.decline
- `GET /settings/size-threshold`: SizeThresholdController.read
- `GET /settings/stage-context-limits`: StageContextLimitsController.read
- `GET /threads/:id/sub-agents-and-processes`: SubAgentsAndProcessesController.list
- `GET /threads/:id/sub-agents/:callId/messages`: SubAgentsAndProcessesController.messages
- `GET /threads/:id/processes/:callId/output`: SubAgentsAndProcessesController.output
- `GET /chats/activity`: ThreadsController.activityInChats
- `GET /people-working`: ThreadsController.peopleWorking
- `GET /chats/:roleKey/threads`: ThreadsController.listInChat
- `POST /chats/:roleKey/threads`: ThreadsController.startInChat
- `POST /chats/:roleKey/threads/delete`: ThreadsController.deleteInChat
- `GET /tasks/:taskId/threads`: ThreadsController.listOnTask
- `GET /tasks/:taskId/conversation`: ThreadsController.conversation
- `GET /tasks/:taskId/conversation/:roleKey/brief`: ThreadsController.firstBrief
- `POST /tasks/:taskId/conversation/:roleKey/thread`: ThreadsController.openPersonsThread
- `GET /initiatives/:initiativeId/threads`: ThreadsController.listOnInitiative
- `GET /roles/:roleKey/task-threads`: ThreadsController.listOnTasksWith
- `GET /threads/:id`: ThreadsController.read
- `PUT /threads/:id/title`: ThreadsController.rename
- `PUT /threads/:id/context-override`: ThreadsController.chooseOverride
- `PUT /threads/:id/allow-changes`: ThreadsController.allow
- `DELETE /threads/:id/allow-changes`: ThreadsController.switchOff
- `POST /threads/:id/stop`: ThreadsController.stop
- `PUT /threads/:id/seen`: ThreadsController.markSeen
- `GET /threads/:id/messages`: ThreadsController.messages
- `POST /threads/:id/messages`: ThreadsController.send

## Tables

- `adapters/postgres/changes-allowed.schema.ts`: changes_allowed
- `adapters/postgres/conversations-settings.schema.ts`: conversations_settings
- `adapters/postgres/fire-alarm-lifts.schema.ts`: fire_alarm_lifts
- `adapters/postgres/office-instructions.schema.ts`: office_instructions_versions
- `adapters/postgres/sub-agents-and-processes.schema.ts`: sub_agents_and_processes, sub_agent_messages, process_output
- `adapters/postgres/thread-seen.schema.ts`: thread_seen
- `adapters/postgres/threads.schema.ts`: threads, thread_messages, decisions, proposals

## Files

### ./

- `conversations.module.ts`: ConversationsModuleOptions, ConversationsModule
- `index.domain.ts`: CHANGE_PROJECT_SETTINGS_TOOL, RUN_ENVIRONMENT_CHECK_TOOL
- `index.fixtures.ts`: Briefs, ThreadRepository, ANN_LEE, BEN_ITO
- Tests: conversations.module.test.ts

### adapters/http/

- `contract-message-image-rules.ts`: ContractMessageImageRules
- `conversation-responses.ts`: toThreadResponse, toThreadSummaryResponse, toTaskThreadSummaryResponse, toPeopleWorkingResponse, toChatActivityResponse, CardRecords, toTaskConversationResponse, toMessageResponse, toProposalResponse, toDecisionResponse
- `conversations-settings-office-actions.controller.ts`: ConversationsSettingsOfficeActionsController
- `decisions.controller.ts`: DecisionsController
- `devops-chat.fixtures.ts`: NINA_ROLE_CARDS, NINA_DUTIES, aSkillName, DevopsChat
- `fire-alarm-lifts.controller.ts`: FireAlarmLiftsController
- `live-view-responses.ts`: toLiveViewResponse
- `live-view.controller.ts`: LiveViewController
- `office-instructions.controller.ts`: OfficeInstructionsController
- `proposals.controller.ts`: ProposalsController
- `size-threshold.controller.ts`: SizeThresholdController
- `stage-context-limits.controller.ts`: StageContextLimitsController
- `sub-agent-and-process-responses.ts`: toSubAgentOrProcessResponse, toSubAgentResponse, toProcessResponse, toSubAgentMessageResponse, toSubAgentMessagesResponse, toOutputChunkResponse, toProcessOutputResponse
- `sub-agents-and-processes.controller.ts`: SubAgentsAndProcessesController
- `thread-refusals.filter.ts`: ThreadRefusalsFilter
- `threads.controller.ts`: THREAD_IMAGE_UPLOAD_ROUTE, ThreadsController
- Tests: conversation-responses.test.ts, live-view.controller.test.ts, sub-agents-and-processes.controller.test.ts, threads.controller.full.test.ts, threads.controller.test.ts

### adapters/office-actions/

- `conversations-settings-office-actions.ts`: ConversationsSettingsOfficeActions
- Tests: conversations-settings-office-actions.test.ts

### adapters/office-tools/

- `action-office-tools.ts`: actionInputWith
- `bug-task-office-tools.ts`: BUG_TASK_DECISION_OPENED, BugTaskOfficeTools
- `decision-office-tools.ts`: DecisionOfficeTools
- `environment-check-office-tools.ts`: ENVIRONMENT_CHECK_TOOL_TIMEOUT_MS, EnvironmentCheckOfficeTools
- `link-card-office-tools.ts`: LinkCardOfficeTools
- `memory-office-tools.fixtures.ts`: Draft, SESSION, toolWith, card
- `memory-office-tools.ts`: MemoryOfficeTools
- `project-setting-office-tools.fixtures.ts`: SESSION, TASK, SECRET_VALUE, BY_NINA, SHOP, WEB_TARGET, BUILD_ACTION, RELEASE_ACTION, Change, toolsWith, ProjectSettingServices, toolsOn, runOf, checkOf, approvalLinesOf
- `project-setting-office-tools.ts`: ProjectSettingOfficeTools
- `prompt-template-office-tools.fixtures.ts`: A_GREETING, A_BRIEF, promptTemplateTools
- `prompt-template-office-tools.ts`: PromptTemplateOfficeTools
- `proposal-office-tools.ts`: ProposalOfficeTools
- `refused-to-the-agent.ts`: refusedToTheAgent
- `skill-office-tools.ts`: SkillOfficeTools
- `test-target-office-tools.ts`: targetInput, TargetInput, proposedTargets
- `thread-history-office-tool.ts`: ThreadHistoryOfficeTool
- Tests: environment-check-office-tools.test.ts, memory-office-tools.full.test.ts, memory-office-tools.test.ts, project-setting-office-tools.full.test.ts, project-setting-office-tools.test.ts, project-setting-records.full.test.ts, prompt-template-office-tools.full.test.ts, prompt-template-office-tools.test.ts, proposal-office-tools.full.test.ts

### adapters/postgres/

- `changes-allowed.schema.ts`: changesAllowed
- `conversations-earlier-records.ts`: ConversationsEarlierRecords
- `conversations-settings.schema.ts`: conversationsSettings
- `fire-alarm-lifts.schema.ts`: fireAlarmLifts
- `office-instructions.schema.ts`: officeInstructionsVersions
- `postgres-changes-allowed-repository.ts`: PostgresChangesAllowedRepository
- `postgres-chat-activity-repository.fixtures.ts`: app, database, repository, threads, AT, aThreadWithAnswer, setUpEachTest
- `postgres-chat-activity-repository.ts`: PostgresChatActivityRepository
- `postgres-conversations-settings.ts`: PostgresConversationsSettings
- `postgres-fire-alarm-lift-repository.ts`: PostgresFireAlarmLiftRepository
- `postgres-office-instructions-repository.fixtures.ts`: ROLLED_BACK, app, database, rolledBack, save, setUpEachTest
- `postgres-office-instructions-repository.ts`: PostgresOfficeInstructionsRepository
- `postgres-sub-agent-and-process-repository.ts`: PostgresSubAgentAndProcessRepository
- `postgres-thread-repository.fixtures.ts`: app, repository, aThreadOfItsOwn, AT, setUpEachTest
- `postgres-thread-repository.ts`: PostgresThreadRepository
- `saved-decision-forms.ts`: toSavedQuestions, fromSavedQuestions, toSavedFormAnswer, fromSavedFormAnswer
- `sub-agents-and-processes.schema.ts`: subAgentsAndProcesses, subAgentMessages, processOutput
- `thread-seen.schema.ts`: threadSeen
- `threads.schema.ts`: SavedPassedOn, SavedMessage, SavedDecisionAnswerLine, SavedQuestion, SavedQuestionAnswer, SavedFormAnswer, ThreadSessionRow, threads, threadMessages, decisions, proposals
- Tests: conversations-earlier-records.test.ts, postgres-chat-activity-repository.full.test.ts, postgres-chat-activity-repository.test.ts, postgres-conversations-settings.test.ts, postgres-office-instructions-repository.full.test.ts, postgres-office-instructions-repository.test.ts, postgres-sub-agent-and-process-repository.test.ts, postgres-thread-repository.full.test.ts, postgres-thread-repository.test.ts, saved-decision-forms.test.ts

### adapters/projects/

- `projects-test-targets-chat-registration.ts`: draftsTestTargetsOf, ProjectsTestTargetsChatRegistration
- Tests: projects-test-targets-chat-registration.test.ts

### adapters/prompt-templates/

- `conversations-prompt-templates.fixtures.ts`: ConversationsPromptTemplatesForTests
- `conversations-prompt-templates.ts`: ConversationsPromptTemplates
- Tests: conversations-prompt-templates.test.ts

### adapters/proposals/

- `duty-proposals.ts`: DutyProposals
- `office-instructions-proposals.ts`: OfficeInstructionsProposals
- `prompt-template-proposals.ts`: PromptTemplateProposals
- `size-threshold-proposals.ts`: SizeThresholdProposals

### adapters/session-people/

- `session-people-source.ts`: SessionPeopleForModules

### adapters/websocket/

- `live-view-web-events.ts`: LiveViewWebEvents
- `thread-web-events.ts`: ThreadWebEvents

### application/

- `action-proposals.ts`: ActionProposals
- `allow-changes.ts`: AllowChanges
- `approval-holds.fixtures.ts`: RunEveryOfficeToolCall
- `approval-holds.ts`: ApprovalHolds
- `barge-ins.ts`: BargeInMessage, BargeInsAfterTurn, BargeIns
- `briefs.ts`: Briefs
- `bug-task-decisions.ts`: BugTaskProposal, BugTaskDecisions
- `call-chains.ts`: CallChains
- `chat-activity.ts`: ThreadActivity, ChatActivity
- `chat-thread-deletions.ts`: ChatThreadDeletions
- `closed-consultation-proposals.ts`: ClosedConsultationProposals
- `consultations-on-tasks.ts`: ConsultationOnTask, ConsultationsOnTasks
- `consultations.ts`: STOPPED_BY_THE_FIRE_ALARM, Consultations
- `context-policy-settings.ts`: ContextPolicySettingsService
- `decision-service.ts`: DecisionWaitingOnTheUser, OpenedDecision, DecisionService
- `duties.fixtures.ts`: DutiesStandIn, dutiesProvider
- `fire-alarm-in-threads.ts`: ThreadsFireAlarm, FireAlarmInThreads
- `fire-alarm-lifts.ts`: HELD_BY_THE_FIRE_ALARM, FireAlarmLifts
- `held-calls.fixtures.ts`: SESSION, CALL, request, Setup, heldCallsWith, anApproval, call
- `held-calls.ts`: HeldCallOutcome, HeldCallRequest, HeldCall, HeldCalls
- `initiative-thread-setups.ts`: InitiativeThreadRequest, InitiativeThreadSetup, InitiativeThreadSource, InitiativeThreadSetups
- `interrupted-answers.ts`: InterruptedAnswers
- `link-cards.ts`: LinkCardRequest, LinkCards
- `live-sessions.ts`: SessionPhase, SessionOwner, OpeningStopped, SessionOpening, BargeInWritten, LiveSessions
- `live-view.ts`: LiveView
- `mentioned-records.ts`: MentionedRecords
- `message-images.fixtures.ts`: MessageImagesInMemory
- `message-images.ts`: StoredMessageImage, NewMessageImage, MessageImageSource, MessageImages
- `office-action-proposals.ts`: OfficeActionProposals
- `office-instructions.ts`: OfficeInstructions
- `office-tool-rulings.ts`: OfficeToolRulings
- `open-page-records.fixtures.ts`: openPageRecordProviders
- `project-command-proposals.ts`: ProjectCommandProposals
- `proposal-appliers.ts`: ProposalApplier, SettingProposalApplier, CreatedBugTask, BugTaskApplier, ProposalAppliers
- `proposal-service.ts`: ProposalWaitingOnTheUser, ProposalService
- `role-proposals.ts`: RoleProposals
- `session-carry.ts`: SessionCarry, CarriedSession, SessionCarrying, carrySessionToEngine
- `session-log.ts`: SessionEvent, SessionLogger, sessionLogLines
- `session-mcp-servers.fixtures.ts`: SessionMcpServersStandIn, HeldPreparation, sessionMcpServersStandIn
- `session-memory.fixtures.ts`: MemoryAsk, sessionMemoryProvider
- `session-memory.ts`: SessionMemory
- `session-places.ts`: SessionPlace, SessionMetric, SessionPlaces
- `session-role.fixtures.ts`: aPlannerCard
- `session-start-watch.ts`: SESSION_START_SILENCE_MS, SessionStartStep, WatchedSessionStart, SessionStartWatch
- `session-stops.ts`: SessionStops
- `session-threads.ts`: SessionThreads
- `skill-commands.fixtures.ts`: SkillCommandsStandIn, skillCommandsProvider
- `skill-install-proposals.ts`: SkillInstallProposals
- `skill-proposals.ts`: SkillProposals
- `skill-update-proposals.ts`: SkillUpdateProposals
- `stage-decisions.ts`: StageQuestion, StageDecisionRequest, OpenedStageDecision, StageDecisions
- `stage-thread-messages.ts`: StageThreadMessages
- `stage-threads.ts`: StageSessionSettings, StageThreadRequest, StageThreadStandIn, StageSessionAhead, StageTurn, StageTurnContext, AskedDecision, StageThread, StageThreads, stageThreadTelemetry
- `sub-agents-and-processes.ts`: FollowedSession, SubAgentMessagesRead, ProcessOutputRead, SubAgentsAndProcesses, SessionFollowing
- `task-conversations.ts`: TaskConversations
- `task-thread-setups.ts`: TaskThreadRequest, taskThreadRequest, TaskThreadSetup, TaskThreadSource, TaskThreadSetups
- `task-tokens.ts`: EngineIdTokens, TaskTokens
- `test-target-proposals.ts`: TestTargetProposals
- `thread-cards.ts`: ThreadCards
- `thread-contexts.ts`: ThreadReading, ThreadContexts
- `thread-history.ts`: ThreadHistoryQuery, StageRunWindow, ThreadHistory
- `thread-images.ts`: MessageImageContent, PastedImage, FOREIGN_IMAGE_PROBLEM, ThreadImages
- `thread-runner.ts`: ThreadStop, SkillCommandSent, SentWith, ThreadRunner, threadTelemetry
- `thread-service.ts`: ThreadService
- `thread-summaries.ts`: ThreadSummary, TaskThreadSummary, ThreadSummaries
- `threads-at-work.ts`: ThreadsAtWork
- `waiting-on-the-user.ts`: InitiativeReply, WaitingOnTheUser
- `work-records.fixtures.ts`: NO_WORK_RECORDS, taskSubjectsAs
- `work-records.ts`: WorkRecordSource, TaskSubject, ProjectWork, WorkRecords
- `work-threads.ts`: InitiativeThreadWaiting, InitiativeThreadOpening, TaskThreadStarting, WorkThreads
- Tests: briefs.full.test.ts, consultations.full.test.ts, consultations.test.ts, copilot-cli-test-project-check.test.ts, decision-service.test.ts, devops-proposals.full.test.ts, devops-skill-sources.full.test.ts, held-calls.full.test.ts, held-calls.test.ts, link-cards.full.test.ts, live-sessions.test.ts, live-view.full.test.ts, message-images-test-project-check.test.ts, missing-command-set-up-by-devops.full.test.ts, office-instructions.full.test.ts, office-instructions.test.ts, office-tool-rulings.full.test.ts, openai-compatible-api-test-project-check.test.ts, proposal-appliers.test.ts, proposal-service.full.test.ts, proposal-service.test.ts, session-log.test.ts, session-memory.full.test.ts, session-start-watch.test.ts, session-telemetry.full.test.ts, stage-threads.full.test.ts, stage-threads.test.ts, sub-agents-and-processes.test.ts, task-tokens.test.ts, thread-history.test.ts, thread-runner.test.ts, threads-at-work.test.ts, waiting-on-the-user.full.test.ts

### domain/

- `brief-templates.ts`: BRIEF_MEMORY, BRIEF_PROJECTS, BRIEF_LATEST_EXCHANGES, BRIEF_ANSWERED_DECISIONS, BRIEF_OPEN_DECISION, BRIEF_OPEN_DECISION_ON_INITIATIVE, NEW_CHAT_THREAD_BRIEF, FRESH_CHAT_THREAD_BRIEF, FRESH_PERSONS_THREAD_BRIEF, TASK_THREAD_BRIEF, INITIATIVE_THREAD_BRIEF, BRIEF_OFFICE_TOOLS, BRIEF_TEMPLATES
- `brief.ts`: Brief, BriefProject, CHAT_EXCHANGES_TOKENS, MEMORY_TOKENS, estimatedTokens, BriefMemoryNote, BriefMemory, NO_MEMORY, MemoryReach, selectMemory, newChatThreadBrief, freshChatThreadBrief, freshPersonsThreadBrief, TaskThreadRecord, taskThreadBrief, InitiativeThreadRecord, initiativeThreadBrief, knowledgeBaseLine, withKnowledgeBase, BriefToolArea, BriefOfficeTools, withOfficeToolAreas
- `canonical-call.ts`: canonicalCall
- `chat-activity.ts`: ChatThreadActivity, AnsweredThread, PersonChatActivity, hasAnswered, chatActivityOfPeople
- `chat-not-found.ts`: ChatNotFound
- `consult.ts`: THE_OFFICE, APPROVAL_OPTIONS, approvalQuestion, CALL_STEPS, Consult, ConsultedParty, ConsultantPerson, consultantNamed, requestToOneselfRefusal, CallChain, callChain, canCall, callProblems, PassingOnTo, passedOnTo, consultDecision, consultantAnswerProblems, consultationTitle, consultationOpening, consultationAskedLine, consultationAnswerLine, backToTheCallerWords, passedOnToTheUserWords, couldNotAnswerWords, consultantCouldNotAnswerWords, couldNotAnswerLine
- `context-policy.fixtures.ts`: NOW, MINUTE, aContinuation
- `context-policy.ts`: SessionDefault, ContextMove, ContextReason, ContextPolicySettings, DEFAULT_CONTEXT_POLICY_SETTINGS, Continuation, ContextAlternative, ContextDecision, decideContext, ContextMoveSummary, summarizeContext
- `conversation-events.ts`: ThreadStarted, ThreadRenamed, ThreadSeen, ThreadDeleted, MessagesLogged, DeliveryMarked, TurnEnded, TokensCounted, ContextRead, ThreadSessionMovedToEngine, ContextOverrideChosen, DecisionOpened, DecisionAnswered, DecisionClosed, DecisionReopened, ProposalDrafted, ProposalApplied, ProposalDeclined, SizeThresholdChanged, OfficeInstructionsChanged, SubAgentOrProcessChanged, SubAgentMessagesKept, ProcessOutputKept, LiveViewChanged
- `conversation-tabs.ts`: TabConsultation, PlanningThreadElsewhere, ConversationTab, conversationTabs, isClosedConsultationOnTask
- `conversations-prompt-templates.ts`: CONVERSATIONS_PROMPT_TEMPLATES
- `conversations-prompts.golden-cases.fixtures.ts`: goldenCaseOutputs
- `conversations-prompts.golden.ts`: GOLDEN_OUTPUTS
- `decision-not-found.ts`: DecisionNotFound
- `decision.fixtures.ts`: aDecision, AT, TASK_HOME, SESSION, DRAFT, THREE_QUESTIONS, WARM, refusalOf
- `decision.ts`: isApproval, Recommendation, isBugTask, DecisionKind, ProposedBugTask, BugTaskFields, BUG_TASK_OPTIONS, CREATE_THE_BUG_TASK, FIX_THE_BUG_NOW, ChoiceQuestion, ChoiceOfSeveralQuestion, RecommendationOfSeveral, OpenQuestion, DecisionQuestion, hasOptions, recommendedOptions, DecisionDraft, bugTaskDraft, proposedBugTaskProblems, bugTaskToCreate, QuestionAnswer, DecisionAnswer, isDismissal, oneOptionAnswer, oneWordsAnswer, AtUsersRequest, AnswerGivenBy, GivenAnswer, Answerer, answerGivenBy, PassedOn, Decision, closedDecisionRefusal, isOpen, isTheOfficesOwn, DecisionOnTask, isOnTask, onlyChoice, decisionSummary, decisionProblems, attachmentProblems, answerProblems, createsTheBugTask, fixesTheBugNow, bugTaskAnswerProblems, dismissProblems, answerForUserProblems, questionAnswerWords, formAnswerWords, OneQuestionView, oneQuestionView, OneQuestionKind, formFromOne, oneQuestionKind, OneQuestionAnswer, oneAnswerView, formAnswerFromOne
- `deletion-lock.ts`: DeletionLock, deletionLockOf, deletionLockWords
- `hand-written-tool-groups.ts`: HAND_WRITTEN_TOOL_GROUPS, handWrittenGroupOf, CARETAKER_NEVER_TOOLS, CARETAKER_ONLY_TOOLS, withoutCaretakerNever, ActionTool, offeredToPerson
- `held-call.ts`: HeldCallRuling, heldCallRuling
- `link-card.ts`: LinkedTask, linkCardNote
- `live-view.ts`: HiredPerson, LiveViewState, LiveAgent, LiveAgentEngine, LiveConsulting, LiveWaitingOnYou, LivePerson, LiveView, LiveViewRecords, liveViewOf
- `mcp-tool-call.ts`: mcpToolCallWords
- `mention.ts`: Mention, MentionedRecord, briefWithMentionedRecords, withMentionedRecords, decisionRecordText
- `message-image-owner.ts`: MessageImageOwner, imageOwnerOf
- `message-not-found.ts`: MessageNotFound
- `message.ts`: Message, MessageDraft, USERS_OWN_MESSAGE_KINDS, latestWriter, StageWorkClosing, StoppedByUser, stoppedByUserLine, HeldBy, UsageWindowUsedUpLine, usageWindowUsedUpWords, ModelGaveWayLine, modelGaveWayWords, StageContextLimitLine, StageSessionRestartedLine, EngineSwitchedLine, engineSwitchedWords, MessageDelivery, MessageImage, IdeaCard, OfficeStatusCard
- `office-instructions-version-not-found.ts`: OfficeInstructionsVersionNotFound
- `office-instructions.ts`: OfficeInstructionsVersion, NO_OFFICE_INSTRUCTIONS, versionAfter
- `office-tool-ruling.ts`: ToolRuling, valueOnSubject, ownWorkValue, atLeastProposal, isOffered, toolRuling, officeToolCallWords, strictestValue, offeredTools
- `open-page.ts`: OpenPage, OpenPageRecord, OpenPageGiving, openPageToGive, sameOpenPage, briefWithOpenPageRecord, withOpenPageRecord
- `people-working.ts`: TaskPeopleWorking, worksIn, peopleWorkingOnTasks
- `proposal-changes.ts`: ProposalChange, applyProposal, declineProposal, declineProposalOnItsOwn
- `proposal-not-found.ts`: ProposalNotFound
- `proposal-out-of-date.ts`: ProposalOutOfDate
- `proposal-refused.ts`: ProposalRefused
- `proposal.fixtures.ts`: aProposedCard, aProposal
- `proposal.ts`: ProposedChanges, ProposedChangeKind, ProposedChange, RoleCardFields, IncomingCardFields, fieldsWithAuthority, ProposedHire, ProposedPresetHire, ProposedRoleChange, ProposedOfficeSetup, OfficeSettingValues, DutyHolders, OfficeSetting, ProposedSettingChange, ProposedPromptTemplateChange, ProposedInitiativeChange, InitiativeEdit, ProposedProjectCommands, ProposedTestTargetsChange, ProposedActionsChange, ProposedPipelineChange, PipelineEndPosition, ProposedStageTemplateChange, ProposedProjectPipelineChange, ProjectPipelineFields, ProposedFeatureSwitch, ProposedFeatureSwitches, ProposedProject, ProposedSkillInstall, ProposedSkillUpdate, AppliedSkillDiff, ProposedSkill, ProposedOfficeAction, PipelineStage, PipelineRoutes, ProposalDeclinedBecause, ProposalStatus, Proposal, EditedHire, proposedRoleChange, proposedChangeProblems, changeToApply, isEditableInLibraryEditor, proposalTargets, refuseUnlessOpen
- `session-instruction-templates.ts`: PERSON_INSTRUCTIONS, CHAT_INSTRUCTIONS, CARETAKER_INSTRUCTIONS, WORK_THREAD_INSTRUCTIONS, CONSULTATION_INSTRUCTIONS, HANDOVER_REQUEST, STAGE_SOFT_LIMIT, STAGE_HARD_LIMIT, SESSION_INSTRUCTION_TEMPLATES, chatInstructions, caretakerChatInstructions, workThreadInstructions, ConsultantSetup, consultationInstructions, handoverRequest, stageLimitMessage
- `session-instructions.ts`: SessionPerson, HeldDuties, SESSION_SHAPING_DUTIES, CONSULT_TOOL, CALLING_RULE, OPEN_DECISION_TOOL, CHAT_DECISION_RULE, DEFAULT_PERSON_CALLING_RULE, ALLOW_CHANGES_ADVICE, PROPOSE_OFFICE_SETUP_TOOL, OFFICE_SETUP_RULE, OFFICE_PROPOSALS_RULE, ENGINE_TRANSCRIPTS_RULE, OFFICE_INSTRUCTIONS_LEAD_IN, WRITING_FOR_THE_USER_RULE, READ_ROLE_TOOL, LIST_PIPELINES_TOOL, LIST_STAGE_TEMPLATES_TOOL, READING_OFFICE_TOOLS, READ_STAGE_HISTORY_TOOL, READ_THREADS_TOOL, PERSON_READING_OFFICE_TOOLS, ANSWER_DECISION_TOOL, READ_OFFICE_INSTRUCTIONS_TOOL, LIST_PROMPT_TEMPLATES_TOOL, READ_PROMPT_TEMPLATE_TOOL, POST_LINK_CARD_TOOL, SHOW_OFFICE_STATUS_TOOL, PROPOSE_PROJECT_TOOL, LIST_SOURCE_SKILLS_TOOL, READ_SKILL_UPDATE_TOOL, RUN_ENVIRONMENT_CHECK_TOOL, READ_REPOSITORY_TOOL, READ_REPOSITORY_RULE, CREATE_INITIATIVE_TOOL, PERSON_OFFICE_TOOLS, CHAT_OFFICE_TOOLS, STAGE_AUTHORITY_OFFICE_TOOLS, ToolHolder, personOfficeTools, threadOfficeTools, chatOfficeTools, caretakerChatOfficeTools, ThreadRecordKind, PersonTools, personToolsRule, stageCapabilityOfficeTools, ANSWER_CONSULTATION_TOOL, ConsultationPlace, consultationOfficeTools, REMEMBER_TOOL, CHANGE_PROJECT_SETTINGS_TOOL, sessionOfficeTools, briefedMessage, briefBeforeSkillCommand, messageFromUser, LeftOutServer, withLeftOutServers, openingMessage, decisionAnswerMessage, dismissalNote, AnsweredOnTask, decisionAnswersOnTasksMessage
- `stage-answer.ts`: StageAnswer, stageAnswerOf
- `stage-context-limits.ts`: StageContextLimits, StageContextLimit, DEFAULT_STAGE_CONTEXT_LIMITS, stageLimitsWithin, limitReached
- `sub-agent-or-process-not-found.ts`: SubAgentOrProcessNotFound
- `sub-agents-and-processes.ts`: Ending, ItemState, SubAgent, Process, SubAgentOrProcess, SubAgentMessageDraft, SubAgentMessage, OutputChunk, SessionWhere, OUTPUT_KEPT_BYTES, MESSAGES_KEPT, ENDED_ITEMS_KEPT, RESTART_ENDING, SESSION_END_ENDING, stateOf, endItem, progressSubAgent, changeSubAgent, OutputTrim, outputTrim, byteLength, WholeLines
- `switch-failed.ts`: SwitchFailed
- `thread-changes.ts`: ThreadChange, DeliveryMarking, ChatPerson, startChatThread, TaskThreadStart, startTaskThread, startStageThread, ConsultationThreadStart, startConsultationThread, InitiativeThreadStart, startInitiativeThread, renameThread, logMessages, freshSession, Answering, Opening, beginAnswer, BargingIn, bargeIn, finishedFirst, markDelivery, DecisionOpening, InitiativeThreadKind, openDecision, SHAPING_DECISION_ON_A_TASK, openDecisionOf, ProposalDrafting, draftProposal, DecisionAnswering, answerDecision, keepAnswerForTurnEnd, dismissDecision, deliverWaitingAnswers, DecisionRecording, recordDecisionAnswer, closeDecision, beginOpening, beginAskingAgain, beginStageWork, StageOpening, restartStageSession, StageWorkEnding, endStageWork, TurnCount, endTurn, countRunningTurn, readRunningContext, SessionMoveToEngine, moveSessionToEngine, startSessionFreshOnEngine, putBackReplacedSession, moveSessionBack, stopAnswer, UnopenedSession, failAnswer, failDecisionAnswer, reopenDecision, putDecisionToUser, PassingOn, passDecisionOn, chooseOverride
- `thread-history-words.ts`: THREAD_HISTORY_READ_LIMIT, MESSAGE_WORDS_LIMIT, HistoryRecords, MessageInHistory, ThreadMessagesRead, messageInHistory, ThreadHistoryAnswer, threadHistoryWords
- `thread-not-found.ts`: ThreadNotFound
- `thread-refused.ts`: ThreadRefused
- `thread-title.ts`: TITLE_LENGTH, titleFrom, titleProblems
- `thread.fixtures.ts`: aThread, storedBeforeOfficeInstructions, aUserMessage
- `thread.ts`: Home, SessionCascadeLocation, cascadeLocationOf, ThreadState, TokenTotals, NO_TOKENS, addTokens, isPersonsThread, isPersonsChat, tokensSoFar, ThreadSession, SessionStandIn, ContextOverride, Consultation, Thread
- `tool-activity.ts`: toolActivitySummary
- `undelivered-messages.ts`: undeliveredSince, waitingMessageIds, workWithUndelivered
- `user.fixtures.ts`: ANN_LEE, BEN_ITO, ANSWERED_BY_ANN_LEE
- `user.ts`: UserRef, userWords, userWordsOpening, sameUser
- Tests: brief.full.test.ts, brief.test.ts, canonical-call.full.test.ts, chat-activity.full.test.ts, consult.full.test.ts, context-policy.full.test.ts, context-policy.test.ts, conversation-tabs.full.test.ts, conversations-prompts.golden.test.ts, decision.full.test.ts, decision.test.ts, held-call.test.ts, live-view.full.test.ts, mention.full.test.ts, offered-office-tools.full.test.ts, office-tool-ruling.full.test.ts, open-page.full.test.ts, people-working.full.test.ts, proposal.full.test.ts, proposal.test.ts, session-instructions.full.test.ts, session-instructions.test.ts, stage-answer.test.ts, sub-agents-and-processes.test.ts, thread-changes.full.test.ts, thread-changes.test.ts, thread-history-words.test.ts, tool-activity.full.test.ts

### ports/

- `changes-allowed-repository.ts`: ChangesAllowedRepository
- `chat-activity-repository.ts`: SeenMark, ChatActivityRepository
- `conversations-settings.fixtures.ts`: ConversationsSettingsForTests
- `conversations-settings.ts`: ConversationsSettings
- `fire-alarm-lift-repository.ts`: FireAlarmLiftRepository
- `message-image-rules.ts`: MessageImageRules
- `office-instructions-repository.fixtures.ts`: OfficeInstructionsRepositoryForTests
- `office-instructions-repository.ts`: OfficeInstructionsRepository
- `project-bases.fixtures.ts`: ProjectBasesStandIn, projectBasesOver, noProjectBases
- `project-bases.ts`: InitiativeBranchReads, ProjectBases
- `project-output-masks.fixtures.ts`: ProjectOutputMasksForTests
- `project-output-masks.ts`: TextMask, NO_MASK, ProjectOutputMasks
- `project-record-source.ts`: ProjectRecordSource
- `sub-agent-and-process-repository.ts`: ItemKey, SubAgentAndProcessRepository
- `thread-repository.ts`: ThreadUpdate, LoggedMessagesRange, PersonsThreads, NewestFirstAfter, PersonsThreadsRead, TaskThreadTitle, LoggedMessage, ProposalInHome, NewestInitiativeThread, ThreadRepository
