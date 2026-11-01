# Pipelines: module map

**Owns:** the Pipeline library (`pipelines`, its migration seeding the built-ins of `domain/built-in-pipelines.ts` once; `PipelineLibrary` reads it, `PipelineLibraryEditor` adds, copies, saves and removes), each Task's own copy of its Stages (`task_stages`, made at Start or at the user's first edit for the Task), and the Stage interpreter that walks them: Agent, Script, Gate and Publish Stages, loops and rounds, budgets, Stage runs (`stage_runs`).

**Talks to:** reacts to Work's events (`TaskStarted`, `TaskResumed`, `TaskPaused` (by the user or the fire alarm), `TaskStopped`, `AlarmSounded`, `TaskStateChanged` to Dropped (Resolve's merge aborted), and `TaskPipelineConfirmed`, which sets aside Stages edited for the old Pipeline) Conversations' `DecisionAnswered` and People's `RoleLetGo`; everything else goes through its ports, bound in [app.module.ts](../../app.module.ts): `StartedTasks` and `TaskRecords` to Work, `KnownPeople` to People's `RoleCards`, `StageThreads`, `StageDecisions` and `TaskThreadSessions` to Conversations, `TaskGit`, `TaskCommands` and `TaskPublishing` to Projects' `TaskWorktrees`, `TaskScreenshots` to Work's `StageScreenshots`, `TaskUsage` to Conversations' `TaskTokens`, `ProjectDefaults` to Projects' `ProjectService`, `ProposalDrafts` to Conversations' `ProposalService`; the library editor counts Tasks through `StartedTasks.list`. Devops' Proposals of a library Pipeline's Stages (`pipeline`): `PipelineOfficeTools` registers `list_pipelines` and `propose_library_pipeline`, and `PipelineProposals` fills Conversations' `ProposalAppliers`, saving through `PipelineLibraryEditor.saveProposedStages`, which refuses once the Stages changed since the draft (`proposedStagesProblems`, comparing Stages as kept, so a field left undefined equals one left out); Conversations keeps the Stages unread, and they are parsed back with the contracts' `stageSchema`. Other modules read the library through `PipelineLibraryModule`, never `PipelinesModule`; the library's writes live in `PipelinesModule`, since they ask Projects and Work, who import the library.

**Traps:**

- A Publish Stage's `publishTarget` absent means the Project's publishing mode: Stages stored before it was added carry none, so never require it.
- An Agent Stage's `permissions` narrow its Role card's profile through People's `narrowedPermissionProfile` (in `AgentStageRunner.open` and `sessionAhead`, the Brief's commands too); absent keeps the card's, and Stages stored before carry none. A setting wider than the card is flagged in the library and refused for a Task (`RoleFillings.permissionProblems`, not `staffingProblems`, which holds Tasks); at run time the card's applies. MCP tools the Role's servers don't have are ignored.
- The built-ins live twice: `builtInPipelines` and the `pipelines` migration's seed, which `pipeline-library.test.ts` compares; a change to a built-in needs a migration too. Once seeded, the table is the library, and the user's edits of a built-in stand.
- The service's tests share one database across files run in parallel: a test makes Pipelines of its own under a unique name and never changes or removes a built-in.
- `EventBus.publish` waits for its handlers, so the interpreter walks in the background (`walkInBackground`); awaiting the walk would hold Start's request for the whole Pipeline.
- An edit of a Task's Stages and the walk's start of each run take one per-Task lock (`TaskStagesService.holding`), and the walk reads the Stages afresh each move: start a run anywhere else and an edit can change the Stage under it.
- The walk is worked out from the Stage runs (`nextMove` in `domain/pipeline-walk.ts`): a Gate action, an answer or a send-back is data on a run, replayed, not a call.
- A Stage failing with no retries left is put to the CTO first (`asksTheCtoFirst`, `StageDecisionRequest.putTo`); Conversations falls back to the user when no CTO can be consulted, and `NoRetriesLeft.putTo` says which. The CTO's words come back as a `one-more-round` answer with `guidedBy`, which the Brief names, and a Stage they sent back once goes to the user next time.
- Resolve (spec 2.3, "Conflicts at Publish"): a Publish run that conflicts puts Resolve, its Test and a Gate (keys `office:resolve…`, `domain/resolve-stages.ts`) before that Publish, derived from the runs and never stored: read the Stages as walked (`walkedStages`) wherever runs meet them (the walk, progress, the Gate, staffing), and strip them from an edit (`withoutResolveStages`). The Resolve Agent Stage's git is The Office's around the Agent's turn (`ResolveStageGit`, through `TaskPublishing`): no commit of its own, the merge committed once no marker is left; a round its Gate sent back is an ordinary Agent round on the merged branch, committed as any Stage's; dropping the Task aborts a merge left in progress (Work's `TaskStateChanged`).
- What the all clear would resume (`AlarmResumes`, pure `domain/alarm-resume.ts`, read by Notifications' Now): from the walk's next move, an Agent Stage's session as `AgentStageRunner.sessionAhead` asks `StageThreads.sessionAhead` (the same `stageSessionOf` and record as a run's `open`), a warm cache counted at a tenth of its context; none while the held run still runs. A run the alarm held shows Paused.
- The fire alarm (spec 2.8) is the `alarm` interruption: held after the Agent's turn as a Pause, its edits kept, but its Project commands stopped now, so a Script Stage stops at once; a Publish takes no interruption and finishes. `AlarmSounded` schedules the hard stop (`Schedule.once`) of the runs going on then, which cuts their turns short (`StageRunInterruption.hardStop`, `cutShortBy`), edits kept. At boot an In progress Task is held through `StartedTasks.holdForFireAlarm` before anything walks, and a run left running on a Task the alarm paused ends held by it.
- `StaffingHolds` pauses a Task whose next Stages nobody can work, behind a Decision kept in `staffing_holds`; the interpreter asks it on every `TaskResumed` before walking, so a Resume while the lack stands pauses the Task again.

**Open:** after Publish removes the worktree, a message to the Task's Planning Thread opens a session in a folder that no longer exists (task 14).

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

AlarmResumes, PipelineLibrary, TaskStagesService, DefinitionOfDoneNotMet, GateContinued, GateDropped, GateReached, NoRetriesLeft, PipelineCompleted, SentBackFromGate, StageRunEnded, StageRunStarted, WentBackToStage, TaskStagesEdited, TaskStagesMade, PipelineLibraryModule, PipelinesModule, StageDecisions, TaskCommands, TaskUsage, TaskGit

## Domain events

- `domain/pipeline-library-events.ts`: PipelineAdded, PipelineSaved, PipelineRemoved
- `domain/stage-run-events.ts`: StageRunStarted, StageRunEnded, StopHeldAsPause, StageSkipped, BudgetReached, WentBackToStage, NoRetriesLeft, DefinitionOfDoneNotMet, GateReached, GateContinued, SentBackFromGate, GateDropped, PipelineCompleted
- `domain/task-stages-events.ts`: TaskStagesMade, TaskStagesEdited, TaskStagesReset

## HTTP routes (under `/api`)

- `POST /pipelines`: PipelineLibraryController.add
- `POST /pipelines/check`: PipelineLibraryController.check
- `PUT /pipelines/:id`: PipelineLibraryController.save
- `DELETE /pipelines/:id`: PipelineLibraryController.remove
- `GET /pipelines/:id/use`: PipelineLibraryController.use
- `GET /pipelines`: PipelinesController.list
- `GET /pipelines/:id`: PipelinesController.read
- `POST /tasks/:id/gate/continue`: TaskGateController.continue
- `POST /tasks/:id/gate/send-back`: TaskGateController.sendBack
- `POST /tasks/:id/gate/drop`: TaskGateController.drop
- `GET /tasks/:id/stages`: TaskStagesController.read
- `PUT /tasks/:id/stages`: TaskStagesController.edit
- `POST /tasks/:id/stages/check`: TaskStagesController.check

## Tables

- `adapters/postgres/pipelines.schema.ts`: pipelines
- `adapters/postgres/staffing-holds.schema.ts`: staffing_holds
- `adapters/postgres/stage-runs.schema.ts`: stage_runs
- `adapters/postgres/task-stages.schema.ts`: task_stages

## Files

### ./

- `pipeline-library.module.ts`: PipelineLibraryModule
- `pipelines-application.fixtures.ts`: PipelinesApplication, startPipelinesApplication, walkStages, runsOf, anAgentStage, aTurn, anAgentSession, AN_INTERRUPTED_SESSION, aDoneResult, A_WAITING_RESULT, anAskedDecision, asksOnce, answerAsked, answerLastDecision
- `pipelines.module.ts`: PipelinesModuleOptions, PipelinesModule

### adapters/conversations/

- `pipeline-proposals.ts`: PipelineProposals

### adapters/http/

- `gate-refusals.filter.ts`: GateRefusalsFilter
- `pipeline-library-refusals.filter.ts`: PipelineLibraryRefusalsFilter
- `pipeline-library.controller.ts`: PipelineLibraryController
- `pipeline-responses.ts`: toPipelineResponse, toStageProblemResponse, toTaskStagesResponse
- `pipelines.controller.ts`: PipelinesController
- `stages-edit-refusals.filter.ts`: StagesEditRefusalsFilter
- `task-gate.controller.ts`: TaskGateController
- `task-stages.controller.ts`: TaskStagesController
- Tests: pipeline-library.controller.test.ts, pipelines.controller.test.ts, task-gate.controller.test.ts, task-stages.controller.test.ts

### adapters/office-tools/

- `pipeline-office-tools.ts`: PipelineOfficeTools

### adapters/postgres/

- `pipelines.schema.ts`: pipelines
- `postgres-pipeline-repository.ts`: PostgresPipelineRepository
- `postgres-staffing-hold-repository.ts`: PostgresStaffingHoldRepository
- `postgres-stage-run-repository.ts`: PostgresStageRunRepository
- `postgres-task-stages-repository.ts`: PostgresTaskStagesRepository
- `staffing-holds.schema.ts`: staffingHolds
- `stage-runs.schema.ts`: stageRuns
- `stored-usage-windows.ts`: StoredUsageWindowReading, storedUsageWindowReading, usageWindowReadingOf
- `task-stages.schema.ts`: taskStages

### adapters/websocket/

- `pipelines-web-events.ts`: PipelinesWebEvents
- Tests: pipelines-web-events.test.ts

### application/

- `agent-stage-runner.ts`: AGENT_STAGE_OFFICE_TOOLS, AgentStageRunner
- `alarm-resumes.ts`: AlarmResumes
- `gate-service.ts`: GateService
- `gate-stage-runner.ts`: GateStageRunner
- `pipeline-library-editor.ts`: PipelineLibraryEditor
- `pipeline-library.ts`: PipelineLibrary
- `publish-stage.ts`: PublishStage
- `resolve-stage-git.ts`: ResolveBegun, ResolveStageGit
- `role-fillings.ts`: RoleFillings
- `script-stage-runner.ts`: ScriptStageRunner
- `staffing-holds.ts`: StaffingHolds
- `stage-git.ts`: StageStart, StageGit
- `stage-interpreter.ts`: StageInterpreter
- `stage-run-interruption.ts`: StageRunInterruption
- `stage-runner.ts`: StageOfKind, StageWork, StageRunner
- `stage-runners.ts`: StageRunners
- `task-stages-service.ts`: TaskStagesService
- Tests: agent-stage-runner.test.ts, gate-publish-test-project-check.test.ts, parallel-work-test-project-check.test.ts, pipeline-library.test.ts, publish-stage.test.ts, running-task-test-project-check.test.ts, script-stage-runner.test.ts, staffing-holds.test.ts, stage-editor-test-project-check.test.ts, stage-interpreter-alarm.test.ts, stage-interpreter-decisions.test.ts, stage-interpreter-edited.test.ts, stage-interpreter-gates.test.ts, stage-interpreter-restart.test.ts, stage-interpreter-stop.test.ts, stage-interpreter-telemetry.test.ts, stage-interpreter-test-project-check.test.ts, stage-interpreter.test.ts, stage-run-interruption.test.ts, task-stages-service.test.ts

### domain/

- `agent-stage-brief.ts`: AGENT_STAGE_INSTRUCTIONS, BriefTask, EarlierResult, AgentStageRecord, agentStageRecord, AnsweredQuestion, CarriedRound, StageWorkReasons, HeldRun, agentStageWork
- `alarm-resume.ts`: ResumeKind, TaskResume, WalkAhead, SessionAhead, walkAhead, taskResumeOf
- `allowed-commands.ts`: RunPermission, CommandPermission, AllowedCommands, allowedCommands
- `built-in-pipelines.ts`: ONBOARD_PIPELINE, builtInPipelines
- `followed-hard-switches.ts`: FollowedHardSwitchValue, FollowedHardSwitches, hardSwitchesSection
- `gate-refused.ts`: GateRefused
- `gate.ts`: GATE_REACHED, waitingGateRun, sendBackTargets, gateActionProblems
- `library-pipeline.ts`: PipelineEdit, TaskOnPipeline, ProjectOnPipeline, PipelineUse, pipelineEditProblems, pipelineEditFlags, proposedStagesProblems, proposedEdit, addedPipeline, savedPipeline, copiedPipeline, pipelineUse, removalProblems
- `pipeline-library-events.ts`: PipelineAdded, PipelineSaved, PipelineRemoved
- `pipeline-library-refusals.ts`: PipelineRemovalRefused, UnknownPipeline
- `pipeline-walk.ts`: WalkQuestion, NextMove, nextMove, unmetStatements
- `pipeline.ts`: Pipeline, StageProblem, stageProblems, problemOnStage
- `publish.ts`: PullRequestText, RemoteBranch, ResolveStart, ResolveEnd, BaseTakenIn, Publication, PublishedTask, pullRequestText, publishOutcome
- `resolve-stages.ts`: RESOLVE_KEY, RESOLVE_TEST_KEY, RESOLVE_GATE_KEY, RESOLVE_ROUNDS, isResolveStage, withoutResolveStages, goesToResolve, walkedStages, withResolveStages, conflictCarried, conflictCameBackTooOften, afterResolveTestFailed, resolvedByTheUser, resolveBrief
- `script-stage-outcome.ts`: scriptStageOutcome, installFailure
- `staffing-decision.ts`: STAFFING_OPTIONS, staffingHoldReason, staffingDecision
- `stage-budget.ts`: stageBudget, budgetReached, budgetOutcome, tokensWords
- `stage-command-run.ts`: CommandOutcome, CommandRun, MovedFiles, ScriptCommandRun, StageCommandPurpose, StageCommandRun, Installation, installRuns, failedInstall, commandRunsOf, howItEnded
- `stage-commit.ts`: ExpectedHead, stageCommitMessage, headProblem
- `stage-interruption.ts`: CutShortBy, actsNow, stopsCommands, waitsForTheTurn, outranks, RESTARTED, notStartedOutcome, interruptedOutcome, StageWorkClosing, closingOf
- `stage-permissions.ts`: HardSwitchOnCard, StagePermissions
- `stage-progress.ts`: StageState, WentBack, StageProgress, TaskProgress, stagesProgress
- `stage-result.ts`: STAGE_RESULT_SCHEMA, StageResultReading, readStageResult, screenshotsRefused, correctionMessage
- `stage-run-changes.ts`: NewStageRun, startStageRun, endStageRun
- `stage-run-events.ts`: StageRunStarted, StageRunEnded, StopHeldAsPause, StageSkipped, BudgetReached, WentBackToStage, NoRetriesLeft, DefinitionOfDoneNotMet, GateReached, GateContinued, SentBackFromGate, GateDropped, PipelineCompleted
- `stage-run.fixtures.ts`: aStageRun
- `stage-run.ts`: StageRecommendation, StageDecision, StageOutcome, StageInterruption, AskedInterruption, BaseMoved, BudgetReached, StageSessionMove, StageTokens, UsageWindow, UsageWindowReading, NO_STAGE_TOKENS, addTokens, StageOutcomeStatus, CarriedFailure, GateAction, SentBack, StageDecisionKind, WalkAnswer, StageRunDecision, AgentRunDecision, WalkRunDecision, WalkDecisionKind, StageRun
- `stage-staffing.ts`: RoleFilling, staffingProblems
- `stage.fixtures.ts`: agentStage, scriptStage, gate
- `stage.ts`: Stage, StageKind, STAGE_KIND_NAMES, ScriptStageCommand, PublishTarget, StageSession, Effort, OnFailure, AgentStage, ScriptStage, Gate
- `stages-edit-refused.ts`: StagesEditRefused
- `task-stages-events.ts`: TaskStagesMade, TaskStagesEdited, TaskStagesReset
- `task-stages.ts`: TaskStages, TaskTrace, makeTaskStages, followsPipeline, lockedStageCount, firstStageToWork, editProblems, editTaskStages
- `test-results.ts`: TestResultState, TestResult, latestTestResults
- `walk-decisions.ts`: DecisionAnswer, WalkDecision, walkDecision, walkAnswerOf, asksTheCtoFirst, agentDecision, AcceptedIssue, acceptedIssues
- Tests: agent-stage-brief.test.ts, built-in-pipelines.test.ts, followed-hard-switches.test.ts, gate.test.ts, library-pipeline.test.ts, pipeline-walk.test.ts, pipeline.test.ts, publish.test.ts, script-stage-outcome.test.ts, stage-budget.test.ts, stage-commit.test.ts, stage-progress.test.ts, stage-result.test.ts, stage-staffing.test.ts, task-stages.test.ts, test-results.test.ts, walk-decisions.test.ts

### ports/

- `known-people.ts`: KnownPerson, KnownPeople
- `pipeline-repository.ts`: PipelineRepository
- `pipelines-ports.fixtures.ts`: ProjectDefaultsForTests, StartedTasksForTests, aTaskRecord, TaskRecordsForTests, aPerson, KnownPeopleForTests, StageThreadsForTests, StageDecisionsForTests, TaskUsageForTests, TaskThreadSessionsForTests, TaskScreenshotsForTests, PLANNED_COMMIT, TaskGitForTests, aCommandRun, TaskCommandsForTests, RESOLVED_COMMIT, TaskPublishingForTests, ProposalDraftsForTests, PipelinesPortsForTestsModule
- `project-defaults.ts`: ProjectDefault, ProjectDefaults
- `proposal-drafts.ts`: ProposedPipelineChange, ProposalDrafts
- `staffing-hold-repository.ts`: StaffingHoldRepository
- `stage-decisions.ts`: StageDecisionRequest, OpenedStageDecision, StageDecisions
- `stage-run-repository.ts`: StageRunThread, UsageWindowsMoment, StageRunRepository
- `stage-threads.ts`: StageSessionSettings, StageThreadRequest, StageTurn, AskedDecision, StageThread, StageSessionAhead, StageThreads
- `started-tasks.ts`: WalkTaskState, StartedTask, StartedTasks
- `task-commands.ts`: ScriptCommandKey, TaskCommands
- `task-git.ts`: WorktreeHead, TaskGit
- `task-publishing.ts`: TaskPublishing
- `task-records.ts`: TaskRecord, TaskRecords
- `task-screenshots.ts`: ScreenshotsAttaching, TaskScreenshots
- `task-stages-repository.ts`: TaskStagesRepository
- `task-thread-sessions.ts`: TaskThreadSessions
- `task-usage.ts`: TaskUsage
