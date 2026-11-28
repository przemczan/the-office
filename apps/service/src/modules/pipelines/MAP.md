# Pipelines: module map

## Owns

- The Pipeline library: office-wide Pipelines (`pipelines`, built-ins in `domain/built-in-pipelines.ts`), Project Pipelines (`project_pipelines`), Stage templates (`stage_templates`) and Stage-to-template links (`templateId` in a Stage's jsonb, `LinkedStages`); `PipelineLibrary` reads, `PipelineLibraryEditor`/`StageTemplateLibraryEditor` write.
- Each Task's own Stages (`task_stages`) and the Stage interpreter: Agent, Script, Gate and Publish Stages, routes and limits, Stage runs (`stage_runs`), Gates (`GateService`), Restart from…, Start over's part, staffing holds (`staffing_holds`), the Stand-in choice (`StandInChoices`, `StandInSwitches`), conflict handling (`ResolveStageGit`).
- Run history for others: `UsageHistory`, `StageResultWords`, `TaskGateRuns`, `StageRunsRunningNow`, `StageRunTotals`, `RunningStageRuns`, `StageRunEngines`; `read_stage_history` (`StageHistory`).
- Agent Stage tools: `run_project_command`, `update_branch`, `choose_route`, `write_run_environment_definition`; `PIPELINES_PROMPT_TEMPLATES`.
- Office actions: `PIPELINES_OFFICE_ACTIONS` (`restart_task_from`, `edit_task_stages`, `switch_to_stand_in`, Gate choices), the library's (`LibraryOfficeActions`) and Project Pipelines', and Prompt templates' `save_prompt_template`/`reset_prompt_template` (here, since Prompt templates can't import Engine: `import/no-cycle`).

## Talks to

- Work: `StartedTasks`, `TaskRecords`, `PipelineInitiatives`; fills `TaskEngineChecks`, `TaskStageEdits`, `TaskStartOvers`; reacts to `TaskStarted`, `TaskResumed`, `TaskPaused`, `TaskStopped`, `AlarmSounded`, `TaskStateChanged`, `TaskPipelineConfirmed`; uses Work's `TaskLocks`.
- Conversations: `StageThreads`, `StageThreadMessages`, `StageDecisions`, `TaskThreadSessions`, `TaskUsage`→`TaskTokens`, `ProposalDrafts`, `TaskConsultations`→`ConsultationsOnTasks`, `StageContextLimitDefaults`→`ContextPolicySettingsService`; reacts to `DecisionAnswered`; fills `ProposalAppliers` (`PipelineProposals`).
- People: `KnownPeople`→`RoleCards` (`find`, `holderOf`, `dutyHolders`), `StageRoleEngines`→`PipelineRoleCapabilityChecks`, `RoleEngineCascade`; fills `PipelineRoleSources`; reacts to `RoleLetGo`, `DutyHolderChanged`.
- Projects: `TaskGit`, `TaskCommands`, `TaskPublishing`→`TaskWorktrees`, `ProjectDefaults`→`ProjectService`. Run environments: `RunEnvironmentDefinitions`. Engine: `ModelPrices`, `EngineModels`, `EngineSessions.standInFor`. Busy work: `BusyWork`, `ScheduledExitHold`.
- Others read the library through `PipelineLibraryModule` and history through `UsageHistoryModule`, never `PipelinesModule`. Bindings in [app.module.ts](../../app.module.ts).

## Traps

- `UsageHistoryModule` must never depend on a port bound to Work (Work imports it). `latestTasksUsage` reads only usage columns: whole runs blocked the event loop.
- `EventBus.publish` waits for handlers, so the interpreter walks in the background (`walkInBackground`).
- An edit of a Task's Stages and each run's start take one per-Task lock (`TaskStagesService.holding`); the walk reads Stages afresh each move.
- The walk is replayed from the runs (`nextMove`): Gate actions, answers, restarts and route counts are data on runs, never stored counters. Read runs through `runsOfLatestStart`.
- Run fields several hands change go through `StageRunRepository.update(runId, change)` (`FOR UPDATE`, `stage-run-changes.ts`); never write them from an earlier copy.
- An answer is kept before the Task moves; `walkingOn` retries after `WALK_ON_AGAIN_AFTER_MS`, and bootstrap walks every Task Waiting on you.
- Walk Decision ids come from run and kind (`walkDecisionId`), so a re-ask after a crash opens none twice.
- Read Stages through `asFlow` wherever runs meet them (converts plain lists, kept `onFailure`, Script `publish` Stages, the conflict chain). `conflictOnlyStages` are passed over by "Continue" checks; the web's copy is `shell/pipelines/flow/conflict-chain.ts`.
- A Stage names a Role or a duty: read who works it through `stageWorker`, never `stage.role`; `staffedStages` keeps a started Stage's person (`stage_runs.role_key`).
- `commandKeysNamedBy` is the one source of command keys a Stage list runs (narrowed `permissions.commands` count); every missing-command check reads it.
- `stageProjectCommands` (`allowed-commands.ts`) is the one source of a Stage's allowed commands; only a key is refused, a written line goes by the session's rules.
- `StageCommandRuns`: no command outlives its run; calls before `begin`/after `end` are refused.
- Library names span both tables and are checked under the `LIBRARY` lock; every write to either takes it. Removing a template takes `STAGE_TEMPLATES` then `LIBRARY`; never the other order.
- `project_pipelines.project_id` has no foreign key; a future Project removal must remove its Project Pipelines through an event.
- Built-ins live twice (code and migration seeds, compared by tests): a built-in change needs a migration. Tests make their own Pipelines under unique names and never change a built-in (one shared database).
- `HEAD` after Publish is the `merged` Publication's `head`, never its `commit`. After `update_branch` read `expected` from the run's `headCommit`. Only `StageGit.start` accepts a moved HEAD.
- `changedFiles` undefined (before migration 0161) is "not recorded", never "none".
- Command outputs (`command_outputs`) are read only by their route; `list` leaves them out.
- `read_stage_history` never reads a file or transcript; name moved files by `paths`, never `folder`.
- Publishing Tasks hold `InitiativeBranchStages` per Stage; `DroppedTaskWorktrees` aborts a merge before removing a worktree, in one handler.
- `publishTarget`, `permissions` and `contextLimits` may be absent on stored Stages: never require them.
- Decisions' answers are read only through Conversations' `stageAnswerOf`, never the form.
- Interruption ranks: Stop > alarm > `usage-window` > pause; `restart` keeps edits; only Stop discards. Work's `TaskPaused` for a usage window is ignored (the runner held it).
- A `handing_over` result is valid only while `contextLimitPassed()` is set.
- `PostgresPipelineRepository`/`PostgresProjectPipelineRepository` reads go through platform `readOnce`; writes through `forgettingReads`.
- Rollback (accepted): flows with routes back and no `onFailure`, `publish` Stages, `mergeBaseFirst`, choice routes and Not taken runs can't be walked by the previous release; stored data is never rewritten. Saves still write `place` beside positions and keep `optional`.
- Migration `0224` refuses while any `stages` is null; `broken_before_update` is cleared only by the user's save.
- A test saving a Prompt template text starts with `startPipelinesApplicationWith` and `PromptTemplateRepositoryForTests`.
- Metrics carry names, never ids.
- Open: after Publish removes the worktree, a message to the Task's planning Thread opens a session in a missing folder.

## Spec

- [2.3 Pipelines](../../../../../docs/spec/2.3-pipelines.md), [2.3.1 Stages](../../../../../docs/spec/2.3.1-stages.md), [2.3.2 Flows](../../../../../docs/spec/2.3.2-flows.md), [2.3.3 Gates and checks](../../../../../docs/spec/2.3.3-gates-and-checks.md)
- [2.3.4 Publish](../../../../../docs/spec/2.3.4-publish.md), [2.3.5 Library](../../../../../docs/spec/2.3.5-library.md), [2.4.5 Stopping and restarts](../../../../../docs/spec/2.4.5-stopping-and-restarts.md), [2.8 Fire alarm](../../../../../docs/spec/2.8-fire-alarm.md)
- [5.4.6 Stand-in Engines](../../../../../docs/spec/5.4.6-stand-in-engines-and-usage-windows.md), [2.5 Context policy](../../../../../docs/spec/2.5-context-policy.md)

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

AlarmResumes, PipelineLibrary, StageTemplateLibrary, StageResultWords, TaskGateRuns, TaskStagesService, UsageHistory, StageRunTotals, RunningStageRuns, StageRunEngines, StageRunsRunningNow, StandInChoices, WaitingStandInChoice, RanAgentStageRun, StartedStageRun, StageUsage, StageUsages, DefinitionOfDoneNotMet, GateContinued, GateDropped, GateReached, NoRetriesLeft, PipelineCompleted, RouteLimitReached, SentBackFromGate, StageAwaitsStandInChoice, StageRunEnded, StageRunStarted, StandInChoicesChanged, WentBackToStage, TaskStagesEdited, TaskStagesMade, PipelineLibraryModule, PipelinesModule, UsageHistoryModule, StageDecisions, TaskCommands, TaskUsage, TaskGit

## Domain events

- `domain/pipeline-library-events.ts`: PipelineAdded, PipelineSaved, PipelineRemoved
- `domain/stage-run-events.ts`: StageRunStarted, StageRunThreadOpened, StageRunWaiting, StageRunEngineSwitched, StageAwaitsStandInChoice, StandInChoicesChanged, StageRunEnded, StopHeldAsPause, BudgetReached, WentBackToStage, NoRetriesLeft, RouteLimitReached, DefinitionOfDoneNotMet, GateReached, GateContinued, SentBackFromGate, GateDropped, PipelineCompleted
- `domain/stage-template-events.ts`: StageTemplateAdded, StageTemplateSaved, StageTemplateRemoved
- `domain/task-stages-events.ts`: TaskStagesMade, TaskStagesEdited, TaskStagesReset

## HTTP routes (under `/api`)

- `POST /pipelines/check`: PipelineLibraryController.check
- `GET /pipelines/library/needs-fixing`: PipelineLibraryController.needingFixing
- `GET /pipelines/:id/use`: PipelineLibraryController.use
- `GET /pipelines`: PipelinesController.list
- `GET /pipelines/:id`: PipelinesController.read
- `POST /project-pipelines/check`: ProjectPipelineLibraryController.check
- `GET /project-pipelines/check/needs-fixing`: ProjectPipelineLibraryController.needingFixing
- `GET /project-pipelines/:id/use`: ProjectPipelineLibraryController.use
- `GET /project-pipelines`: ProjectPipelinesController.list
- `GET /project-pipelines/:id`: ProjectPipelinesController.read
- `POST /stage-templates/check`: StageTemplateLibraryController.check
- `GET /stage-templates/:id/linked-stages`: StageTemplateLibraryController.linked
- `GET /stage-templates`: StageTemplatesController.list
- `GET /stage-templates/:id`: StageTemplatesController.read
- `GET /stand-in-choices`: StandInChoicesController.list
- `GET /tasks/:id/engine-cascade`: TaskEngineCascadeController.read
- `GET /tasks/:id/stages`: TaskStagesController.read
- `GET /tasks/:id/stage-runs/:runId/command-outputs`: TaskStagesController.commandOutputs
- `POST /tasks/:id/stages/check`: TaskStagesController.check

## Tables

- `adapters/postgres/pipelines.schema.ts`: pipelines
- `adapters/postgres/project-pipelines.schema.ts`: project_pipelines
- `adapters/postgres/staffing-holds.schema.ts`: staffing_holds
- `adapters/postgres/stage-runs.schema.ts`: stage_runs
- `adapters/postgres/stage-templates.schema.ts`: stage_templates
- `adapters/postgres/task-stages.schema.ts`: task_stages

## Files

### ./

- `agent-stage-runner.fixtures.ts`: implement, corrected, WINDOW_RESET, aRefusedTurn, A_REFUSED_SESSION, refusedCorrection
- `index.fixtures.ts`: ownProjectsStartedTasks, projectPipelinesForTests
- `pipeline-library.module.ts`: PipelineLibraryModule
- `pipelines-application.fixtures.ts`: PipelinesApplication, startPipelinesApplication, startPipelinesApplicationOn, startPipelinesApplicationWith, PipelinesEngine, walkStages, runsOf, anAgentStage, aTurn, anAgentSession, AN_INTERRUPTED_SESSION, aDoneResult, A_WAITING_RESULT, anAskedDecision, asksOnce, answerAsked, answerLastDecision
- `pipelines.module.ts`: PipelinesModuleOptions, PipelinesModule
- `project-pipelines.fixtures.ts`: projectPipelinesForTests
- `publish-stage.fixtures.ts`: implement, publish, reviewedPublish, PULL_REQUEST, branchOnlyPublish
- `stage-interpreter-alarm.fixtures.ts`: implement, review, HELD, open, start, scheduleOf, soundTheAlarm, whileTheFirstTurnRuns, resume, statusesOf
- `stage-interpreter-decisions.fixtures.ts`: scriptStage, draft, agentDone, A_WAITING, pipelines, aStageThread, startWith, failing, statusesOf, onWaiting, answerFirstOption, statesOf, ARCHITECT, hireTheArchitect, failuresPutTo
- `stage-interpreter-restart.fixtures.ts`: implement, review, tests, RESTART_QUESTION, RESTARTED, open, start, close, startUp, aRunLeftRunning, outcomesOf
- `stage-interpreter-stop.fixtures.ts`: implement, review
- `usage-history.module.ts`: UsageHistoryModule

### adapters/conversations/

- `pipeline-proposals.ts`: PipelineProposals
- `project-pipeline-proposals.fixtures.ts`: aNewOne, aChangeTo, fieldsOf
- Tests: project-pipeline-proposals.full.test.ts, project-pipeline-proposals.test.ts

### adapters/http/

- `gate-refusals.filter.ts`: GateRefusalsFilter
- `given-stages.ts`: withStagesGiven, givenStage
- `pipeline-library-refusals.filter.ts`: PipelineLibraryRefusalsFilter
- `pipeline-library.controller.fixtures.ts`: anEdit
- `pipeline-library.controller.ts`: PipelineLibraryController
- `pipeline-responses.ts`: toPipelineResponse, toPipelineUseResponse, toProjectPipelineResponse, toStageTemplateResponse, toLinkedStageResponse, toStageProblemResponse, toTaskStagesResponse
- `pipelines-office-actions.controller.ts`: PipelinesOfficeActionsController
- `pipelines.controller.ts`: PipelinesController
- `project-pipeline-library.controller.fixtures.ts`: LINUX_CHECK, aNewProjectPipeline, projectPipelineRequests
- `project-pipeline-library.controller.ts`: ProjectPipelineLibraryController
- `project-pipelines.controller.ts`: ProjectPipelinesController
- `prompt-template-office-actions.controller.ts`: PromptTemplateOfficeActionsController
- `prompt-template-refusals.filter.ts`: PromptTemplateActionRefusalsFilter
- `restart-refusals.filter.ts`: RestartRefusalsFilter
- `stage-template-library.controller.ts`: StageTemplateLibraryController
- `stage-templates.controller.fixtures.ts`: aStage, refusal
- `stage-templates.controller.ts`: StageTemplatesController
- `stages-edit-refusals.filter.ts`: StagesEditRefusalsFilter
- `stand-in-choices.controller.ts`: StandInChoicesController
- `task-engine-cascade.controller.ts`: TaskEngineCascadeController
- `task-stages.controller.fixtures.ts`: tests
- `task-stages.controller.ts`: TaskStagesController
- Tests: pipeline-library.controller.full.test.ts, pipeline-library.controller.test.ts, pipelines.controller.test.ts, project-pipeline-library.controller.full.test.ts, project-pipeline-library.controller.test.ts, stage-templates.controller.full.test.ts, stage-templates.controller.test.ts, task-engine-cascade.controller.test.ts, task-restart.controller.test.ts, task-stages.controller.full.test.ts, task-stages.controller.test.ts

### adapters/office-actions/

- `answered.ts`: Answered, answered
- `library-office-actions.ts`: LibraryOfficeActions
- `pipelines-office-actions.ts`: PipelinesOfficeActions
- `prompt-template-office-actions.ts`: PromptTemplateOfficeActions, promptTemplateBody
- Tests: gate-office-actions.test.ts, library-office-actions.test.ts, pipelines-office-actions.test.ts, prompt-template-office-actions.test.ts

### adapters/office-tools/

- `pipeline-office-tools.ts`: PipelineOfficeTools
- Tests: pipeline-proposal-tools.test.ts, stage-history-office-tool.full.test.ts

### adapters/postgres/

- `pipelines.schema.ts`: pipelines
- `postgres-pipeline-repository.ts`: PostgresPipelineRepository
- `postgres-project-pipeline-repository.ts`: PostgresProjectPipelineRepository
- `postgres-staffing-hold-repository.ts`: PostgresStaffingHoldRepository
- `postgres-stage-run-repository.ts`: PostgresStageRunRepository
- `postgres-stage-template-repository.ts`: PostgresStageTemplateRepository
- `postgres-task-stages-repository.ts`: PostgresTaskStagesRepository
- `project-pipelines.schema.ts`: projectPipelines
- `staffing-holds.schema.ts`: staffingHolds
- `stage-runs.schema.ts`: stageRuns
- `stage-templates.schema.ts`: stageTemplates
- `task-stages.schema.ts`: taskStages
- Tests: built-in-setup-briefs-migration.test.ts, onboard-actions-brief-migration.test.ts, pipeline-flows-migration.test.ts, postgres-project-pipeline-repository.test.ts, postgres-stage-run-repository.test.ts, postgres-stages-as-flows.test.ts, project-pipelines-legacy-migration.test.ts, project-setting-briefs-migration.test.ts, project-setting-proposal-tools-retired-migration.test.ts, resolve-template-migration.test.ts, set-up-brief-migration.test.ts, stage-duties-migration.test.ts, stage-positions-migration.test.ts

### adapters/prompt-templates/

- `pipelines-prompt-templates.ts`: PipelinesPromptTemplates
- Tests: pipelines-prompt-templates.test.ts

### adapters/websocket/

- `pipelines-web-events.ts`: PipelinesWebEvents
- Tests: pipelines-web-events.full.test.ts

### application/

- `agent-stage-runner.ts`: AGENT_STAGE_OFFICE_TOOLS, AgentStageRunner
- `alarm-resumes.ts`: AlarmResumes
- `command-set-up-by.ts`: setUpByOf
- `condition-commands.ts`: WeighCommandMove, ConditionCommands
- `dropped-task-worktrees.ts`: DroppedTaskWorktrees
- `gate-service.ts`: GateService
- `gate-stage-runner.ts`: GateStageRunner
- `initiative-branch-stages.ts`: InitiativeBranchStages
- `linked-stages.ts`: LinkedStage, LinkedStageRef, RefusedPipeline, TemplateEditApplied, LinkedStages
- `pipeline-library-editor.ts`: PipelineCheck, PipelineLibraryEditor
- `pipeline-library.ts`: PipelineCommands, ReadStage, ReadPipeline, PipelineForTask, PipelineLibrary
- `publish-stage.ts`: PublishStage
- `resolve-stage-git.ts`: ResolveBegun, ResolveStageGit
- `role-fillings.ts`: RoleFillings
- `roles-named-in-stages.ts`: RolesNamedInStages
- `running-stage-runs.ts`: RunningStageRuns
- `script-stage-runner.fixtures.ts`: aScriptStage, tests, passing, failing
- `script-stage-runner.ts`: ScriptStageRunner
- `staffing-holds.ts`: StaffingHolds
- `stage-branch-update.ts`: StageBranchUpdateAnswer, StageBranchUpdate
- `stage-command-runs.ts`: StageCommandRuns
- `stage-git.ts`: StageStart, StageGit
- `stage-history.ts`: StageHistory
- `stage-interpreter.ts`: StageInterpreter
- `stage-project-commands.ts`: StageProjectCommands
- `stage-result-words.ts`: HandoverNoteWords, TaskStageRunsOutline, StageResultWords
- `stage-route-choices.ts`: CHOOSE_ROUTE_TOOL, StageRouteChoiceAnswer, AskedRouteChoice, StageRouteChoices
- `stage-run-engines.ts`: StageRunEngines
- `stage-run-environment-definitions.ts`: StageRunEnvironmentDefinitions
- `stage-run-interruption.ts`: StageRunInterruption
- `stage-run-totals.ts`: StageRunTotals
- `stage-run-waits.ts`: StageRunWaits
- `stage-runner.ts`: StageOfKind, StageWork, StageRunner
- `stage-runners.ts`: StageRunners
- `stage-runs-files.ts`: StageRunsFiles
- `stage-runs-running-now.ts`: StageRunsRunningNow
- `stage-template-library-editor.ts`: StageTemplateLibraryEditor
- `stage-template-library.ts`: StageTemplateLibrary
- `stand-in-choices.ts`: STAGE_STAND_IN_NEEDS, HeldForStandInChoice, WaitingStandInChoice, StandInChoices, heldForChoice
- `stand-in-switches.ts`: StandInSwitchOutcome, StandInSwitchResult, StandInSwitches
- `task-gate-runs.ts`: TaskGateRuns
- `task-restarts.ts`: RestartChoice, TaskRestarts
- `task-role-engines.ts`: StageOwnEffort, TaskRoleWork, TaskRoleEngine, TaskEngines, TaskRoleEngines
- `task-stages-service.fixtures.ts`: builtIn, quickFix, withGate, taskCopyOf, refusalOf
- `task-stages-service.ts`: TaskStagesService, namedRoles
- `task-start-over-work.ts`: TaskStartOverWork
- `usage-history.ts`: UsageHistory
- Tests: agent-stage-runner-stand-ins.test.ts, agent-stage-runner-usage-window.test.ts, agent-stage-runner.full.test.ts, agent-stage-runner.test.ts, conflict-resolution-stages.full.test.ts, duty-stages.full.test.ts, gate-publish-test-project-check.test.ts, linked-stages.full.test.ts, parallel-work-test-project-check.test.ts, pipeline-library.test.ts, publish-stage-lines.test.ts, publish-stage.full.test.ts, publish-stage.test.ts, publishing-task-stages.test.ts, resolve-stage-git.test.ts, roles-named-in-stages.full.test.ts, running-task-test-project-check.test.ts, script-stage-runner.full.test.ts, script-stage-runner.test.ts, set-up-test-targets-stages.full.test.ts, staffing-holds.full.test.ts, stage-branch-update.full.test.ts, stage-editor-test-project-check.test.ts, stage-interpreter-alarm.full.test.ts, stage-interpreter-alarm.test.ts, stage-interpreter-decisions.full.test.ts, stage-interpreter-decisions.test.ts, stage-interpreter-edited.full.test.ts, stage-interpreter-flows.full.test.ts, stage-interpreter-gates.test.ts, stage-interpreter-restart.full.test.ts, stage-interpreter-restart.test.ts, stage-interpreter-stop.full.test.ts, stage-interpreter-stop.test.ts, stage-interpreter-telemetry.full.test.ts, stage-interpreter-test-project-check.test.ts, stage-interpreter.test.ts, stage-project-commands.full.test.ts, stage-project-commands.test.ts, stage-result-words.full.test.ts, stage-route-choices.test.ts, stage-run-environment-definitions.test.ts, stage-run-interruption.full.test.ts, stage-run-interruption.test.ts, stage-runs-files.test.ts, stage-runs-running-now.test.ts, stage-template-library.test.ts, stand-in-choices.test.ts, stand-in-switches.test.ts, task-restarts.test.ts, task-role-engines.full.test.ts, task-stages-service.full.test.ts, task-stages-service.test.ts, usage-estimates-test-project-check.test.ts, usage-history.full.test.ts

### domain/

- `agent-command.ts`: AgentCommand, agentCommandOf, AgentCommandEnd, agentCommandAnswer
- `agent-stage-brief-templates.ts`: EARLIER_STAGE_RESULT, STAGE_BRIEF, STAGE_HELD, STAGE_RUNS_AGAIN, STAGE_SENT_AGAIN, STAGE_MESSAGE, STAGE_HANDOVER, STAGE_ROUTES_OUT, STAGE_RESTARTED, AGENT_STAGE_BRIEF_TEMPLATES
- `agent-stage-brief.ts`: AGENT_STAGE_INSTRUCTIONS, AGENT_STAGE_THREAD_INSTRUCTIONS, BriefCommitMessage, RecheckedCommitMessage, BriefTask, EarlierResult, AgentStageRecord, agentStageRecord, AnsweredQuestion, CarriedRound, StageWorkReasons, StagePipeline, HeldRun, agentStageWork, restartedSessionWork, isLastAgentStageBeforePublish, workSentAgain, stageResultWords, earlierResults
- `alarm-resume.ts`: ResumeKind, TaskResume, WalkAhead, SessionAhead, walkAhead, taskResumeOf
- `allowed-commands.ts`: RunPermission, CommandPermission, NamedCommand, AllowedCommands, stageProjectCommands, BRIEF_COMMANDS, allowedCommands, commandKeyRefusal
- `base-words.ts`: TaskBases, baseWords, publishingModeWords
- `built-in-pipelines-before-flows.fixtures.ts`: builtInPipelinesBeforeFlows
- `built-in-pipelines.ts`: ONBOARD_PIPELINE, SET_UP_RUN_ENVIRONMENT_PIPELINE, SET_UP_TEST_TARGETS_PIPELINE, RESOLVE_CONFLICTS_PIPELINE, builtInPipelines
- `built-in-stage-templates.ts`: resolveStageTemplate, builtInStageTemplates
- `condition-command-results.ts`: recordedCommandResults
- `conditions.ts`: Weight, CommandTest, CommandResults, Weighing, RouteChoice, GroupWeight, weighRoutes, weighGroup
- `conflict-handling.ts`: takesPublishResult, isConflictRoute, conflictOnlyStages
- `definition-of-done-reports.ts`: reportedMet, reportedMetIn, reportedOutOfReach, unmetStatements
- `flow.ts`: FlowStage, GridStage, straightLineFlow, asFlow, GivenStage, withGivenLimits, isRouteBack, namedFlow, withPlacesForThePreviousRelease, withoutLayout, withProposedPositions, proposedEndPosition, isStraightLine, reachableFrom
- `followed-hard-switches.ts`: FollowedHardSwitchValue, FollowedHardSwitches, HARD_SWITCHES, hardSwitchesSection
- `gate-refused.ts`: GateRefused
- `gate.ts`: GATE_REACHED, waitingGateRun, lastActedOnGateRun, sendBackTargets, agentStageFollowsGate, gateActionProblems
- `library-pipeline.ts`: PipelineEdit, TaskOnPipeline, ProjectOnPipeline, InitiativeOnPipeline, PipelineUse, pipelineEditProblems, pipelineEditFlags, proposedStagesProblems, proposedEdit, addedPipeline, savedPipeline, copiedPipeline, pipelineUse, missingCommandProblems, removalProblems
- `merge-base-first.ts`: RESOLVE_BRIEF, MERGE_BASE_CLEAN, RESOLVE_AFTER_TEST, RESOLVE_AFTER_GATE, MERGE_BASE_FIRST_TEMPLATES, resolveBrief, resolvedByTheUser, broughtBackBy
- `pipeline-library-events.ts`: PipelineAdded, PipelineSaved, PipelineRemoved
- `pipeline-library-refusals.ts`: PipelineRemovalRefused, UnknownPipeline, UnknownProjectPipeline, UnknownStageTemplate
- `pipeline-names.ts`: TakenName, pipelineNameProblems, comparableName
- `pipeline-walk.ts`: UnmetOutOfReach, RouteCount, FollowedRoute, RouteAtLimit, WalkQuestion, NextMove, RESTARTS_ASKED_AT, nextMove, routesFollowed, routeCounts, addressableStatements, statementList, gateChecksDefinitionOfDone
- `pipeline.ts`: Pipeline, StageProblemAt, StageProblemLevel, StageProblem, pipelineProblem, asWarnings, stageProblems, stageWarnings, problemOnStage, singleStageProblems
- `pipelines-prompt-templates.ts`: PIPELINES_PROMPT_TEMPLATES
- `positions.ts`: CARD_WIDTH, STAGE_GAP, COLUMN_PITCH, ROW_GAP, GRID_STEP, estimatedCardHeight, positionsFromPlaces, withFilledPositions
- `project-pipeline.ts`: CopiedFrom, ProjectPipeline, ProjectPipelineEdit, NewProjectPipeline, ProposedProjectPipeline, PipelinesAround, asPipeline, projectPipelineEditProblems, projectPipelineNameProblems, proposedProjectPipelineProblems, copiedProjectPipeline, savedProjectPipeline
- `proposed-routes.ts`: StageRouteChange, KeptStageProblem, ProposedRoutes, routeChangesOf, routesWords
- `publish-result.ts`: PublishResult, PUBLISH_RESULTS, DONE_PUBLISH_RESULTS, publishResultOf, PUBLISH_RESULT_NAMES, isPublishResultTest
- `publish-stages.ts`: KeptPublishStage, RESOLVE_KEY, RESOLVE_TEST_KEY, RESOLVE_GATE_KEY, CONFLICT_ROUTE_LIMIT, RESOLVE_TEST_COMMAND, ENDED_CONFLICT, withPublishStages
- `publish.ts`: CommitMessage, RemoteBranch, ResolveStart, ResolveEnd, BaseTakenIn, Publication, publishedMessage, publishOutcome, shippedWork, publishedVariables, UnfinishedPublication, unfinishedPublication, publishedSummary, afterPublishingFailedOutcome, shippedOutcome, continuedOutcome
- `resolve-template.ts`: RESOLVE_TEMPLATE_ID, RESOLVE_TEMPLATE_NAME, RESOLVE_TEMPLATE_BUDGET, RESOLVE_BUDGET_ABOVE, RESOLVE_TEMPLATE_BRIEF
- `restart-refused.ts`: RestartRefused
- `route-choices.ts`: END_ROUTE_KEY, ChoiceRow, choiceRowsOf, hasChoiceRows, routeTargetName, NamedChoice, namedChoice, atItsLimit, choiceCountWords
- `route.ts`: Route, RouteLimit, ROUTE_LIMIT_MAX, ROUTE_BACK_LIMIT, GivenRoute, defaultRouteLimit, ENDED_FAILED, ConditionGroup, ConditionTest, StageTestOutcome, StageTest, DefinitionOfDoneTest, CommandTest, ChoiceTest, choiceCondition, agentChoiceOf, choiceRoutesOf, hasChoiceTest, StagePlace, StagePosition, plainRoute, isFailureRoute, isConditionGroup, testsOf, namedRoutes, unnamedRoutes, commandKeysOfRoutes
- `routes-back.ts`: KeptOnFailure, KeptStage, withRoutesBack
- `script-stage-outcome.ts`: scriptStageOutcome, installFailure
- `staffing-decision.ts`: STAFFING_OPTIONS, staffingHoldReason, staffingDecision
- `stage-boundary.ts`: startsAtStageBoundary
- `stage-budget.ts`: stageBudget, budgetReached, budgetOutcome, tokensWords
- `stage-command-run.ts`: CommandOutcome, CommandRun, MovedFiles, ScriptCommandRun, StageCommandPurpose, ConditionCommandTest, StageCommandRun, StageCommandRunWithOutput, Installation, installRuns, failedInstall, commandRunsOf, conditionRunsOf, howItEnded
- `stage-commands.ts`: missingCommandsOnStages, commandsWords
- `stage-commit.ts`: UPDATE_BRANCH_TOOL, ConflictHandling, BranchUpdate, ExpectedHead, stageCommitMessage, headProblem, branchKept, BRANCH_NEWS, branchUpdateWords, PublishingBranchPush, withPushWords, pushFailedWords, branchMovedWords
- `stage-context-limits.ts`: ContextLimits, StageContextLimitsOverride, effectiveStageContextLimits
- `stage-history-words.ts`: STAGE_HISTORY_READ_LIMIT, stageHistoryWords, stageRunWords, stageRunThreadRoom, standInChoiceWords, engineSwitchWords
- `stage-interruption.ts`: CutShortBy, actsNow, discardsEdits, stopsCommands, waitsForTheTurn, outranks, interruptedOutcome, holdingUserWords, StageWorkClosing, closingOf
- `stage-permissions.ts`: HardSwitchOnCard, StagePermissions
- `stage-progress.ts`: StageState, WentBack, StageProgress, TaskProgress, stagesProgress
- `stage-result.ts`: STAGE_RESULT_SCHEMA, StageResultReading, readStageResult, screenshotsRefused, correctionMessage, RESULT_CORRECTION
- `stage-run-changes.ts`: StageRunChange, NewStageRun, startStageRun, heldRunChoice, endStageRun, holdStageRun, keepDecision, keepAnswers, keepGateAction, keepRestart, keepStartedOver, NamedEngine, engineSwitched
- `stage-run-events.ts`: StageRunStarted, StageRunThreadOpened, StageRunWaiting, StageRunEngineSwitched, StageAwaitsStandInChoice, StandInChoicesChanged, StageRunEnded, StopHeldAsPause, BudgetReached, WentBackToStage, NoRetriesLeft, RouteLimitReached, DefinitionOfDoneNotMet, GateReached, GateContinued, SentBackFromGate, GateDropped, PipelineCompleted
- `stage-run.fixtures.ts`: aStageRun
- `stage-run.ts`: StageRecommendation, StageDecision, OutOfReachStatement, StageOutcome, RefusedTurn, StandInChoice, EngineSwitch, StageInterruption, AskedInterruption, PublishedWork, BaseMoved, BudgetReached, StageSessionMove, StageTokens, NO_STAGE_TOKENS, StageRunContext, addTokens, StageOutcomeStatus, HoldingUser, CarriedFailure, GateDropReason, GatePerson, GateAction, SentBack, TaskRestart, Restarted, StartedOver, StageDecisionKind, WalkAnswer, StageRunDecision, StageRunStandIn, AgentRunDecision, WalkRunDecision, WalkDecisionKind, ChosenRoute, StageRun
- `stage-runs-file.ts`: StageRunsFileOutcome, StageRunsFileStatement, StageRunsFileRun, StageRunsFile, StageRunsFileTask, stageRunsFile
- `stage-staffing.ts`: RoleFilling, RoleFillingsByWorker, fillingKey, dutyLabel, staffedStages, dutiesToStaff, staffedRole, unstaffedWords, staffingProblems, stageStaffingProblem
- `stage-template-events.ts`: StageTemplateAdded, StageTemplateSaved, StageTemplateRemoved
- `stage-template-link.ts`: WHO_FIELD, TemplateFields, templateFields, fieldsDiffering, withTemplateFields, unlinkedStage, unlinked, unlinkedFrom, withLiveLinks
- `stage-template.ts`: StageTemplate, templateStage, storedStageTemplate, storedTemplateStage, stageTemplateProblems, proposedStageProblems, stageTemplateFlags, templateProblem, addedStageTemplate, savedStageTemplate
- `stage.fixtures.ts`: agentStage, dutyStage, scriptStage, publishStage, keptPublishStage, gate, goingBackOnFailure, straightLine
- `stage.ts`: Stage, StageKind, STAGE_KIND_NAMES, ScriptStageCommand, PUBLISH_COMMAND, isPublishStage, publishesByThePublishingMode, PublishTarget, StageSession, Effort, AgentStage, ScriptStage, PublishStage, Gate, StageWorker, stageWorker, StageWorkers, agentStageWorkers, sameWorkerNamed, commandKeysOfStage, commandKeysNamedBy, NewlyNamedWorkers, newlyNamedWorkers, mergedWorkers, NO_STAGE_WORKERS, sameAsKept
- `stages-edit-refused.ts`: StagesEditRefused
- `start-over.ts`: runsOfLatestStart, isOfEarlierStart, startOversOf, startedOverRef, workLeftTheWorkstation, startOverRecord
- `task-stages-events.ts`: TaskStagesMade, TaskStagesEdited, TaskStagesReset
- `task-stages.fixtures.ts`: implement, tests, review, publish, stages, own, roles, ranOnce
- `task-stages.ts`: TaskStages, TaskTrace, makeTaskStages, followsPipeline, isFinished, whyStagesAreKept, TaskOfStages, rolesNamedByOpenTasks, lockedStageCount, firstStageToWork, startedStageKeys, editProblems, editTaskStages
- `test-results.ts`: TestResultState, TestResult, latestTestResults
- `usage-history.ts`: HISTORY_TASKS, StageUsage, StageUsages, PricedTokens, ModelTokens, StageRunUsage, countedTokens, stageUsages, tokensByModel, dollarsPerToken
- `walk-decisions.fixtures.ts`: implement, tests, usedUpRouteBack, testsWithoutLoop, aRun, failed, sentBack
- `walk-decisions.ts`: DecisionAnswer, WalkDecision, walkDecision, walkDecisionId, walkAnswerOf, asksAConsultantFirst, agentDecision, AcceptedIssue, acceptedIssues
- Tests: agent-command.full.test.ts, agent-stage-brief.full.test.ts, agent-stage-brief.test.ts, allowed-commands.test.ts, built-in-pipelines.full.test.ts, built-in-stage-templates.full.test.ts, conditions.test.ts, flow.test.ts, followed-hard-switches.full.test.ts, gate.test.ts, library-pipeline-kind-defaults.test.ts, library-pipeline.full.test.ts, merge-base-first.test.ts, pipeline-walk-restart.test.ts, pipeline-walk.test.ts, pipeline.full.test.ts, pipeline.test.ts, pipelines-prompt-templates.full.test.ts, project-pipeline.full.test.ts, proposed-routes.test.ts, publish-stages.test.ts, publish.full.test.ts, publish.test.ts, route.test.ts, routes-back.test.ts, script-stage-outcome.full.test.ts, stage-boundary.test.ts, stage-budget.full.test.ts, stage-commands.test.ts, stage-commit.full.test.ts, stage-commit.test.ts, stage-context-limits.test.ts, stage-history-words.full.test.ts, stage-history-words.test.ts, stage-progress.full.test.ts, stage-result.full.test.ts, stage-result.test.ts, stage-run-changes.test.ts, stage-runs-file.test.ts, stage-staffing.full.test.ts, stage-template-link.test.ts, stage-template.full.test.ts, task-stages.full.test.ts, task-stages.test.ts, test-results.full.test.ts, usage-history.full.test.ts, walk-decisions.full.test.ts, walk-decisions.test.ts

### ports/

- `known-people.ts`: KnownPerson, KnownPeople
- `pipeline-initiatives.ts`: PipelineInitiative, PipelineInitiatives
- `pipeline-repository.ts`: PipelineRepository
- `pipelines-ports.fixtures.ts`: RunEnvironmentDefinitionsForTests, TaskConsultationsForTests, StageRoleEnginesForTests, RoleEngineCascadeForTests, ProjectDefaultsForTests, PipelineInitiativesForTests, StartedTasksForTests, aTaskRecord, TaskRecordsForTests, aPerson, KnownPeopleForTests, StageThreadMessageForTests, StageThreadMessagesForTests, StageThreadsForTests, StageDecisionsForTests, TaskUsageForTests, StageContextLimitDefaultsForTests, TaskThreadSessionsForTests, SessionPeopleForTests, TaskScreenshotsForTests, PLANNED_COMMIT, TaskGitForTests, aCommandRun, recordedRun, TaskCommandsForTests, RESOLVED_COMMIT, TaskPublishingForTests, PipelinesPortsForTestsModule
- `project-defaults.ts`: ProjectDefault, ProjectDefaults
- `project-pipeline-repository.ts`: ProjectPipelineRepository
- `role-engine-cascade.ts`: TaskSessionPlace, RoleEngineCascade
- `run-environment-definitions.ts`: RunEnvironmentDefinitionFile, RunEnvironmentDefinitionWriting, RunEnvironmentDefinitions, RunEnvironmentDefinitionCommit
- `session-people.ts`: SessionPeople
- `staffing-hold-repository.ts`: StaffingHoldRepository
- `stage-context-limit-defaults.ts`: StageContextLimitDefaults
- `stage-decisions.ts`: StageDecisionRequest, OpenedStageDecision, StageDecisions
- `stage-role-engines.ts`: StageRolesNamed, NewlyNamedStageRoles, TaskStageRolesMove, TaskEnginesChange, StageRoleEngines
- `stage-run-repository.ts`: StageRunThread, LeftBranch, StartedStageRun, RanAgentStageRun, KeptStageRunEngines, StageRunRepository
- `stage-template-repository.ts`: StageTemplateRepository
- `stage-thread-messages.ts`: StageRunThreadWindow, StageThreadMessages
- `stage-threads.ts`: StageSessionSettings, StageThreadRequest, StageContextLimits, StageContextLimitPassed, StageTurn, AskedDecision, StageThread, StageSessionAhead, StageThreads
- `started-tasks.fixtures.ts`: OwnProjectsStartedTasks, ownProjectsStartedTasks
- `started-tasks.ts`: RestartingPerson, WalkTaskState, StartedTask, UsageWindowRefusal, StandInTakingOver, TaskBlocker, ResumedOrDroppedBy, StartedTasks
- `task-commands.ts`: ScriptCommandKind, ScriptCommandResult, PublishingLine, CommandWait, TaskCommandOptions, AgentCommandOptions, TaskCommands
- `task-consultations.ts`: TaskConsultation, TaskConsultations
- `task-git.ts`: WorktreeHead, TaskGit
- `task-publishing.ts`: TaskPublishing
- `task-records.ts`: PublishingMode, TaskCommitMessage, TaskRecord, TaskEngineStandIn, TaskRecords
- `task-screenshots.ts`: ScreenshotsAttaching, TaskScreenshots
- `task-stages-repository.ts`: TaskStagesRepository
- `task-thread-sessions.ts`: TaskThreadSessions
- `task-usage.ts`: TaskUsage
