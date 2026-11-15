# Pipelines: module map

**Owns:** the Pipeline library, its office-wide Pipelines (`pipelines`, its migration seeding the built-ins of `domain/built-in-pipelines.ts` once, each later built-in by a migration of its own that skips a name the user already took (Set up run environment, `0103`); Onboard and Set up run environment stay in the library (`removalProblems`), as onboarding and a Project's set-up Task use them; `PipelineLibrary` reads it, `PipelineLibraryEditor` adds, copies, saves and removes), the Project Pipelines beside it (`project_pipelines`, migration `0130`: each its Project's, an office-wide base Pipeline and ordered Stage changes, pure `domain/stage-change.ts` and `domain/project-pipeline.ts`; built from the base Pipeline's current Stages on every read, never stored built; `PipelineLibraryEditor` adds, checks, saves and removes them under the same `LIBRARY` lock), the Stage templates beside it (`stage_templates`, its migration `0107` seeding `domain/built-in-stage-templates.ts` once; `StageTemplateLibrary` reads them, `StageTemplateLibraryEditor` adds, saves and removes, removing never refused, as nothing points at a template), each Task's own copy of its Stages (`task_stages`, made at Start or at the user's first edit for the Task), and the Stage interpreter that walks them: Agent, Script, Gate and Publish Stages, loops and rounds, budgets, Stage runs (`stage_runs`), and their history for Work's Usage estimates (`UsageHistory`, pure `domain/usage-history.ts`) and the Briefs of people's Threads on Tasks and a Task's record in `read_task` (`StageResultWords`: each run's result, and a person's Handover notes with `of` or every one with its Stage and Role with `ofTask`), and when the last Gate run the user acted on ended, by which Work replaces an Agent's Attachment (`TaskGateRuns`, `lastActedOnGateRun` in `domain/gate.ts`, Work's `TaskGates` port), and a diagnosis of a Task's runs (`StageHistory`, pure `domain/stage-history-words.ts`, read by the Office tool `read_stage_history`, which `PipelineOfficeTools` registers and Conversations offers in every person's chat, Thread on a Task and Consultation, and `AGENT_STAGE_OFFICE_TOOLS` in every Agent Stage). An Agent run keeps its session's context after its latest turn (`StageRun.context`, `stage_runs.context`, from `StageTurn.context`), which an ended run's Thread tab shows, as a later run resuming the session moves the Thread's own.

**Talks to:** fills People's `PipelineRoleSources` with the Roles Agent Stages name (`RolesNamedInStages`: the library's everywhere, open Tasks' own Stages' by Project, pure `rolesNamedByOpenTasks`; a Task done or dropped, or Stages it no longer follows, don't count); reacts to Work's events (`TaskStarted`, `TaskResumed`, `TaskPaused` (by the user or the fire alarm; one by the usage window is ignored, as the Stage runner held the run itself), `TaskStopped`, `AlarmSounded`, `TaskStateChanged` to Dropped (Resolve's merge aborted, and a started Task's running Stage interrupted as a Stop, whether the Task or its Initiative was dropped), and `TaskPipelineConfirmed`, which sets aside Stages edited for the old Pipeline) Conversations' `DecisionAnswered` and People's `RoleLetGo`; everything else goes through its ports, bound in [app.module.ts](../../app.module.ts): `StartedTasks` and `TaskRecords` to Work (the record an Agent Stage's Brief is made from, its "Linked records" and "Who asked" sections worded by Work; every Agent Stage reads every record with Conversations' `READING_OFFICE_TOOLS`, which `AGENT_STAGE_OFFICE_TOOLS` starts from, adding `read_stage_history` but never `read_threads`; `StartedTasks.find` tells `StageHistory` an unknown Task from one not started), `KnownPeople` to People's `RoleCards` (`holderOf(duty)`: the Role holding a duty, undefined while nobody does), `StageThreads`, `StageThreadMessages` (an Agent Stage run's Stage Thread messages for `read_stage_history`, worded by Conversations' `ThreadHistory` as `read_threads` words them), `StageDecisions` and `TaskThreadSessions` to Conversations, `TaskGit`, `TaskCommands` (Script Stages' commands, installs, and Agents' commands through `run_project_command`) and `TaskPublishing` to Projects' `TaskWorktrees`, `TaskScreenshots` to Work's `StageScreenshots`, `TaskUsage` to Conversations' `TaskTokens` (`budgetTokensSoFar`: a person's Thread, the planning one too, never counts to a Stage's budget), `ProjectDefaults` to Projects' `ProjectService` (each Project's default Pipeline and command keys), `ProposalDrafts` to Conversations' `ProposalService`, `StageRoleEngines` to People's `PipelineRoleCapabilityChecks` (a library save or a Task's Stage list edit that newly names a Role whose engine can't work an Agent Stage is refused: the editor's saves, its check and a Proposal's Stages, and `TaskStagesService.review`; only Roles neither the library nor the Task's own Stages name yet are weighed, a Task's in its Project, `StartedTask.projectId`); `PipelineInitiatives` to Work's `InitiativeService` (`withPipelines`: every Initiative naming a Pipeline of its own, whatever its state); the library editor counts Tasks through `StartedTasks.list` and Initiatives through `PipelineInitiatives`: a library Pipeline's use (`initiatives`, the shaping and active ones by name; `GET /pipelines/:id/use` answers their number), its removal (refused per such Initiative) and its missing commands (each Project such an Initiative spans) weigh them. Proposals of a library Pipeline's Stages by whoever onboards Projects (`pipeline`): `PipelineOfficeTools` registers `list_pipelines` and `propose_library_pipeline`, and `PipelineProposals` fills Conversations' `ProposalAppliers`, saving through `PipelineLibraryEditor.saveProposedStages`, which refuses once the Stages changed since the draft (`proposedStagesProblems`, comparing Stages as kept, so a field left undefined equals one left out); Conversations keeps the Stages unread, and they are parsed back with the contracts' `stageSchema`. A Stage template's new Stage (`stage-template`) is proposed alike: `list_stage_templates` and `propose_stage_template`, saved through `StageTemplateLibraryEditor.saveProposedStage` and judged by `proposedStageProblems` (refused once the template's Stage changed since the draft, compared as kept, and by what a template save refuses: a name another template has and a single Stage's rules; its Role is only flagged, as on a template save, and counts for no engine check). A Project Pipeline, new or changed (`project-pipeline`, `ProposedProjectPipelineChange`), is proposed with `propose_project_pipeline` (a field left out of a change keeps its value; a new one needs its name and base Pipeline) and saved through `PipelineLibraryEditor.saveProposedProjectPipeline` under the `LIBRARY` lock, judged by `proposedProjectPipelineProblems` (pure `proposedProjectPipelineProblems` in `domain/project-pipeline.ts`: an unknown Project Pipeline or another Project's, "<name> changed since this was proposed." once its fields differ from `from` as kept, a `stageName` not counting, and nothing changing; then the add's or save's own `projectPipelineProblems`); it never sets a Project's default. `list_pipelines` (an optional `project`) answers the office-wide Pipelines, then each Project Pipeline with its Project, base Pipeline, Stage changes, built Stages and Broken reasons; after a `pipeline` draft, `propose_library_pipeline` answers the Project Pipelines its Stages would break (`breaksOf`), warning without refusing, as the card does. `ProposalDrafts` drafts any of them (`ProposedLibraryChange`). Other modules read the library, its Pipelines and Stage templates, through `PipelineLibraryModule`, never `PipelinesModule`; the library's writes live in `PipelinesModule`, since they ask Projects and Work, who import the library. `UsageHistory` prices runs through Engine's `ModelPrices` (by each run's engine id and model); a Stage run keeps its engine's id and its name at the time, which the Agent Stage runner reads from Engine's `EngineModels` (the id when the engine was removed since its session started) and is for Work's port, through `UsageHistoryModule`. Counts a running Script Stage and Publish as Office-updates' `BusyWork` (`ScriptStageRunner.run`); while an Office update or restart is scheduled (`ScheduledExitHold`) the walk ends before starting an Agent or Script Stage, a Gate still asking, and walks those Tasks again on `ScheduledExitCancelled`.

**Traps:**

- The Task's commit message (spec §2.3): every Agent Stage's Brief shows it (`TaskRecord.commitMessage`, Work's, the default while none is written) and its Stage message tells only the last Agent Stage before a Publish that lands it to recheck it (`isLastAgentStageBeforePublish`: Resolve Stages passed over and never it, a `branch-only` Publish landing nothing), with the branch it lands on (`landsOn`) and the revisions its whole diff is read from (`changesFrom`, `TaskGit.changeBases`, the same `changesSoFar` counts from: a diff from one base, the Task's own commits with two). The Publish Stage sends it whole (`publishedMessage`) and, once a `merged` Publication carries a `subject` (one commit landed) or a pull request opened, marks it published (`StartedTasks.markCommitMessagePublished`); a Publishing Task's merge carries its commits unchanged, so it marks nothing. HEAD is expected at the `merged` Publication's `head`, never its `commit`, the landed commit no local branch names.
- A run held by the user's Pause or Stop names them: `TaskPaused`/`TaskStopped` carry the user, `StageRunInterruption.request` keeps it, `stage_runs.held_by_user` beside `held_by` for a start after a crash, and the outcome's `heldByUser` words the error, the history ("paused by the user Ann Lee") and the Brief's held section. Runs held before users existed name nobody ("the user"); there is no claim for them. A staffing Decision's answer drops or resumes the Task as `{ kind: "user", user: null }` (`ANSWERING_USER`) until Decisions say which user answered.
- Office-wide versus Project-aware: `PipelineLibrary.list`, `find`, `has` and `rolesNamed` read the office-wide Pipelines only; `read`, `listFor` and `commandsNamedBy`, which Work's and Projects' `KnownPipelines` bind, answer Project Pipelines too, built, each with its Project and why it is Broken, any Project's for `read` and `commandsNamedBy`, so each caller refuses another Project's and names it. `forTask(pipelineId, projectId)` is the seam Start copies through (`TaskStagesService.pipeline`, so Start and a Task's first edit for itself copy a Project Pipeline's Stages as built then), answering another Project's Project Pipeline as unknown and a Broken one with its reasons, which Start refuses (`StagesEditRefused`). `GET /pipelines` stays office-wide, with `builtOnBy` per Project.
- Broken (the CTO's rule, 2026-11-12) means the built Stages can't run, worked out by `buildStages` on every read: a Stage change whose key isn't there, an inserted key already there, a field a Change gives that its Stage's kind lacks, and `stageProblems` on the built Stages (loops, names, "continue"); each failing Stage change is skipped, so every reason shows and the Stages still read. Missing commands and the engine check need a Project and stay out of it: a Project Pipeline's own save weighs them against its Project only, and an office-wide save is refused for a Project Pipeline built from it that its Project, running it, would lack a command for (`missingCommandProblems` with that Project alone). A Project Pipeline's own save is refused while Broken; an office-wide save never is, its check answering `breaks` (`brokenBy`; `breaksOf` for the answer to a `pipeline` Proposal by whoever onboards Projects), which leaves out a Project Pipeline already Broken with the saved Stages, as the edit didn't break it. A `project-pipeline` Proposal is refused for whatever its add or save is, through the same `projectPipelineProblems`: a command its Project lacks counts only once something runs it (its Project's default or a not-started Task), as on a save.
- Names span both tables: an office-wide Pipeline's against every Project Pipeline's (the refusal names the Project), a Project Pipeline's against the office-wide ones and its own Project's (`pipeline-names.ts`). Only `(project_id, lower(name))` is a unique index; the rest is checked in the application under the `LIBRARY` lock, so every write to either table takes it.
- `project_pipelines.project_id` has no foreign key (no module reads another's tables, spec 5.3); `base_pipeline_id` references `pipelines(id)` ON DELETE RESTRICT, backing `removalProblems`' refusal per Project Pipeline built from a Pipeline. The Office has no Project removal yet: whoever adds it must remove the Project's Project Pipelines with it, through a Projects event Pipelines reacts to. A Task moved to another Project already loses its Pipeline (`TaskMovedToProject`).
- Each Stage change keeps `stageName`, its Stage's name as built at its last save (`addedProjectPipeline`, `savedProjectPipeline`), for its words alone: matching is by key. An edit may send it back as read; one without it that names a missing key reads "isn't among the Stages", one with it "which … no longer has", and one naming a Stage an earlier Stage change removed "which an earlier Stage change removes".
- A Project Pipeline's add, save and removal publish the office-wide `PipelineAdded`, `PipelineSaved` and `PipelineRemoved`, so the web's refetches cover both; its engine check names Roles in its Project (`RolesNamedInStages` registers its built Stages' Roles as a second `PipelineRoleSources` source).

- A Task in Shaping keeps its Stages as Work keeps its Pipeline (`whyStagesAreKept`), and `library-pipeline.ts` lists the not-started states apart from Work's, Shaping among them; it lists an Initiative's open states (shaping, active) apart too, as Work's `withPipelines` answers done and dropped Initiatives as well.
- A Publish Stage's `publishTarget` absent means the Project's publishing mode: Stages stored before it was added carry none, so never require it.
- An Agent Stage's `permissions` narrow its Role card's profile through People's `narrowedPermissionProfile` (in `AgentStageRunner.open` and `sessionAhead`, the Brief's commands too); absent keeps the card's, and Stages stored before carry none. A setting wider than the card is flagged in the library and refused for a Task (`RoleFillings.permissionProblems`, not `staffingProblems`, which holds Tasks); at run time the card's applies. MCP tools the Role's servers don't have are ignored.
- An Agent Stage's `permissions.commands` is applied by Pipelines, not by `narrowedPermissionProfile`: the card has no list of commands. `stageProjectCommands` in `allowed-commands.ts` is its one source, read by `allowedCommands` (the Brief and the engine's allowed lines) and `commandKeyRefusal`, which `StageProjectCommands` (`run_project_command`) checks a key against, finding the running Stage with `walkedStages`; install is never refused there. Under the run permission anything a narrowing is only told, so a command line the Agent writes out, even one extending a kept command's, is judged by the session's rules alone and still runs; only its key is refused.
- The built-ins live twice: `builtInPipelines` and the `pipelines` migration's seed, which `pipeline-library.test.ts` compares; a change to a built-in needs a migration too, as `0151` moved their Agent Stages from `developer` and `devops` to the duties `implements` and `onboards-projects`, in `pipelines` and `stage_templates` alike, wherever a built-in Stage still named its built-in Role (`stage-duties-migration.test.ts`). Once seeded, the table is the library, and the user's edits of a built-in stand.
- `UsageHistoryModule` holds `StageRunRepository` and `UsageHistory` apart, as `PipelineLibraryModule` holds the library, so Work can import it: it must never depend on a port bound to Work. Work names the done Tasks (`UsageHistory.of(doneTaskIds)`, each Stage's median tokens; `dollarsPerToken(doneTaskIds)`; window % is the Engine's, not kept per run), as Pipelines keeps no Project or done time; the latest 20 by their last run's end are kept.
- The built-in Stage templates live twice too: `builtInStageTemplates`, worked out from `builtInPipelines` (the first Stage of each name, its key as the id), and `0107`'s seed, which `stage-template-library.test.ts` compares; a new built-in Stage needs a migration of its own.
- A Stage template has no loop target: `templateStage` drops `onFailure` on every add and save, so none is stored or returned. Its checks (`stageTemplateProblems`) are a single Stage's (`singleStageProblems` in `pipeline.ts`, which a Pipeline's checks share) and a name unique among templates in any case; key, "continue" and loop rules wait for the Pipeline or Task it is added to. Its problems and flags carry no Stage index.
- A template's Role is flagged like a library Pipeline's (`stageTemplateFlags`, `RoleFillings.stagePermissionProblems`), but a template is no Pipeline (spec 2.3): `RolesNamedInStages` and the engine checks leave its Role out, and the Stage it adds is checked when its Pipeline or Task is saved.
- The service's tests share one database across files run in parallel: a test makes Pipelines and Stage templates of its own under a unique name and never changes or removes a built-in.
- `EventBus.publish` waits for its handlers, so the interpreter walks in the background (`walkInBackground`); awaiting the walk would hold Start's request for the whole Pipeline.
- An edit of a Task's Stages and the walk's start of each run take one per-Task lock (`TaskStagesService.holding`), and the walk reads the Stages afresh each move: start a run anywhere else and an edit can change the Stage under it.
- `POST /tasks/:id/stages/check` takes an optional `pipelineId`, the Pipeline the editor's draft follows: a Task with no Pipeline yet, or one swapped to before Save, is checked as if it followed it (`TaskStagesService.review`, through `ownOrCopied` and `forTask`, which refuse a Broken one or another Project's). Without it the check reads the Task's own Pipeline and refuses a Task with none. A refusal answers as `PUT /tasks/:id/stages` does (`StagesEditRefusalsFilter`, 422). Saving still needs the Pipeline set first (`PUT /tasks/:id/pipeline`).
- The walk is worked out from the Stage runs (`nextMove` in `domain/pipeline-walk.ts`): a Gate action, an answer or a send-back is data on a run, replayed, not a call.
- Reported met is one rule, `reportedMet`, over all the Task's runs in their order; a Stage's own `runs` won't do, as a loop's later run can sit under an earlier Stage. `GET /tasks/:id/stages` answers it as `definitionOfDoneMet`, beside each outcome's own report: read that one, never work it out from the outcomes. Both fold every done Agent report oldest first (`definitionOfDoneReports`): a statement stays met once reported until a report lists it in `definitionOfDoneNoLongerMet`, so a report leaving it out takes nothing back. Out of reach (`reportedOutOfReach`) adds up the same way, counting only statements not Reported met; it shows in the Definition of Done Decision (`definitionOfDoneNotMet`), whose question carries those statements apart from the unmet ones, and at the Gate that is the check.
- The Definition of Done check (`advance` → `checkDefinitionOfDone`) runs as the walk enters a Publish Stage that isn't the first, asking on the run before it (`before` set), and past the last Stage only when no such Publish exists. Call it met (`mark-done` with `before`) sets `walk.calledMet`, so neither a later entry into Publish nor the end asks again; Continue at a Gate that is the check (`gateChecksDefinitionOfDone`: no Agent Stage nor later Gate before the Publish after it) sets it too, replayed from the Gate run's `gateAction`, and `GET /tasks/:id/stages` names those Gates in `gatesCheckingDefinitionOfDone`, beside `definitionOfDoneOutOfReach`, for the Gate card's unmet list. Resolve's Stages going back to Publish don't check. Runs from before the check moved: a `definition-of-done` Decision on any run is replayed where it is, and only the last run asks, so older runs that went past Publish unchecked replay on.
- `StageGit.start` is the only check that takes a moved HEAD: along the base (`TaskGit.movedAlongBase`) or after the user's Keep (`branchKept`), told to the Agent as `branchNews`. Any other move is a refusal, `branchMoved` on the outcome, walked by `afterBranchMoved`: no round, the user alone. The checks after a Stage (`checkHead`) stay strict; a refusal saves the expected commit, so the next run expects the same place.
- The Task's first Stage, the one no earlier run has a `headCommit` before, brings the branch to the base in `StageGit.start` (planning made the worktree, maybe hours ago). A conflict gives the branch back and only tells the Agent; a failed fetch doesn't stop the Stage.
- `run_project_command` (`StageProjectCommands`, the tool's name from Engine's `RUN_PROJECT_COMMAND_TOOL`, which the container runtime's refusal names) runs a command for the Agent of the running Agent Stage through `TaskCommands.runForAgent`: a command line it wrote only once the session's Office rules allow it as its own Bash call (`OfficeToolCall.judgeCommand`, so the profile, git, the secrets and the container runtime hold, and a read-only profile runs only the Project's own commands, by key); a key is not judged. A key is any command in the Project's list, or `install`; one it lacks, or whose line is blank, answers `no-command`. `allowedCommands` lists every command in the list but install, as "- key (Name): `line`", for the Brief and the engine's allowed lines. A Script Stage names any command by its key (or `publish`); `TaskCommands.runCommand` answers the command's kind beside its runs, and `ScriptStageRunner` leaves the branch as it was after a test-kind one, or a key the Project lacks, and commits a build or lint one; the test handling of the run itself goes by the kind, in Projects. A call's output goes to a file in the call's `outputFolder`, which the session may Read. Every such command belongs to its Stage run (`StageCommandRuns`): `AgentStageRunner.work` begins them as the Thread opens and ends them, with everything they started, before the session ends and git is read, whatever ended the Stage (result, failure, Stop, Pause, restart); the run's `commandsSignal` (the fire alarm, The Office shutting down) stops them at once. A call before `begin` or after `end` is refused, so none outlives its run.
- `write_run_environment_definition` (`StageRunEnvironmentDefinitions`, the name from Engine's `WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL`, which the hook's `.devcontainer/` refusal names) writes the run environment definition for the Agent of the running Agent Stage into its Task's worktree through the `RunEnvironmentDefinitions` port (Run environments' `RunEnvironmentDefinitions`, bound in [app.module.ts](../../app.module.ts)), answering the checks' service or every problem. Conversations' Stage Threads offer it only to a card with the Run environment capability (`stageCapabilityOfficeTools`); migration 0112 gave the built-in Set up Stage's stored brief, its template and open set-up Tasks' Stages the brief that names it, where they still held the old one.
- `update_branch` (`StageBranchUpdate`) moves HEAD during a run: it saves `headCommit` on the running run, which `StageGit.afterTurn` reads before the after-Stage check, so read `expected` from there after a turn. A merge it leaves is finished by `ResolveStageGit.finish`, on any Stage, found by `TaskGit.mergeInProgress`.
- A Task of an Initiative with a Pipeline (`TaskRecord.initiativeBranch`) takes in its Initiative's branch, then the base branch, at the first Stage, in `update_branch` and at Resolve, and its Publish merges into the Initiative's branch (Projects does the git). Name what the branch takes in with `baseWords` (`domain/base-words.ts`: "initiative/x, then main"), and a conflict by the branch it names (`BranchUpdate.conflicted.from`, `ResolveStart.base`). A clean merge of the Initiative's branch before a conflict with the base has moved HEAD: `StageBranchUpdate` saves `update.commit` of a conflicted update that carries one, `ResolveStageGit.begin` leaves the run at `start.commit`, and `PublishStage` at a `base-moved` Publication's `commit`, or the after-turn check fails the Stage. The test fakes (`TaskGitForTests.updateFromBase`, `TaskPublishingForTests.startResolve` and `publish`) move HEAD there as git would.
- A Publish's `pullRequestUrl` comes from `Publication`'s `pull-request-opened`, never from its summary's words; runs stored before it have none.
- Publish's before and after lines (spec 2.3 Defaults) run in `PublishStage` only when it ships by the publishing mode (`shipsByPublishingMode`: an ordinary Task or a Publishing Task, the `publishing-mode` target), through `TaskCommands.runPublishingLine`. The before line's commit moves `expected.commit` before `publish` and `leaveAt`, or StageGit refuses the next Stage. What shipped is saved on the run (`StageRun.published`, `savePublished`) before the after line runs: a later run of the Stage with that record and no done run since (`unfinishedPublication`) never publishes again, running only the after line, or, once the `after-publishing-failed` Decision was answered Continue (`accept-issues`, which keeps the walk at the Stage), ending done and removing the worktree. A failed after line is a failed outcome with `afterPublishingFailed`, which `pipeline-walk` sends to its own Decision, never the on-failure loop, put first to whoever is asked first when a Stage runs out of tries only the first time (`asksAConsultantFirst`).
- A Stage failing with no retries left is put first to whoever is asked first when a Stage runs out of tries (`asksAConsultantFirst`, `StageDecisionRequest.putTo` from `holderOf("asked-first-when-out-of-tries")`, left out while nobody holds it, so the user is asked); Conversations falls back to the user when the holder can't be consulted, and `NoRetriesLeft.putTo` says which. `built-in-pipelines.ts` still names the devops Role key for its Stages (left to a later Task). The holder's words come back as a `one-more-round` answer with `guidedBy`, which the Brief names, and a Stage they sent back once goes to the user next time.
- Resolve (spec 2.3, "Conflicts at Publish"): a Publish run that conflicts puts Resolve, its Test and, when the Publish's `afterConflict` is `review`, a Gate (keys `office:resolve…`, `domain/resolve-stages.ts`) before that Publish, derived from the runs and never stored. `afterConflict` absent publishes automatically; the Publish has a run by then, so it is locked and the Stages stay as derived: read the Stages as walked (`walkedStages`) wherever runs meet them (the walk, progress, the Gate, staffing), and strip them from an edit (`withoutResolveStages`). The Resolve Agent Stage's git is The Office's around the Agent's turn (`ResolveStageGit`, through `TaskPublishing`): no commit of its own, the merge committed once no marker is left; a round its Gate sent back is an ordinary Agent round on the merged branch, committed as any Stage's; dropping the Task aborts a merge left in progress (Work's `TaskStateChanged`).
- What the all clear would resume (`AlarmResumes`, pure `domain/alarm-resume.ts`, read by Notifications' Now): from the walk's next move, an Agent Stage's session as `AgentStageRunner.sessionAhead` asks `StageThreads.sessionAhead` (the same `stageSessionOf` and record as a run's `open`), a warm cache counted at a tenth of its context; none while the held run still runs. A run the alarm held shows Paused.
- The fire alarm (spec 2.8) is the `alarm` interruption: held after the Agent's turn as a Pause, its edits kept, but its Project commands stopped now, so a Script Stage stops at once; a Publish takes no interruption and finishes. `AlarmSounded` schedules the hard stop (`Schedule.once`) of the runs going on then, which cuts their turns short (`StageRunInterruption.hardStop`, `cutShortBy`), edits kept. At boot an In progress Task is held through `StartedTasks.holdForFireAlarm` before anything walks, and a run left running on a Task the alarm paused ends held by it.
- The Office shutting down is the `restart` interruption (spec 2.4): it stops the turn and the commands now but keeps the edits (`discardsEdits` is the user's Stop alone, which outranks it, so a Stop asked before a shutdown still discards). At boot a run left running on an In progress Task ends as restarted, edits kept, and the walk goes on by itself, the Stage again in its Thread with the Brief's restart section (or the Stage due next), using no round. Only the `RESTARTS_ASKED_AT`th restart in a row during a Stage (`restartsInARow` in `pipeline-walk.ts`, counted since a run of it ended any other way or the user answered one) opens the `restart` Decision. Runs recorded `notStarted`, and `restart` Decisions on earlier restarts, are from before (2026-11-14) and are only read.
- A turn the engine refuses for a used-up usage window (spec 2.3; the Stage Thread's `StageTurn.usedUpWindow`) is the `usage-window` interruption, ranked just above `pause`, below the alarm and Stop: `AgentStageRunner.readResult` stops at it, the first turn or the correction alike, sends no correction, and, unless the user or the alarm already holds the run (which stays), requests it itself, saves it as `heldBy` and pauses the Task through `StartedTasks.pauseForUsageWindow` until the reset; Work's `TaskPaused` for it is ignored, so the run is held once. The run ends held, its edits kept, with `outcome.refused` (`RefusedTurn`: which message, the correction's problems, whether a session was left, the engine's name, the window's words, the reset). On resume `heldRunOf` hands it to the Brief's `usage-window` section, which sends the refused message again with the half-done line; a refused first turn of a session the Stage began (`sessionLeft: false`) begins the Stage anew with its declared session and full Brief (`leftASession` in `stageSessionOf`). After a crash a run left running on a Task paused by the usage window ends held by it, its refused message unknown.
- A Project command may wait for a free run environment before it starts (the Project's Run environment On, every one Run environments at once allows in use): `TaskCommands.install` and `runCommand` take `wait` beside `signal`, and `StageRunWaits` saves `waitingSince` on the running run and publishes `StageRunWaiting` (`stage-run.waiting` to the web) as the wait begins and ends; `saveEnded` clears it too. The Stage's state stays `running`: the web reads `waitingSince` for "Waiting for a run environment". The interruption's `commandsSignal` ends a wait at once, the command `stopped` with nothing run.
- A command's whole output (Projects' `wholeOutput`, its last 64 KB) is saved beside its run in `stage_runs.command_outputs`, in the order of `commandRuns`, and read only by `GET /tasks/:id/stage-runs/:runId/command-outputs`; `list` and `listOfTasks` leave it out, as the walk reads every run at each move and the web refetches the Stages at each event. The `output` on a command run is the filtered one, which the Brief and the failure's words use; a run saved before `command_outputs` answers with that.
- `read_stage_history` (`StageHistory`) reads the Stage run records, `list` then `commandOutputs` for one run, and an Agent Stage run's Stage Thread messages through `StageThreadMessages` (`count` alone for the whole history), and never a file or an engine transcript: a test run's `movedFiles` are named by their `paths`, never their `folder` under the Office data directory. Its answer is capped at `STAGE_HISTORY_READ_LIMIT`, the outputs sharing what the words leave, each keeping its end; in one run's answer the Thread messages get `stageRunThreadRoom` (at least half of what the words leave, plus what the outputs don't need), asked for before `stageRunWords` caps the outputs to the rest. The window runs from the run's start to its end (to now while it runs), so a Thread reused across runs shows each run's own. A Task with no own Stages and no runs is asked of `StartedTasks.find`: unknown, or not started in its state as the board names it (Work's `TASK_STATE_NAMES`).
- `StaffingHolds` pauses a Task whose next Stages nobody can work, behind a Decision kept in `staffing_holds`; the interpreter asks it on every `TaskResumed` before walking, so a Resume while the lack stands pauses the Task again. People's `RoleLetGo` and `DutyHolderChanged` both make it weigh every started Task again.
- An Agent Stage names a Role (`role`) or a duty (`duty`, People's `DutyKey`), never both (`singleStageProblems`; a Stage change giving one clears the other, giving both is Broken). Read who works it through `stageWorker`, never `stage.role` alone. `staffedStages` gives each duty Stage a `role` for one move: the `roleKey` of its latest run, so a started Stage keeps its person, else the holder now (`KnownPeople.holderOf`, read once per move inside the Task's lock by `RoleFillings.staffed`), else none, and the runner ends it with `unstaffedWords`. The interpreter saves that Role on the run (`stage_runs.role_key`, migration `0151`); Handover notes, the alarm's plan and `staffingProblems` read the same staffing, and the Task's Stages answer `workedBy` for a duty Stage. `RoleFillings` keys a duty's filling `duty:<key>` (`fillingKey`) and weighs it by its holder, or by the Role it names but was let go (`dutyRoleKey`). People's sources hear duties apart (`duties` in `PipelineRolesNamed`); People resolves them to holders.
- `commandKeysNamedBy` (`domain/stage.ts`, per Stage `commandKeysOfStage`) is the one source of the command keys a list of Stages runs: each Script Stage's key but `publish`, plus `RESOLVE_TEST_COMMAND` for a Publish by the publishing mode beside an Agent Stage. Every missing-command check reads it: the library editor's save, check and Proposal (`missingCommandProblems`, over the Projects with the Pipeline as default, those with a not-started Task on it, `StartedTask.projectId`, and those a shaping or active Initiative naming it spans), a Task's own Stages edit (`TaskStagesService.review`, from the locked Stages on), and through `PipelineLibrary.commandsNamedBy` Projects' and Work's refusals. An Agent Stage's narrowed `permissions.commands` count there too, so a narrowing to a key a Project lacks is refused as a Script Stage's is. Keys alone count: a blank command passes and fails could-not-run when it runs; Stage templates aren't checked.
- A Publishing Task (`TaskRecord.publishingTask`; its worktree holds `initiativeBranch` itself) walks under three rules. Before every Stage, a Gate too, the walk asks `StartedTasks.waitingFor` and, while a blocker is open, keeps it in `heldForBlocker` and stops, the Task still In progress; any Task's `TaskStateChanged` to Done or Dropped and `TaskDependencyRemoved` walk those again (`walkHeldForBlocker`). Each of its Stages runs holding `InitiativeBranchStages` (`KeyedLocks` on the Project and the branch), and a fix Task's Publish into that branch takes the same lock in `PublishStage`, so it waits for a running Publishing Task Stage; a Publishing Task's own Publish never takes it again (the lock is reentrant anyway). After each Stage's commit `StageGit.commit` pushes its branch (`TaskGit.pushPublishingBranch`) and a failed push only adds its words to the outcome (`withPushWords`). A fix Task's Publish that fast-forwarded its worktree leaves HEAD at the moved-to ref, which `movedAlongBase` accepts, so the next Stage's Agent gets `branchMovedWords`. `DroppedPublishingTasks` removes a dropped one's worktree under the lock, keeping the branch, or the next one can't check it out. `baseWords` names the base branch alone for it, and its Brief says Publish puts the branch into the base by the publishing mode (`publishingModeWords`).
- A Task's Stages edited for it are told to Work through its `TaskStageEdits` registry, which `TaskStagesService.onModuleInit` fills (`editedForTask`), so the Pipeline swap of whoever shapes Initiatives leaves those Publishing Tasks be; Pipelines' test ports provide it. Work answers `PipelineInitiatives` one entry per Initiative and Project it has a Pipeline in (an office-wide one or that Project's Project Pipeline), so the library weighs commands only in that Project and a Project Pipeline an Initiative names can't be removed; `openInitiativesOn` leaves out an entry whose Pipeline started there (`PipelineInitiative.pipelineStarted`): that Publishing Task walks its own copy.

**Open:** after Publish removes the worktree, a message to the Task's Planning Thread opens a session in a folder that no longer exists (task 14).

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

AlarmResumes, PipelineLibrary, StageTemplateLibrary, StageResultWords, TaskGateRuns, TaskStagesService, UsageHistory, StageUsage, StageUsages, DefinitionOfDoneNotMet, GateContinued, GateDropped, GateReached, NoRetriesLeft, PipelineCompleted, SentBackFromGate, StageRunEnded, StageRunStarted, WentBackToStage, TaskStagesEdited, TaskStagesMade, PipelineLibraryModule, PipelinesModule, UsageHistoryModule, StageDecisions, TaskCommands, TaskUsage, TaskGit

## Domain events

- `domain/pipeline-library-events.ts`: PipelineAdded, PipelineSaved, PipelineRemoved
- `domain/stage-run-events.ts`: StageRunStarted, StageRunThreadOpened, StageRunWaiting, StageRunEnded, StopHeldAsPause, StageSkipped, BudgetReached, WentBackToStage, NoRetriesLeft, DefinitionOfDoneNotMet, GateReached, GateContinued, SentBackFromGate, GateDropped, PipelineCompleted
- `domain/stage-template-events.ts`: StageTemplateAdded, StageTemplateSaved, StageTemplateRemoved
- `domain/task-stages-events.ts`: TaskStagesMade, TaskStagesEdited, TaskStagesReset

## HTTP routes (under `/api`)

- `POST /pipelines`: PipelineLibraryController.add
- `POST /pipelines/check`: PipelineLibraryController.check
- `PUT /pipelines/:id`: PipelineLibraryController.save
- `DELETE /pipelines/:id`: PipelineLibraryController.remove
- `GET /pipelines/:id/use`: PipelineLibraryController.use
- `GET /pipelines`: PipelinesController.list
- `GET /pipelines/:id`: PipelinesController.read
- `POST /project-pipelines`: ProjectPipelineLibraryController.add
- `POST /project-pipelines/check`: ProjectPipelineLibraryController.check
- `PUT /project-pipelines/:id`: ProjectPipelineLibraryController.save
- `DELETE /project-pipelines/:id`: ProjectPipelineLibraryController.remove
- `GET /project-pipelines/:id/use`: ProjectPipelineLibraryController.use
- `GET /project-pipelines`: ProjectPipelinesController.list
- `GET /project-pipelines/:id`: ProjectPipelinesController.read
- `POST /stage-templates`: StageTemplateLibraryController.add
- `POST /stage-templates/check`: StageTemplateLibraryController.check
- `PUT /stage-templates/:id`: StageTemplateLibraryController.save
- `DELETE /stage-templates/:id`: StageTemplateLibraryController.remove
- `GET /stage-templates`: StageTemplatesController.list
- `GET /stage-templates/:id`: StageTemplatesController.read
- `POST /tasks/:id/gate/continue`: TaskGateController.continue
- `POST /tasks/:id/gate/send-back`: TaskGateController.sendBack
- `POST /tasks/:id/gate/drop`: TaskGateController.drop
- `GET /tasks/:id/stages`: TaskStagesController.read
- `GET /tasks/:id/stage-runs/:runId/command-outputs`: TaskStagesController.commandOutputs
- `PUT /tasks/:id/stages`: TaskStagesController.edit
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
- `pipelines-application.fixtures.ts`: PipelinesApplication, startPipelinesApplication, walkStages, runsOf, anAgentStage, aTurn, anAgentSession, AN_INTERRUPTED_SESSION, aDoneResult, A_WAITING_RESULT, anAskedDecision, asksOnce, answerAsked, answerLastDecision
- `pipelines.module.ts`: PipelinesModuleOptions, PipelinesModule
- `project-pipelines.fixtures.ts`: projectPipelinesForTests
- `publish-stage.fixtures.ts`: implement, publish, reviewedPublish, PULL_REQUEST
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
- `pipeline-library-refusals.filter.ts`: PipelineLibraryRefusalsFilter
- `pipeline-library.controller.fixtures.ts`: anEdit
- `pipeline-library.controller.ts`: PipelineLibraryController
- `pipeline-responses.ts`: toPipelineResponse, toOfficeWidePipelineResponse, toPipelineUseResponse, toProjectPipelineResponse, toBuiltStagesResponse, toProjectPipelineBreakResponse, toStageTemplateResponse, toStageProblemResponse, toTaskStagesResponse
- `pipelines.controller.ts`: PipelinesController
- `project-pipeline-library.controller.fixtures.ts`: LINUX_CHECK, aNewProjectPipeline, projectPipelineRequests
- `project-pipeline-library.controller.ts`: ProjectPipelineLibraryController
- `project-pipelines.controller.ts`: ProjectPipelinesController
- `stage-template-library.controller.ts`: StageTemplateLibraryController
- `stage-templates.controller.fixtures.ts`: aStage, refusal
- `stage-templates.controller.ts`: StageTemplatesController
- `stages-edit-refusals.filter.ts`: StagesEditRefusalsFilter
- `task-gate.controller.ts`: TaskGateController
- `task-stages.controller.fixtures.ts`: tests
- `task-stages.controller.ts`: TaskStagesController
- Tests: pipeline-library.controller.full.test.ts, pipeline-library.controller.test.ts, pipelines.controller.test.ts, project-pipeline-library.controller.full.test.ts, project-pipeline-library.controller.test.ts, stage-templates.controller.full.test.ts, stage-templates.controller.test.ts, task-gate.controller.test.ts, task-stages.controller.full.test.ts, task-stages.controller.test.ts

### adapters/office-tools/

- `pipeline-office-tools.ts`: PipelineOfficeTools
- Tests: stage-history-office-tool.full.test.ts

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
- Tests: postgres-project-pipeline-repository.test.ts, set-up-brief-migration.test.ts, stage-duties-migration.test.ts

### adapters/websocket/

- `pipelines-web-events.ts`: PipelinesWebEvents
- Tests: pipelines-web-events.full.test.ts

### application/

- `agent-stage-runner.ts`: AGENT_STAGE_OFFICE_TOOLS, AgentStageRunner
- `alarm-resumes.ts`: AlarmResumes
- `dropped-publishing-tasks.ts`: DroppedPublishingTasks
- `gate-service.ts`: GateService
- `gate-stage-runner.ts`: GateStageRunner
- `initiative-branch-stages.ts`: InitiativeBranchStages
- `pipeline-library-editor.ts`: PipelineCheck, OfficeWidePipelineCheck, ProjectPipelineCheck, ProjectPipelineBreak, PipelineLibraryEditor
- `pipeline-library.ts`: PipelineCommands, ReadPipeline, PipelineForTask, BuiltOnBy, PipelineLibrary
- `publish-stage.ts`: PublishStage
- `resolve-stage-git.ts`: ResolveBegun, ResolveStageGit
- `role-fillings.ts`: RoleFillings
- `roles-named-in-stages.ts`: RolesNamedInStages
- `script-stage-runner.fixtures.ts`: aScriptStage, tests, passing, failing
- `script-stage-runner.ts`: ScriptStageRunner
- `staffing-holds.ts`: StaffingHolds
- `stage-branch-update.ts`: StageBranchUpdateAnswer, StageBranchUpdate
- `stage-command-runs.ts`: StageCommandRuns
- `stage-git.ts`: StageStart, StageGit
- `stage-history.ts`: StageHistory
- `stage-interpreter.ts`: StageInterpreter
- `stage-project-commands.ts`: StageProjectCommands
- `stage-result-words.ts`: HandoverNoteWords, StageResultWords
- `stage-run-environment-definitions.ts`: StageRunEnvironmentDefinitions
- `stage-run-interruption.ts`: StageRunInterruption
- `stage-run-waits.ts`: StageRunWaits
- `stage-runner.ts`: StageOfKind, StageWork, StageRunner
- `stage-runners.ts`: StageRunners
- `stage-template-library-editor.ts`: StageTemplateLibraryEditor
- `stage-template-library.ts`: StageTemplateLibrary
- `task-gate-runs.ts`: TaskGateRuns
- `task-stages-service.fixtures.ts`: builtIn, quickFix, withGate, refusalOf
- `task-stages-service.ts`: TaskStagesService
- `usage-history.ts`: UsageHistory
- Tests: agent-stage-runner-usage-window.test.ts, agent-stage-runner.full.test.ts, agent-stage-runner.test.ts, duty-stages.full.test.ts, gate-publish-test-project-check.test.ts, parallel-work-test-project-check.test.ts, pipeline-library.test.ts, publish-stage-lines.test.ts, publish-stage.full.test.ts, publish-stage.test.ts, publishing-task-stages.test.ts, roles-named-in-stages.full.test.ts, running-task-test-project-check.test.ts, script-stage-runner.full.test.ts, script-stage-runner.test.ts, staffing-holds.full.test.ts, stage-branch-update.full.test.ts, stage-editor-test-project-check.test.ts, stage-interpreter-alarm.full.test.ts, stage-interpreter-alarm.test.ts, stage-interpreter-decisions.full.test.ts, stage-interpreter-decisions.test.ts, stage-interpreter-edited.full.test.ts, stage-interpreter-gates.test.ts, stage-interpreter-restart.full.test.ts, stage-interpreter-restart.test.ts, stage-interpreter-stop.full.test.ts, stage-interpreter-stop.test.ts, stage-interpreter-telemetry.full.test.ts, stage-interpreter-test-project-check.test.ts, stage-interpreter.test.ts, stage-project-commands.full.test.ts, stage-project-commands.test.ts, stage-result-words.full.test.ts, stage-run-environment-definitions.test.ts, stage-run-interruption.full.test.ts, stage-run-interruption.test.ts, stage-template-library.test.ts, task-stages-service.full.test.ts, task-stages-service.test.ts, usage-estimates-test-project-check.test.ts, usage-history.full.test.ts

### domain/

- `agent-command.ts`: AgentCommand, agentCommandOf, AgentCommandEnd, agentCommandAnswer
- `agent-stage-brief.ts`: AGENT_STAGE_INSTRUCTIONS, BriefCommitMessage, RecheckedCommitMessage, BriefTask, EarlierResult, AgentStageRecord, agentStageRecord, AnsweredQuestion, CarriedRound, StageWorkReasons, StagePipeline, HeldRun, agentStageWork, isLastAgentStageBeforePublish, stageResultWords, earlierResults
- `alarm-resume.ts`: ResumeKind, TaskResume, WalkAhead, SessionAhead, walkAhead, taskResumeOf
- `allowed-commands.ts`: RunPermission, CommandPermission, NamedCommand, AllowedCommands, stageProjectCommands, allowedCommands, commandKeyRefusal
- `base-words.ts`: TaskBases, baseWords, publishingModeWords
- `built-in-pipelines.ts`: ONBOARD_PIPELINE, SET_UP_RUN_ENVIRONMENT_PIPELINE, builtInPipelines
- `built-in-stage-templates.ts`: builtInStageTemplates
- `followed-hard-switches.ts`: FollowedHardSwitchValue, FollowedHardSwitches, hardSwitchesSection
- `gate-refused.ts`: GateRefused
- `gate.ts`: GATE_REACHED, waitingGateRun, lastActedOnGateRun, sendBackTargets, agentStageFollowsGate, gateActionProblems
- `library-pipeline.ts`: PipelineEdit, TaskOnPipeline, ProjectOnPipeline, InitiativeOnPipeline, ProjectPipelineOnPipeline, PipelineUse, pipelineEditProblems, pipelineEditFlags, proposedStagesProblems, proposedEdit, addedPipeline, savedPipeline, copiedPipeline, pipelineUse, missingCommandProblems, removalProblems
- `pipeline-library-events.ts`: PipelineAdded, PipelineSaved, PipelineRemoved
- `pipeline-library-refusals.ts`: PipelineRemovalRefused, UnknownPipeline, UnknownProjectPipeline, UnknownStageTemplate
- `pipeline-names.ts`: TakenName, pipelineNameProblems, comparableName
- `pipeline-walk.ts`: UnmetOutOfReach, WalkQuestion, NextMove, RESTARTS_ASKED_AT, nextMove, reportedMet, reportedMetIn, reportedOutOfReach, unmetStatements, addressableStatements, statementList, gateChecksDefinitionOfDone
- `pipeline.ts`: Pipeline, StageProblem, stageProblems, problemOnStage, singleStageProblems
- `project-pipeline.ts`: ProjectPipeline, ProjectPipelineEdit, ProposedProjectPipeline, BuiltProjectPipeline, PipelinesAround, BrokenProjectPipeline, builtProjectPipeline, asPipeline, builtEdit, projectPipelineEditProblems, proposedProjectPipelineProblems, addedProjectPipeline, savedProjectPipeline, brokenBy
- `publish.ts`: CommitMessage, RemoteBranch, ResolveStart, ResolveEnd, BaseTakenIn, Publication, publishedMessage, publishOutcome, shippedWork, publishedVariables, UnfinishedPublication, unfinishedPublication, publishedSummary, afterPublishingFailedOutcome, shippedOutcome, continuedOutcome
- `resolve-stages.ts`: RESOLVE_KEY, RESOLVE_TEST_KEY, RESOLVE_GATE_KEY, RESOLVE_ROUNDS, RESOLVE_TEST_COMMAND, isResolveStage, withoutResolveStages, goesToResolve, walkedStages, withResolveStages, conflictCarried, conflictCameBackTooOften, afterResolveTestFailed, resolvedByTheUser, resolveBrief
- `script-stage-outcome.ts`: scriptStageOutcome, installFailure
- `staffing-decision.ts`: STAFFING_OPTIONS, staffingHoldReason, staffingDecision
- `stage-budget.ts`: stageBudget, budgetReached, budgetOutcome, tokensWords
- `stage-change.ts`: StageFieldChanges, StageField, STAGE_FIELD_NAMES, StageChangeKind, StageChange, EditedStageChange, StageOrigin, BuiltStage, BrokenReason, BaseStages, BuiltStages, buildStages, emptyChangeIndexes, stageChangeWords
- `stage-command-run.ts`: CommandOutcome, CommandRun, MovedFiles, ScriptCommandRun, StageCommandPurpose, StageCommandRun, StageCommandRunWithOutput, Installation, installRuns, failedInstall, commandRunsOf, howItEnded
- `stage-commands.ts`: missingCommandsOnStages, commandsWords
- `stage-commit.ts`: UPDATE_BRANCH_TOOL, ConflictHandling, BranchUpdate, ExpectedHead, stageCommitMessage, headProblem, branchKept, branchUpdateWords, PublishingBranchPush, withPushWords, pushFailedWords, branchMovedWords
- `stage-history-words.ts`: STAGE_HISTORY_READ_LIMIT, stageHistoryWords, stageRunWords, stageRunThreadRoom
- `stage-interruption.ts`: CutShortBy, actsNow, discardsEdits, stopsCommands, waitsForTheTurn, outranks, interruptedOutcome, holdingUserWords, StageWorkClosing, closingOf
- `stage-permissions.ts`: HardSwitchOnCard, StagePermissions
- `stage-progress.ts`: StageState, WentBack, StageProgress, TaskProgress, stagesProgress
- `stage-result.ts`: STAGE_RESULT_SCHEMA, StageResultReading, readStageResult, screenshotsRefused, correctionMessage
- `stage-run-changes.ts`: NewStageRun, startStageRun, endStageRun
- `stage-run-events.ts`: StageRunStarted, StageRunThreadOpened, StageRunWaiting, StageRunEnded, StopHeldAsPause, StageSkipped, BudgetReached, WentBackToStage, NoRetriesLeft, DefinitionOfDoneNotMet, GateReached, GateContinued, SentBackFromGate, GateDropped, PipelineCompleted
- `stage-run.fixtures.ts`: aStageRun
- `stage-run.ts`: StageRecommendation, StageDecision, OutOfReachStatement, StageOutcome, RefusedTurn, StageInterruption, AskedInterruption, PublishedWork, BaseMoved, BudgetReached, StageSessionMove, StageTokens, NO_STAGE_TOKENS, StageRunContext, addTokens, StageOutcomeStatus, HoldingUser, CarriedFailure, GateAction, SentBack, StageDecisionKind, WalkAnswer, StageRunDecision, AgentRunDecision, WalkRunDecision, WalkDecisionKind, StageRun
- `stage-staffing.ts`: RoleFilling, RoleFillingsByWorker, fillingKey, dutyLabel, staffedStages, dutiesToStaff, staffedRole, unstaffedWords, staffingProblems, stageStaffingProblem
- `stage-template-events.ts`: StageTemplateAdded, StageTemplateSaved, StageTemplateRemoved
- `stage-template.ts`: StageTemplate, templateStage, stageTemplateProblems, proposedStageProblems, stageTemplateFlags, templateProblem, addedStageTemplate, savedStageTemplate
- `stage.fixtures.ts`: agentStage, dutyStage, scriptStage, gate
- `stage.ts`: Stage, StageKind, STAGE_KIND_NAMES, ScriptStageCommand, PUBLISH_COMMAND, isPublishStage, PublishTarget, AfterConflict, StageSession, Effort, OnFailure, AgentStage, ScriptStage, Gate, StageWorker, stageWorker, StageWorkers, agentStageWorkers, sameWorkerNamed, commandKeysOfStage, commandKeysNamedBy, NewlyNamedWorkers, newlyNamedWorkers, mergedWorkers, NO_STAGE_WORKERS, sameAsKept
- `stages-edit-refused.ts`: StagesEditRefused
- `task-stages-events.ts`: TaskStagesMade, TaskStagesEdited, TaskStagesReset
- `task-stages.fixtures.ts`: implement, tests, review, publish, stages, own, roles, ranOnce
- `task-stages.ts`: TaskStages, TaskTrace, makeTaskStages, followsPipeline, isFinished, whyStagesAreKept, TaskOfStages, rolesNamedByOpenTasks, lockedStageCount, firstStageToWork, editProblems, editTaskStages
- `test-results.ts`: TestResultState, TestResult, latestTestResults
- `usage-history.ts`: HISTORY_TASKS, StageUsage, StageUsages, PricedTokens, ModelTokens, countedTokens, latestTasksRuns, stageUsages, tokensByModel, dollarsPerToken
- `walk-decisions.fixtures.ts`: implement, tests, aRun, failed, sentBack
- `walk-decisions.ts`: DecisionAnswer, WalkDecision, walkDecision, walkAnswerOf, asksAConsultantFirst, agentDecision, AcceptedIssue, acceptedIssues
- Tests: agent-command.full.test.ts, agent-stage-brief.full.test.ts, agent-stage-brief.test.ts, allowed-commands.test.ts, built-in-pipelines.full.test.ts, built-in-stage-templates.full.test.ts, followed-hard-switches.full.test.ts, gate.test.ts, library-pipeline.full.test.ts, pipeline-walk.test.ts, pipeline.full.test.ts, pipeline.test.ts, project-pipeline.full.test.ts, publish.full.test.ts, publish.test.ts, script-stage-outcome.full.test.ts, stage-budget.full.test.ts, stage-change.full.test.ts, stage-change.test.ts, stage-commands.test.ts, stage-commit.full.test.ts, stage-commit.test.ts, stage-history-words.full.test.ts, stage-history-words.test.ts, stage-progress.full.test.ts, stage-result.full.test.ts, stage-result.test.ts, stage-staffing.full.test.ts, stage-template.full.test.ts, task-stages.full.test.ts, task-stages.test.ts, test-results.full.test.ts, usage-history.full.test.ts, walk-decisions.full.test.ts, walk-decisions.test.ts

### ports/

- `known-people.ts`: KnownPerson, KnownPeople
- `pipeline-initiatives.ts`: PipelineInitiative, PipelineInitiatives
- `pipeline-repository.ts`: PipelineRepository
- `pipelines-ports.fixtures.ts`: RunEnvironmentDefinitionsForTests, StageRoleEnginesForTests, ProjectDefaultsForTests, PipelineInitiativesForTests, StartedTasksForTests, aTaskRecord, TaskRecordsForTests, aPerson, KnownPeopleForTests, StageThreadMessageForTests, StageThreadMessagesForTests, StageThreadsForTests, StageDecisionsForTests, TaskUsageForTests, TaskThreadSessionsForTests, TaskScreenshotsForTests, PLANNED_COMMIT, TaskGitForTests, aCommandRun, recordedRun, TaskCommandsForTests, RESOLVED_COMMIT, TaskPublishingForTests, ProposalDraftsForTests, PipelinesPortsForTestsModule
- `project-defaults.ts`: ProjectDefault, ProjectDefaults
- `project-pipeline-repository.ts`: ProjectPipelineRepository
- `proposal-drafts.ts`: ProposedPipelineChange, ProposedStageTemplateChange, ProjectPipelineFields, ProposedProjectPipelineChange, ProposedLibraryChange, ProposalDrafts
- `run-environment-definitions.ts`: RunEnvironmentDefinitionFile, RunEnvironmentDefinitionWriting, RunEnvironmentDefinitions
- `staffing-hold-repository.ts`: StaffingHoldRepository
- `stage-decisions.ts`: StageDecisionRequest, OpenedStageDecision, StageDecisions
- `stage-role-engines.ts`: NewlyNamedStageRoles, StageRoleEngines
- `stage-run-repository.ts`: StageRunThread, StageRunRepository
- `stage-template-repository.ts`: StageTemplateRepository
- `stage-thread-messages.ts`: StageRunThreadWindow, StageThreadMessages
- `stage-threads.ts`: StageSessionSettings, StageThreadRequest, StageTurn, AskedDecision, StageThread, StageSessionAhead, StageThreads
- `started-tasks.fixtures.ts`: OwnProjectsStartedTasks, ownProjectsStartedTasks
- `started-tasks.ts`: WalkTaskState, StartedTask, UsageWindowRefusal, TaskBlocker, ResumedOrDroppedBy, StartedTasks
- `task-commands.ts`: ScriptCommandKind, ScriptCommandResult, PublishingLine, CommandWait, TaskCommandOptions, AgentCommandOptions, TaskCommands
- `task-git.ts`: WorktreeHead, TaskGit
- `task-publishing.ts`: TaskPublishing
- `task-records.ts`: PublishingMode, TaskCommitMessage, TaskRecord, TaskRecords
- `task-screenshots.ts`: ScreenshotsAttaching, TaskScreenshots
- `task-stages-repository.ts`: TaskStagesRepository
- `task-thread-sessions.ts`: TaskThreadSessions
- `task-usage.ts`: TaskUsage
