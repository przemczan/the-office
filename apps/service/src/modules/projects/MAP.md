# Projects: module map

## Owns

- Projects (`projects`): path, Repository URL, mark, Icon and Logo (`project-images/`), install command and commands, install inputs, publishing mode and Publish's before/after lines, default Pipelines (and per Kind), skills use.
- Also on a Project: Project limit, Run environment setting, engine levels and own Stand-in list, feature switches (`PROJECT_FEATURE_REGISTRY`), issue settings, Delete branches once merged, Server values route.
- Test targets (`test_targets`), Actions' definitions (`actions`), setting-change records (`project_setting_changes`), environment checks (`environment_checks`).
- Pull requests (`pull_requests`, `PullRequestWatch`, `PullRequestActions`), CI runs (in memory, `CiRunWatch`), manual Workflows, issue links and write-backs (`issue_links`, `issue_write_backs`, `IssueWatch`), Set up test targets chats (`test_targets_chats`).
- The Office's own git (`ports/git.ts`, `CommandLineGit`, `GitProcess`) under per-repository locks: worktrees, base checkouts (`BaseCheckouts`), Initiative branches, clones (`RepositoryClones`), repository files, Publish and Resolve (`Publishing`, `Resolving`), branch deletion (`BranchDeletions`), detached checkouts for test instances, Action runs and pairing.
- Where commands run (`TaskCommandRunner`: host or run environment), the Project-command condition, Agents' commands (`AgentCommands`).
- Office actions in `ProjectOfficeActions` (`rerun_ci_run`, `start_workflow`, `PROJECT_SETTINGS_OFFICE_ACTIONS`, `SET_UP_RUN_ENVIRONMENT_ACTION`).

## Talks to

- Code hosts through the `CodeHost` port and `CodeHosts` (today `GitHubCodeHost` over the github module's `GitHubPullRequests`/`GitHubIssues`; a GitLab adapter would be one more entry); Office identity's `RemoteNeeds`.
- Serves Work (`ProjectService`, `TaskWorktrees`, `InitiativeBranches` as `ProjectInitiativeBranches` by `useExisting`, `ProjectsFromRepositories` as `NewProjects`, `BranchDeletions`, `PullRequestRecords`).
- Serves Pipelines (`TaskWorktrees` as `TaskGit`/`TaskCommands`/`TaskPublishing`, `ProjectService` as `ProjectDefaults`), Conversations (`BaseCheckouts`, `ProjectRecords`, `ProjectService.outputMaskOf`, `EnvironmentChecks`).
- Serves Devices (`startRunEnvironment`, `PairingDefinitionExports`), Test instances (`TestInstanceCheckouts`), Actions (`ActionRunSettings`, `ActionRunCheckouts`, `ActionWorkflows`), Activity and Notifications (watches, `needingAttention`).
- Registries others fill (Projects can't import them): `TaskBases`, `IssueTasks`, `TestTargetsSetUpTasks` (Work); `TestTargetsChatThreads`, `SessionPeople`, `RunEnvironmentSwitchRegistry` (Conversations/Run environments).
- More registries: `TaskRunEnvironments`, `RunEnvironmentSetUpRegistry`, `DevcontainerServices`, `TaskRunEnvironmentRunner` (Run environments); `ProjectDeviceLines` (Devices); `ActionLastRuns` (Actions); `EngineLevelsChecks` (People).
- Engine (`EngineModels`, `EngineReferenceLock`, `EngineReferenceMoves` via `ProjectLevelMoves`), `KnownPipelines`→`PipelineLibrary`, Skills, MCP servers, Busy work. Bindings in [app.module.ts](../../app.module.ts).

## Traps

- The module is registered once in `AppModule`, so every git change on a repository goes through the same locks; Publish runs in `git.exclusively`.
- Never run git by remote name: resolve the URL (`ls-remote --get-url`, `remote get-url --push`); identity is decided on the URL git reaches (`Git.reachedUrlOf`).
- Initiative branches are made by `Git.createRef`, moved by `Git.moveRef`, never `setRef`; `removeRef` checks the expected commit; `InitiativeBranches` never pushes.
- `TaskBases.of` throws while no lookup is registered and never falls back to the base branch; fixtures register `TaskBasesForTests`. Never call a sync `office/<task>` for a Task's branch: `branchOfTask` is async.
- Publish lands one commit (`Git.writeCommit` on the fetched base, `pushCommit`); merge mode takes a moved base in by a merge, never a rebase. "Nothing to publish" asks `Git.addsNothing`, not `contains`. HEAD is left at the `merged` Publication's `head`. A clean first merge before a conflict has moved HEAD (`conflicted.commit`, `ResolveStart.commit`).
- Publishing Task and Conflict resolution worktrees hold an existing branch (`addOnExistingBranch`); a dropped one's worktree must go. A fix Task's Publish into a branch the Publishing Task's worktree holds fast-forwards that worktree; Pipelines keeps it from running during that Task's Stage.
- A pull request row ends only through the conditional `PullRequestRepository.end`, and only who ended it publishes; never end through `save`.
- Watches (pull requests, CI runs) list every Project: tests build them over their own Projects on a fake GitHub (`pull-request-watch.fixtures.ts`, `ci-run-watch.fixtures.ts`); non-uuid Task ids use `PullRequestRepositoryForTests`.
- Secret variable values never leave the service (`shownEnvironment`, `shownTestTargets`); a Proposal carries them by name, values kept from the row. Output goes through one `OutputMask`.
- Every everyday setting change is recorded in `project_setting_changes` only by the repository saving it, in the same transaction; callers pass who, never a summary; summaries never name a value.
- `Worktrees.open` and `installOnce` lock per path under two separate `KeyedLocks` (this process only).
- A set command is never cleared (only at add may one be blank); a key never changes (Pipelines name it); `install` and `publish` are reserved. Nothing runs a blank line (`could-not-run`, `no-command`, `skipped`).
- The default Pipeline must run there: removing a command it (or a Kind default) runs is refused.
- Test handling goes by command kind, not key; a condition command runs once and leaves the work as it was.
- `CommandRun.output` is filtered, `wholeOutput` the last 64 KB; the 16 MB tail feeds both, don't shrink it.
- An install record holds where it ran (host or image key); a run environment failure is `could-not-run`, never a host run.
- An Agent's command runs as given (Pipelines judged it); on the host it runs in the Agents' Bash (`inAgentBash`), never cmd.exe.
- Limits held twice and kept equal by tests: `PROJECT_LIMIT_MAX`, `IMAGE_SIZE_LIMIT`/`IMAGE_UPLOAD_BYTES`, `TEST_TARGET_MEMORY_MEGABYTES`; contracts' `PROJECT_FEATURES` equals the registry.
- An image's bytes never change (new id per upload); keep the content route's headers (they stop an SVG's script).
- `GitProcess.output` decodes UTF-8: read pictures with `bytes`; ask `sizeOf` first (64 MB cap). `ls-tree` by a literal pathspec.
- Clones are made in a hidden folder and moved when complete; an empty repository gets one "Initial commit" before save, pushed for a clone.
- Feature switches off refuse with `FeatureSwitchedOff` (a `ProjectRefused`); a retired feature needs no migration.
- Test instances (`OFFICE_TEST_INSTANCE`) refuse pushes, pull request opens, merges and closes (`TestInstanceRefused`).
- Engine level saves hold `EngineReferenceLock` and publish after release. Old engine columns are kept unread for a rollback; Proposals and `set_by` keep shapes the release before reads.
- A release before the `reopen` write-back sends any non-comment action as a close.
- Nest's first route wins on a duplicate path: Office actions' old controller methods are gone.
- `PostgresProjectRepository.find`/`list` go through platform `readOnce`; writes through `forgettingReads`.

## Spec

- [2.1.1 Projects](../../../../../docs/spec/2.1.1-projects.md), [5.5 Git and isolation](../../../../../docs/spec/5.5-git-and-isolation.md), [2.3.4 Publish](../../../../../docs/spec/2.3.4-publish.md), [2.12 Test instances](../../../../../docs/spec/2.12-test-instances.md)
- [2.15 Actions](../../../../../docs/spec/2.15-actions.md), [2.13 Connected devices](../../../../../docs/spec/2.13-connected-devices.md), [5.4.5 Engines and cascade](../../../../../docs/spec/5.4.5-engines-and-cascade.md), [6 Permissions](../../../../../docs/spec/6-permissions-and-safety.md)
- [screens/project-page.md](../../../../../docs/spec/screens/project-page.md), [screens/pull-requests.md](../../../../../docs/spec/screens/pull-requests.md), [screens/ci-runs.md](../../../../../docs/spec/screens/ci-runs.md)

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

BaseCheckouts, BaseCheckout, BranchDeletions, CommittedFiles, InitiativeBranches, InitiativeBranchMaking, ProjectFeatures, ProjectRecords, ProjectDeviceLines, ProjectDeviceLine, ProjectDeviceLister, ProjectService, ProjectSettingChanges, ProjectSetting, ProjectSettingChange, SettingChangedBy, SettingChangeUser, PullRequestRecords, PullRequest, EngineLevelsChecks, EngineLevelsCheck, EngineLevelsSave, RunEnvironmentSetUpRegistry, RunEnvironmentSetUp, SessionPeople, SessionPeopleSource, ActedBy, ActingPerson, ActingUser, RunEnvironmentSwitchRegistry, RunEnvironmentSwitch, DevcontainerServices, DevcontainerServicesReader, TestTargets, InstallTargetLaunchSettings, RunTargetLaunchSettings, TestTargetCommandBefore, TestTargetLaunchSettings, TestTargetsChatThreads, TestTargetsChatThreadSource, TestTargetsChatThreadStart, TestTargetsChatProposal, TestTargetsChatThread, TestTargetsSetUpTasks, TestTargetsSetUpTask, TestTargetsSetUpTaskLookup, TestInstanceCheckouts, WorkstationBuild, WorkstationBuildEnd, PairingDefinitionExports, ExportedDefinition, DEFAULT_PORT_VARIABLE, EditedTestTarget, InstallTestTarget, RunTestTarget, TestTarget, TestTargetField, TestTargetSetter, EntryPoint, ProjectActions, ActionLastRuns, ActionLastRun, ActionLastRunReader, ActionRunCheckouts, ActionRunCommandEnd, ActionRunCommandLine, ActionRunTip, ActionRunVariable, WorkstationActionRun, ActionRunSettings, ActionRunProject, ProjectCommandRunSettings, ActionWorkflows, ActionCiRun, ActionWorkflowStart, CiRunStatus, CommandOutcome, ProjectEnvironment, ProjectVariable, Action, ActionField, ActionFields, ActionKind, ActionSetter, ProjectCommandActionSettings, TestTargetActionSettings, WorkflowActionSettings, ACTION_TIME_LIMIT_MINUTES, ACTION_RESERVED_VARIABLES, ActionsToPropose, ProposedAction, ProposedActions, ProposedTestTarget, ProposedTestTargetFields, ProposedTestTargets, TestTargetsToPropose, ProjectsFromRepositories, TaskRunEnvironments, CommandWait, TaskRunEnvironmentCommand, TaskInRunEnvironment, TaskRunEnvironmentRunner, RunEnvironmentInstall, FinishedCommand, OutputMask, SecretValue, TaskWorktrees, SessionWorktree, BranchCheckout, TaskBases, TaskBaseLookup, IssueTasks, IssueTaskCreator, NewIssueTask, IssueWriteBack, IssueDropReason, IssueUser, TaskBase, PublishingBranchPush, EnvironmentCheckFinished, EnvironmentCheckProgressed, EnvironmentCheckStarted, ProjectAdded, ProjectAfterPublishingCommandChanged, ProjectBeforePublishingCommandChanged, ProjectCommandAdded, ProjectCommandChanged, ProjectCommandRemoved, ProjectDefaultPipelineChanged, ProjectEngineChanged, ProjectEnvironmentChanged, ProjectImageChanged, ProjectInstallCommandChanged, ProjectInstallInputsChanged, ProjectLimitChanged, ProjectMarkChanged, ProjectPublishingModeChanged, ProjectDeleteMergedBranchesChanged, ProjectRunEnvironmentChanged, ProjectSkillUseChanged, ProjectTestTargetsChanged, ProjectActionsChanged, ProjectUseProjectSkillsChanged, ProjectFeaturesChanged, NewProject, ProjectCommand, ProjectCommandFields, ProjectCommandKind, ModelEffort, ProjectEngine, ProjectEngineDefault, ProjectEnginePerson, ProjectStandIns, RunEnvironmentAnswer, RunEnvironmentSetting, EnvironmentChecks, AwaitedEnvironmentCheckOptions, EnvironmentCheckOptions, CiRunWatch, CiRun, CiRunList, PullRequestWatch, PullRequestList, EnvironmentCheck, CiRunsChecked, PullRequestClosed, PullRequestsChecked, PullRequestMerged, PullRequestOpened, PullRequestReopened, PullRequestEndedBy, MergeMethod, ProjectNotFound, ProjectRefused, FeatureSwitchedOff, PROJECT_FEATURES, isFeatureOn, switchedOffWords, ProjectFeature, ProjectFeatureStates, ProjectFeatureSwitches, TestInstanceRefused, RefusedInTestInstance, commandEditsProblems, CommandEdit, commandEditsOfProposed, proposedCommands, CommandsToPropose, ProposedCommand, ProposedCommands, ProjectsModule

## Domain events

- `domain/ci-run-events.ts`: CiRunsChecked
- `domain/environment-check-events.ts`: EnvironmentCheckStarted, EnvironmentCheckProgressed, EnvironmentCheckFinished
- `domain/issue-link-events.ts`: IssuesImported, IssueLinkChanged
- `domain/project-events.ts`: ProjectAdded, ProjectInstallCommandChanged, ProjectBeforePublishingCommandChanged, ProjectAfterPublishingCommandChanged, ProjectCommandAdded, ProjectCommandChanged, ProjectCommandRemoved, ProjectInstallInputsChanged, ProjectEnvironmentChanged, ProjectDeleteMergedBranchesChanged, ProjectPublishingModeChanged, ProjectRunEnvironmentChanged, ProjectLimitChanged, ProjectMarkChanged, ProjectImageChanged, ProjectDefaultPipelineChanged, ProjectKindDefaultPipelineChanged, ProjectIssueSettingsChanged, ProjectFeaturesChanged, ProjectEngineChanged, ProjectUseProjectSkillsChanged, ProjectSkillUseChanged, ProjectTestTargetsChanged, ProjectActionsChanged
- `domain/pull-request-events.ts`: PullRequestOpened, PullRequestMerged, PullRequestClosed, PullRequestReopened, PullRequestsChecked, PullRequestBranchPushed
- `domain/repository-clone-events.ts`: RepositoryCloneStarted, RepositoryCloneProgressed, RepositoryCloneFinished
- `domain/test-targets-chat-events.ts`: TestTargetsChatAsked

## HTTP routes (under `/api`)

- `GET /ci-runs`: CiRunsController.list
- `POST /ci-runs/refresh`: CiRunsController.refresh
- `GET /projects/:projectId/workflows`: CiRunsController.workflows
- `GET /projects/:projectId/refs`: CiRunsController.refs
- `GET /projects/:id/environment-check`: EnvironmentChecksController.latest
- `POST /projects/:id/environment-check`: EnvironmentChecksController.start
- `GET /projects/:id/issues`: IssuesController.openIssues
- `GET /issue-links`: IssuesController.linkOf
- `GET /projects/:id/actions`: ProjectActionsController.list
- `PUT /projects/:id/actions`: ProjectActionsController.change
- `POST /projects/:id/images/:image/:palette`: ProjectImagesController.change
- `GET /projects/:id/images/:imageId/content`: ProjectImagesController.content
- `GET /projects/:id/server-values`: ProjectServerValuesController.list
- `GET /projects/:id/setting-changes`: ProjectSettingChangesController.latest
- `GET /projects/:id/test-targets`: ProjectTestTargetsController.list
- `PUT /projects/:id/test-targets`: ProjectTestTargetsController.change
- `POST /projects`: ProjectsController.add
- `GET /projects`: ProjectsController.list
- `GET /projects/:id`: ProjectsController.read
- `PUT /projects/:id/install-command`: ProjectsController.changeInstallCommand
- `POST /projects/:id/commands`: ProjectsController.addCommand
- `PUT /projects/:id/commands/:key`: ProjectsController.changeCommand
- `DELETE /projects/:id/commands/:key`: ProjectsController.removeCommand
- `PUT /projects/:id/install-inputs`: ProjectsController.changeInstallInputs
- `PUT /projects/:id/environment`: ProjectsController.changeEnvironment
- `GET /projects/:id/remote-needs`: ProjectsController.remoteNeeds
- `GET /projects/:id/skills`: ProjectsController.skills
- `GET /pull-requests`: PullRequestsController.list
- `POST /pull-requests/refresh`: PullRequestsController.refresh
- `GET /pull-requests/:id/merge-methods`: PullRequestsController.mergeMethods
- `POST /pull-requests/:id/merge`: PullRequestsController.merge
- `POST /repositories/clones`: RepositoryClonesController.start
- `GET /repositories/clones/:id`: RepositoryClonesController.read
- `GET /projects/:id/branches`: RepositoryFilesController.branches
- `GET /projects/:id/commits/:commit/folder`: RepositoryFilesController.folder
- `GET /projects/:id/commits/:commit/file`: RepositoryFilesController.file
- `GET /projects/:id/commits/:commit/file-preview`: RepositoryFilesController.preview
- `GET /projects/:id/tasks/:taskId/changes`: TaskChangesController.read
- `GET /projects/:id/test-targets/chat`: TestTargetsChatsController.read
- `POST /projects/:id/test-targets/chat`: TestTargetsChatsController.ask

## Tables

- `adapters/postgres/actions.schema.ts`: actions
- `adapters/postgres/environment-checks.schema.ts`: environment_checks
- `adapters/postgres/issue-links.schema.ts`: issue_links, issue_write_backs
- `adapters/postgres/project-setting-changes.schema.ts`: project_setting_changes
- `adapters/postgres/projects.schema.ts`: projects
- `adapters/postgres/pull-requests.schema.ts`: pull_requests
- `adapters/postgres/test-targets-chats.schema.ts`: test_targets_chats
- `adapters/postgres/test-targets.schema.ts`: test_targets

## Files

### ./

- `ci-run-watch.fixtures.ts`: CiRunTestbed, REPOSITORY
- `index.fixtures.ts`: createTemporaryRepository, gitIn, REAL_GIT_TEST, TemporaryRepository
- `projects.controller.fixtures.ts`: startProjectsApplication, projectsHttp
- `projects.module.ts`: ProjectsModuleOptions, ProjectsModule
- `pull-request-watch.fixtures.ts`: REPOSITORY, OwnProjects, SignedInGitHub, PullRequestWatchTestbed
- `worktrees.fixtures.ts`: COUNTING_INSTALL, worktreesOnATemporaryRepository

### adapters/git/

- `command-line-git.fixtures.ts`: serviceVariables, WorktreeMaker, exists, movedMainMaker
- `command-line-git.ts`: CommandLineGit
- `git-branch-tip.ts`: readBranchTip
- `git-clone.ts`: remoteBranchesOf, reachedUrlOf, cloneRepository, progressOf
- `git-commit-tree.ts`: commitTreeOf
- `git-process.ts`: GitCall, GitResult, GitProcess
- `publishing-testbed.fixtures.ts`: PUBLISHING_TEST, commitMessage, CodeHostForTests, PublishingTestbed
- `repository-locks.ts`: RepositoryLocks
- `temporary-repository.fixtures.ts`: REAL_GIT_TEST, TemporaryRepository, createTemporaryRepository, gitIn, commitOnOrigin
- Tests: command-line-git-branches.full.test.ts, command-line-git-branches.test.ts, command-line-git-identity.test.ts, command-line-git-locks.test.ts, command-line-git-merges.full.test.ts, command-line-git-merges.test.ts, command-line-git-worktrees.full.test.ts, command-line-git-worktrees.test.ts, repository-locks.test.ts

### adapters/github/

- `github-code-host.ts`: GitHubCodeHost
- Tests: github-code-host.test.ts

### adapters/http/

- `acted-by-responses.ts`: toAuthorResponse
- `ci-runs.controller.ts`: CiRunsController
- `environment-checks.controller.fixtures.ts`: PASSES, FAILS, NEEDS_GREETING, SLEEPS, GREETING, states, CHECK_TIMEOUT, environmentChecksHttp
- `environment-checks.controller.ts`: EnvironmentChecksController
- `issue-responses.ts`: toOpenIssueResponse, toIssueLinkResponse
- `issues.controller.ts`: IssuesController
- `project-actions.controller.fixtures.ts`: aProjectCommandAction, aWorkflowAction
- `project-actions.controller.ts`: ProjectActionsController
- `project-images.controller.fixtures.ts`: PNG, BINARY_PNG, SVG_WITH_A_SCRIPT, commitImages, anImagesRepository, projectImagesHttp
- `project-images.controller.ts`: ProjectImagesController
- `project-office-actions.controller.ts`: ProjectOfficeActionsController
- `project-refusals.filter.ts`: ProjectRefusalsFilter
- `project-responses.ts`: toProjectResponse, toEnvironmentResponse
- `project-server-values-responses.ts`: toProjectMcpServerValuesResponse
- `project-server-values.controller.ts`: ProjectServerValuesController
- `project-setting-changes.controller.ts`: ProjectSettingChangesController
- `project-test-targets.controller.fixtures.ts`: commitEntryPoints, commitGradleWrapper, aHostedTarget, anInstallOnADeviceTarget, aBuildToInstallTarget
- `project-test-targets.controller.ts`: ProjectTestTargetsController
- `projects.controller.ts`: ProjectsController
- `pull-request-refusals.filter.ts`: PullRequestRefusalsFilter
- `pull-requests.controller.ts`: PullRequestsController
- `repository-clones.controller.fixtures.ts`: HOST, UNANSWERED, aClonesRepository, repositoryClonesHttp
- `repository-clones.controller.ts`: RepositoryClonesController
- `repository-files.controller.ts`: RepositoryFilesController
- `setting-changed-by.ts`: byUser
- `task-changes.controller.ts`: TaskChangesController
- `test-targets-chats.controller.ts`: TestTargetsChatsController
- Tests: ci-runs.controller.test.ts, environment-checks.controller.full.test.ts, environment-checks.controller.test.ts, issues.controller.test.ts, project-actions.controller.test.ts, project-features.controller.test.ts, project-images.controller.full.test.ts, project-images.controller.test.ts, project-setting-changes.controller.test.ts, project-test-targets.controller.full.test.ts, project-test-targets.controller.test.ts, projects.controller.full.test.ts, projects.controller.test.ts, pull-requests.controller.test.ts, repository-clones.controller.full.test.ts, repository-clones.controller.test.ts, repository-files.controller.full.test.ts, repository-files.controller.test.ts, test-targets-chats.controller.test.ts

### adapters/office-actions/

- `project-office-actions.ts`: ProjectOfficeActions
- Tests: project-office-actions.test.ts, project-settings-office-actions.test.ts

### adapters/office-tools/

- `project-office-tools.ts`: LIST_PROJECTS, READ_REPOSITORY, ProjectOfficeTools
- Tests: project-office-tools.full.test.ts

### adapters/postgres/

- `actions.schema.ts`: actions
- `environment-checks.schema.ts`: environmentChecks
- `issue-links.schema.ts`: issueLinks, issueWriteBacks
- `postgres-action-repository.ts`: PostgresActionRepository
- `postgres-environment-check-repository.ts`: PostgresEnvironmentCheckRepository
- `postgres-issue-link-repository.ts`: PostgresIssueLinkRepository
- `postgres-project-repository.ts`: PostgresProjectRepository
- `postgres-project-setting-change-repository.ts`: PostgresProjectSettingChangeRepository, recordSettingChange
- `postgres-pull-request-repository.ts`: PostgresPullRequestRepository
- `postgres-test-target-repository.ts`: PostgresTestTargetRepository
- `postgres-test-targets-chat-repository.ts`: PostgresTestTargetsChatRepository
- `project-setting-changes.schema.ts`: projectSettingChanges
- `projects.schema.ts`: EarlierProjectRoleOverride, StoredProjectCommand, projects
- `pull-requests.schema.ts`: pullRequests
- `stored-action.ts`: StoredActionSettings, StoredAction, storedAction, actionOfStored
- `stored-environment.ts`: StoredEnvironment, environmentOfStored
- `stored-test-target.ts`: StoredTestTargetSettings, StoredTestTarget, storedTestTarget, testTargetOfStored
- `test-targets-chats.schema.ts`: testTargetsChats
- `test-targets.schema.ts`: testTargets
- Tests: actions-migration.test.ts, postgres-action-repository.test.ts, postgres-issue-link-repository.test.ts, postgres-project-repository.full.test.ts, postgres-project-repository.test.ts, postgres-pull-request-repository.test.ts, postgres-test-target-repository.test.ts, project-commands-migration.test.ts, project-engine-migration.test.ts, project-features-migration.test.ts, project-image-versions-migration.test.ts, run-environment-migration.test.ts

### adapters/shell/

- `shell-command-runner.fixtures.ts`: aCommandsFolder
- `shell-command-runner.ts`: ShellCommandRunner
- Tests: shell-command-runner.full.test.ts, shell-command-runner.test.ts

### adapters/websocket/

- `ci-run-web-events.ts`: CiRunWebEvents
- `issue-web-events.ts`: IssueWebEvents
- `project-web-events.ts`: ProjectWebEvents
- `pull-request-web-events.ts`: PullRequestWebEvents

### application/

- `action-last-runs.ts`: ActionLastRun, ActionLastRunReader, ActionLastRuns
- `action-run-checkouts.ts`: ActionRunTip, ActionRunCommandLine, ActionRunVariable, WorkstationActionRun, ActionRunCommandEnd, ActionRunCheckouts
- `action-run-settings.ts`: ActionRunProject, ProjectCommandRunSettings, ActionRunSettings
- `action-workflows.ts`: ActionWorkflowStart, ActionCiRun, ActionWorkflows
- `agent-commands.ts`: AgentCommand, AgentCommandOptions, AgentCommandEnd, AgentCommands
- `base-checkouts.ts`: BaseCheckout, InitiativeBranchReads, BaseCheckouts
- `branch-deletions.ts`: BranchDeletions
- `branch-updates.ts`: BranchUpdates
- `ci-run-watch.ts`: CI_RUN_WATCH, CI_RUN_WATCH_EVERY, IDLE_CI_RUNS_EVERY, CI_REFRESH_AT_MOST_EVERY, EXPECTED_RUN_WITHIN, CI_RUNS_LISTED, CiRunProblem, CiRun, CiRunListing, CiRunList, ProjectOnHost, CiRunWatch
- `code-hosts.ts`: CodeHosts
- `command-environment.ts`: commandEnvironment
- `committed-files.ts`: CommittedFiles
- `detached-checkouts.ts`: DetachedCheckouts, branchRefusal
- `devcontainer-services.ts`: DevcontainerServicesReader, DevcontainerServices
- `engine-levels-checks.ts`: EngineLevelsSave, EngineLevelsCheck, EngineLevelsChecks
- `environment-checks.ts`: EnvironmentCheckOptions, AwaitedEnvironmentCheckOptions, EnvironmentChecks
- `first-commits.ts`: FIRST_COMMIT_MESSAGE, FirstCommits
- `initiative-branches.ts`: InitiativeBranchMaking, InitiativeBranchRemoval, InitiativeBranches
- `issue-fixes.ts`: IssueFixes
- `issue-import.ts`: OPEN_ISSUES_LISTED, MOST_IMPORTED_AT_ONCE, OpenIssue, IssueImportResult, IssueLinkRecord, IssueImport
- `issue-tasks.ts`: NewIssueTask, IssueTaskCreator, InitiativeTasksLookup, IssueTasks
- `issue-watch.ts`: ISSUE_WATCH, ISSUE_WATCH_EVERY, IssueWatch
- `issue-write-back.ts`: IssueWriteBack
- `issue-write-backs.ts`: WRITE_BACK_RETRIED_FOR, IssueWriteBacks
- `local-repositories.ts`: LocalRepository, LocalRepositories
- `manual-workflows.ts`: ManualWorkflowList, RefList, ManualWorkflows
- `pairing-definition-exports.ts`: ExportedDefinition, PairingDefinitionExports
- `project-actions.ts`: ProjectActions
- `project-checks.ts`: ProjectChecks
- `project-command-runner.ts`: ProjectCommand, ProjectCommandRunner, commandRunOf
- `project-device-lines.ts`: ProjectDeviceLine, ProjectDeviceLister, ProjectDeviceLines
- `project-features.ts`: ProjectFeatures, ensureFeatureOn
- `project-images.ts`: RepositoryImageFile, OpenedProjectImage, ProjectImages
- `project-issue-hosts.ts`: ProjectIssueHost, ProjectIssueHosts
- `project-level-moves.ts`: ProjectLevelMoves
- `project-records.ts`: ProjectRecords
- `project-remotes.ts`: ProjectRemotes
- `project-service.ts`: RunEnvironmentAnswered, ProjectService
- `project-setting-changes.ts`: ProjectSettingChanges
- `projects-from-repositories.ts`: ProjectsFromRepositories
- `publishing.ts`: Publishing
- `pull-request-actions.ts`: MergeMethodsOffer, PullRequestActions
- `pull-request-records.ts`: PullRequestNeedingAttention, PullRequestRecords
- `pull-request-watch.ts`: PULL_REQUEST_WATCH, PULL_REQUEST_WATCH_EVERY, REFRESH_AT_MOST_EVERY, PullRequestProblem, PullRequestList, PullRequestWatch
- `repositories-by-url.ts`: RepositoryByUrl, RepositoriesByUrl
- `repository-clones.ts`: NO_DEFAULT_BRANCH, RepositoryClones
- `repository-files.ts`: FOLDER_ENTRIES_LIMIT, BaseBranchCommit, RepositoryFolder, FileSizeLimit, RepositoryBranches, FilePreview, FileDownload, RepositoryFiles
- `repository-folder.ts`: FolderEntry, ManifestFile, RepositoryFolder, MANIFEST_CHARACTERS, isManifest, manifestOf, byName
- `repository-url.ts`: RepositoryUrl, RepositoryUrlReading, readRepositoryUrl, cloneFolderOf, clonePathOf
- `resolving.ts`: Resolving
- `run-environment-set-up-registry.ts`: RunEnvironmentSetUp, RunEnvironmentSetUpRegistry
- `run-environment-switch-registry.ts`: RunEnvironmentSwitch, RunEnvironmentSwitchRegistry
- `screenshots-folder.ts`: SCREENSHOTS_FOLDER, ensureScreenshotsFolder, keepingScreenshots
- `script-commands.ts`: MovedFiles, ScriptCommandRun, STAGE_RUNS_FILE_VARIABLE, ScriptCommandOptions, ScriptCommands
- `session-people.ts`: SessionPeople
- `task-bases.fixtures.ts`: TaskBasesForTests
- `task-bases.ts`: TaskBaseLookup, TaskBases
- `task-command-runner.fixtures.ts`: taskCommandsOver
- `task-command-runner.ts`: CommandPlace, TaskCommand, TaskCommandRunner
- `task-run-environments.fixtures.ts`: ScriptedTaskRunEnvironments
- `task-run-environments.ts`: RunEnvironmentInstall, runEnvironmentInstallOf, TaskInRunEnvironment, CommandWait, TaskRunEnvironmentCommand, TaskRunEnvironmentRunner, TaskRunEnvironments
- `task-worktrees.ts`: ScriptCommandResult, SessionWorktree, TaskWorktrees
- `test-instance-checkouts.ts`: WorkstationBuild, WorkstationBuildEnd, TestInstanceCheckouts
- `test-targets-chat-threads.ts`: TestTargetsChatThreadStart, TestTargetsChatThreadSource, TestTargetsChatThreads
- `test-targets-chats.ts`: FollowedTestTargetsChat, ProjectTestTargetsChat, TestTargetsChats
- `test-targets-set-up-tasks.ts`: TestTargetsSetUpTask, TestTargetsSetUpTaskLookup, TestTargetsSetUpTasks
- `test-targets.ts`: TestTargetLaunchSettings, RunTargetLaunchSettings, InstallTargetLaunchSettings, TestTargetCommandBefore, TestTargets, runnableCommandsOf
- `workflow-starts.ts`: WorkflowStarted, WorkflowStarts
- `worktrees.ts`: BaseBranch, TaskWorktree, BranchCheckout, InstallOptions, TaskInstallOptions, Installation, TaskChanges, ThrowawayWorktree, Worktrees
- Tests: action-run-checkouts.test.ts, action-run-settings.test.ts, agent-commands.full.test.ts, base-checkouts.full.test.ts, branch-deletions.test.ts, branch-updates.full.test.ts, ci-run-watch.full.test.ts, ci-run-watch.test.ts, command-environment.full.test.ts, committed-files.test.ts, environment-checks.test.ts, initiative-branches.test.ts, initiative-task-branches.full.test.ts, issues.test.ts, local-repositories.full.test.ts, pairing-definition-exports.test.ts, project-actions.test.ts, project-checks.full.test.ts, project-images.full.test.ts, project-levels-engine-removal.full.test.ts, project-records.full.test.ts, project-service-commands.test.ts, publishing-branch-only.full.test.ts, publishing-conflict-resolution.full.test.ts, publishing-conflict-resolution.test.ts, publishing-initiative-branch.test.ts, publishing-issue-fixes.test.ts, publishing-merge.full.test.ts, publishing-merge.test.ts, publishing-publishing-task.test.ts, publishing-pull-request.full.test.ts, publishing-pull-request.test.ts, publishing-test-instance.test.ts, pull-request-actions.test.ts, pull-request-watch.full.test.ts, pull-request-watch.test.ts, repositories-by-url.full.test.ts, repository-files.full.test.ts, repository-url.full.test.ts, resolving.full.test.ts, script-commands.full.test.ts, task-command-runner.test.ts, test-instance-checkouts.test.ts, worktrees.full.test.ts, worktrees.test.ts

### domain/

- `acted-by.ts`: ActingUser, ActingPerson, ActedBy, byTheUser
- `action.ts`: ACTION_KINDS, ActionKind, ACTION_KIND_NAMES, ACTION_NAME_MAX_LENGTH, ACTION_TIME_LIMIT_MINUTES, ACTION_RESERVED_VARIABLES, ACTION_FIELDS, ActionField, ProjectCommandActionSettings, TestTargetActionSettings, WorkflowActionSettings, ActionFields, ActionSetter, ActionSetBy, Action, ActionContext, actionLabel, workflowFileName, trimmedAction, markedAction, editedActions, sameSettings, sameField, changedFields, setByAfter, sameActions, removedKeys, actionProblems, reservedVariableProblems, reservedEnvironmentProblems
- `branch-deletion.ts`: BranchOwner, BranchCopy, BranchWork, BranchDeletionPreview, BranchDeletionRequest, BranchDeletion, BRANCH_WORK_SUBJECTS, DELETABLE_BRANCH_PREFIXES, sameCopies
- `branch-update.ts`: ConflictHandling, BranchUpdate
- `ci-run-events.ts`: CiRunsChecked
- `ci-run.ts`: CiRunStatus, CiRunJobs, CiRunFacts, ensureRerunnable, isGoing, taskIdOf
- `command-run.ts`: CommandOutcome, CommandRun, filteredOutput, wholeOutputOf
- `entry-point.ts`: EntryPoint, GRADLE_WRAPPER, EntryPointTree, trimmedEntryPoint, sameEntryPoint, entryPointWords, pathInRepository, entryPointShapeProblems, entryPointProblems
- `environment-check-changes.ts`: EnvironmentCheckChange, startEnvironmentCheck, checkIdOf, progressEnvironmentCheck, finishEnvironmentCheck
- `environment-check-events.ts`: EnvironmentCheckStarted, EnvironmentCheckProgressed, EnvironmentCheckFinished
- `environment-check.ts`: CheckState, CheckedCommandRun, CheckedBase, WorktreeCheck, InstallCheck, CommandCheck, Check, EnvironmentCheckState, EnvironmentCheck
- `issue-fixes.ts`: withFixes
- `issue-link-events.ts`: IssuesImported, IssueLinkChanged
- `issue-link.ts`: IssueImportedBy, IssueDropReason, ISSUE_WRITE_BACK_ACTIONS, IssueWriteBackAction, IssueLink, IssueWriteBackEntry, issueKindOf, startedComment, IssueDoneIn, doneComment, DuplicateOf, droppedComment, REOPENED_COMMENT
- `issue-settings.ts`: IssueUser, IssueSettings, DEFAULT_ISSUE_SETTINGS, IssueSettingsChange
- `kind-default-pipeline.ts`: TASK_KINDS, TaskKind, KindDefaultPipelines, NO_KIND_DEFAULT_PIPELINES, defaultPipelineFor, defaultPipelineOfKind
- `manual-workflow.ts`: WorkflowInputKind, WorkflowInput, ManualWorkflow, inputsToSend
- `merge-method.ts`: MERGE_METHODS, MergeMethod, RecommendedMergeMethod, recommendedMergeMethod
- `output-mask.ts`: SecretValue, MaskedChunks, OutputMask
- `pipeline-commands.ts`: PipelineCommands, defaultPipelineOwnerProblems, missingPipelineCommandsProblems, namedByDefaultPipelineProblems
- `project-changes.ts`: ProjectChange, ProjectChanges, asProjectChanges, CommandEdit, removedKeysOf, changeCommandsBy, commandEditsProblems, moveEngineLevels, addProject, changeInstallCommand, changePublishingLine, addCommand, changeCommand, removeCommand, changeInstallInputs, changeEnvironment, changeDeleteMergedBranches, changePublishingMode, changeRunEnvironment, finishRunEnvironmentSetUp, changeProjectLimit, changeMark, changeImage, changeDefaultPipeline, changeKindDefaultPipeline, changeIssueSettings, changeFeatures, changeProjectEngine, changeUseProjectSkills, changeProjectSkillUse
- `project-engine.ts`: ProjectEngineChange, projectEngineProblems, forceOfferedBy, sameProjectEngine, sameStandIns, sameDefault
- `project-environment.ts`: ProjectVariable, ProjectEnvironment, VariableEdit, ProjectEnvironmentEdit, ShownVariable, ShownEnvironment, UNCHANGED_ENVIRONMENT, SECRET_VALUE_MIN_LENGTH, editedEnvironment, shownEnvironment, trimmedEnvironment, environmentProblems, variableValueProblems, repeatedNameProblems, VARIABLE_NAME, variableNameProblem, sameEnvironment
- `project-events.ts`: ProjectAdded, ProjectInstallCommandChanged, ProjectBeforePublishingCommandChanged, ProjectAfterPublishingCommandChanged, ProjectCommandAdded, ProjectCommandChanged, ProjectCommandRemoved, ProjectInstallInputsChanged, ProjectEnvironmentChanged, ProjectDeleteMergedBranchesChanged, ProjectPublishingModeChanged, ProjectRunEnvironmentChanged, ProjectLimitChanged, ProjectMarkChanged, ProjectImageChanged, ProjectDefaultPipelineChanged, ProjectKindDefaultPipelineChanged, ProjectIssueSettingsChanged, ProjectFeaturesChanged, ProjectEngineChanged, ProjectUseProjectSkillsChanged, ProjectSkillUseChanged, ProjectTestTargetsChanged, ProjectActionsChanged
- `project-features.ts`: PROJECT_FEATURES, ProjectFeature, ISSUES_FEATURE, ProjectFeatureEntry, PROJECT_FEATURE_REGISTRY, StoredProjectFeature, ProjectFeatureSwitches, ProjectFeatureStates, ProjectFeatureSource, isStoredFeature, featureSwitchesOfStored, isFeatureOn, featureStatesOf, switchedOffWords, FeatureSwitchedOff, changedFeatureSwitches, sameFeatureSwitches
- `project-image.ts`: PROJECT_IMAGE_KEYS, ProjectImageKey, PROJECT_IMAGE_PALETTES, ProjectImagePalette, ProjectImageMediaType, ProjectImage, ProjectImageVersions, NO_PROJECT_IMAGE, ProjectImageNotFound
- `project-not-found.ts`: ProjectNotFound
- `project-refused.ts`: ProjectRefused
- `project-setting-change.ts`: ProjectSetting, SettingChangeUser, SettingChangedBy, ProjectSettingChange, SettingChangeToRecord
- `project.fixtures.ts`: startingCommands, aNewProject, aProject
- `project.ts`: PROJECT_COMMAND_KINDS, ProjectCommandKind, ProjectCommandFields, ProjectCommand, INSTALL_COMMAND_KEY, STARTING_COMMANDS, PUBLISHING_MODES, PublishingMode, PUBLISHING_LINES, PublishingLine, PUBLISHING_LINE_NAMES, RUN_ENVIRONMENT_SETTINGS, RunEnvironmentSetting, RunEnvironmentAnswer, NAMED_MARK_COLOURS, ProjectMarkColour, ProjectMark, Project, DEFAULT_PROJECT_LIMIT, PROJECT_LIMIT_MAX, ProjectEngineDefault, ModelEffort, ProjectEnginePerson, ProjectEngine, ProjectStandIns, NO_PROJECT_ENGINE, NewProject, trimmedNewProject, newProjectProblems, trimmedMark, markProblem, projectLimitProblem, commandOf, sameCommandFields, trimmedCommand, keyShapeProblem, commandKeyProblems, commandFieldsProblems, commandProblem, commandLineProblem, publishingLineProblem, isCommandSet, trimmedInstallInputs, installInputsProblems, projectIdFor
- `proposed-actions.ts`: ProposedAction, ProposedActions, ActionsToPropose, proposedFieldsOf, proposedActions, proposedActionsProblems, appliedActions
- `proposed-commands.ts`: ProposedValue, ProposedCommand, ProposedCommands, CommandsToPropose, proposedCommands, commandEditsOfProposed, removedCommandKeys, proposedCommandsProblems
- `proposed-test-targets.ts`: ProposedTestTargetFields, ProposedTestTarget, ProposedTestTargets, TestTargetsToPropose, proposedFieldsOf, proposedTestTargets, proposedTestTargetsProblems, appliedTargets
- `publication.ts`: CommitMessage, PublishTarget, RemoteBranch, BaseTakenIn, Publication, PublishingBranchPush, pushFailure, baseMovedError, pullRequestBlockedError, noRemoteError
- `pull-request-events.ts`: PullRequestOpened, PullRequestEndedBy, onTheCodeHost, PullRequestMerged, PullRequestClosed, PullRequestReopened, PullRequestsChecked, PullRequestBranchPushed
- `pull-request-refused.ts`: PullRequestRefused, PullRequestNotFound
- `pull-request.ts`: PullRequestState, PullRequestChecks, PullRequestMergeable, PullRequestStatus, ListedCommits, PullRequest, OpenedPullRequestFields, openedPullRequest, taskIdOfBranch, needsStatus, StatusRead, withStatus, isOpen
- `repository-clone-events.ts`: RepositoryCloneStarted, RepositoryCloneProgressed, RepositoryCloneFinished
- `repository-clone.ts`: CloneProgress, RepositoryCloneOutcome, RepositoryClone, RepositoryCloneNotFound
- `resolve.ts`: ResolveStart, ResolveEnd, mergedBase, mergeMessage
- `setting-change-summaries.ts`: SettingChangeRecording, recordOf, INSTALL_CHANGED, INSTALL_INPUTS_CHANGED, COMMANDS_CHANGED, commandAddedSummary, commandChangedSummary, commandRemovedSummary, runEnvironmentSummary, environmentSummary, testTargetsSummary, actionsSummary
- `task-base.ts`: TaskBase, FreshInitiativeBranch, FreshBase, ExistingBranchKind, ExistingBranchUnusable, InitiativeBranchUnusable, PullRequestBranchUnusable, initiativeBranchGone, initiativeBranchDiverged, initiativeBranchCheckedOut, pullRequestBranchGone, pullRequestBranchDiverged, pullRequestBranchCheckedOut, testInstanceBranchNotFound, testInstanceBranchDiverged, existingBranchUnusable
- `test-instance-refused.ts`: RefusedInTestInstance, TestInstanceRefused, refuseInTestInstance
- `test-target.ts`: TEST_TARGET_KINDS, TestTargetKind, TEST_TARGET_KIND_NAMES, TEST_TARGET_NAME_LENGTH, TEST_TARGET_FIELDS, TestTargetField, DEFAULT_PORT_VARIABLE, TEST_TARGET_MEMORY_MEGABYTES, TestTargetSetter, TestTargetSetBy, TestTargetVariable, TestTargetSecret, TestTargetFields, RunTargetFields, InstallTargetFields, TestTarget, RunTestTarget, InstallTestTarget, EditedTestTargetSecret, EditedTestTarget, ShownTestTargetSecret, ShownTestTarget, testTargetLabel, fieldsOfKind, trimmedTestTarget, editedTestTargets, shownTestTargets, secretsWithoutValue, sameField, sameSecret, changedFields, setByAfter, sameTestTargets, testTargetProblems, DeviceForTarget, installTargetProblems
- `test-targets-chat-events.ts`: TestTargetsChatAsked
- `test-targets-chat.ts`: TestTargetsChatAsker, TestTargetsChat, TestTargetsChatState, TestTargetsChatProposal, TestTargetsChatThread, TestTargetsChatStanding, testTargetsChatStanding, testTargetsChatTitle, NOBODY_ONBOARDS_PROJECTS, TEST_TARGETS_PROPOSAL_OPEN
- Tests: action.test.ts, ci-run.test.ts, command-run.full.test.ts, entry-point.full.test.ts, environment-check-changes.full.test.ts, issue-fixes.test.ts, kind-default-pipeline.test.ts, manual-workflow.test.ts, merge-method.test.ts, output-mask.test.ts, project-changes.full.test.ts, project-changes.test.ts, project-environment.full.test.ts, project-features.test.ts, project.full.test.ts, proposed-commands.full.test.ts, proposed-test-targets.full.test.ts, publication.test.ts, setting-change-summaries.full.test.ts, test-target.full.test.ts, test-targets-chat.test.ts

### ports/

- `action-repository.fixtures.ts`: InMemoryActionRepository
- `action-repository.ts`: ActionRepository
- `code-host.fixtures.ts`: IssueForTests, IssueHostForTests
- `code-host.ts`: PullRequestRequest, OpenedPullRequest, PullRequestOnHost, CiRunOnHost, MergeMethodsOnHost, MergeRequest, MergedOnHost, CodeHostRefused, CodeHostChangedSince, CodeHost, IssueListing, IssueOnHost, IssueStateOnHost, FoundIssueOnHost, RefsOnHost, WorkflowStartRequest, RunsStartedByHandQuery
- `command-runner.ts`: CommandToRun, FinishedCommand, CommandRunner
- `environment-check-repository.ts`: EnvironmentCheckRepository
- `git.ts`: FolderInspection, WorktreeCheckout, NewWorktree, Upstream, LocalBranch, Head, ChangedFile, BranchChanges, NO_BRANCH_CHANGES, MergeStart, MergeConclusion, GitVariables, RemoteBranches, CLONE_REMOTE, CloneRequest, TreeEntry, TreePathKind, BranchTip, CommitsNotIn, GIT_OUTPUT_LIMIT_BYTES, CommitTree, GitCommandFailed, Git
- `issue-link-repository.fixtures.ts`: IssueLinkRepositoryForTests
- `issue-link-repository.ts`: IssueLinkRepository
- `known-pipelines.ts`: KnownPipelines
- `project-image-files.ts`: ProjectImageFiles
- `project-repository.ts`: ProjectRepository
- `project-setting-change-repository.ts`: ProjectSettingChangeRepository
- `pull-request-repository.fixtures.ts`: PullRequestRepositoryForTests
- `pull-request-repository.ts`: PullRequestRepository
- `session-people-source.ts`: SessionPeopleSource
- `test-target-repository.ts`: TestTargetRepository
- `test-targets-chat-repository.ts`: TestTargetsChatRepository
