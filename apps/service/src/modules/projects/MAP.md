# Projects: module map

**Owns:** Projects (`projects`): path, the Repository URL of a cloned one (given only with its clone's folder as the path), commands, install inputs, publishing mode, default Pipeline, which of the repository's skills it uses ("Use this Project's skills", `PUT /projects/:id/use-project-skills`, and the keys turned off one by one, `projectSkillsOff`, `PUT /projects/:id/skill-use`; the skills themselves are never stored, so only what is off is kept and a new skill starts on), and the engine cascade's Project levels (the Project default, "Use for every Role" allowed only with one, and the Project's Role overrides, each an engine id and a model, at most one per Role key; `PUT /projects/:id/project-default`, `…/use-for-every-role`, `…/role-overrides/:roleKey`, null clearing; given to People's engine cascade by `ProjectService.engineLevelsOf`, bound to its `KnownProjectLevels` port in app.module.ts; a removed engine's levels moved by `ProjectLevelMoves`, registered in Engine's `EngineReferenceMoves` with `projectLevelMovesOf` for the removal's preview, past the checks (`moveEngineLevels`: to the replacement, or to none with the only engine, "Use for every Role" turned off before the default clears)); the environment check (`environment_checks`); The Office's own git (`ports/git.ts`, `CommandLineGit`) under per-repository locks, every command on the Office identity through `GitProcess`; which part of the identity the base branch's remote needs (`ProjectRemotes`: `GET /projects/:id/remote-needs` and the environment check's failed fetch); cloning a repository by its Repository URL into `<office-data>/repositories/<host>/<path>` before it is added (`RepositoryClones`: `POST /repositories/clones`, `GET …/:id`, in memory while the service runs, told to the web as `repository-clone.changed`); the files committed on the base branch, for the Repository file browser (`BaseBranchFiles`: `POST /projects/:id/base-branch/fetch` fetches by `Worktrees.freshBase`, a failed fetch answering the last commit known here with why; `GET …/:commit/folder` reads one folder from the Project's own objects, `Git.commitTree`, at most 1,000 entries); a worktree per Task, the base checkouts, Changes, and the git work of Publish and Resolve (`TaskWorktrees`; `Publishing`, `Resolving`).

**Talks to:** opens Push + PR's pull requests through the github module's `GitHubPullRequests` behind its `PullRequests` port (`GitHubApiPullRequests`), the github module's one instance given in `imports` by [app.module.ts](../../app.module.ts); Publish asks `whyCannotOpen` before the push, on the URL git resolves for the base's remote, and pushes nothing when the remote isn't on GitHub or no one is signed in; checks a default Pipeline through its `KnownPipelines` port, bound to Pipelines' `PipelineLibrary` in [app.module.ts](../../app.module.ts); checks that an engine level's engine is listed and offers its model through Engine's `EngineModels` (`ProjectChecks.checkEngineModel`), but not that a Role is filled under a Role override's key, since People reads these levels and Projects can't import People; refuses a save of the engine levels that a check registered in `EngineLevelsChecks` refuses (People's capability check of the Roles a Pipeline names, registered through its `ProjectLevelsSaves` port, which [app.module.ts](../../app.module.ts) binds to the registry), weighing the Project read just before the save; moves the levels naming an engine being removed to its replacement (`ProjectLevelMoves`, registered in Engine's `EngineReferenceMoves`, `moveEngineLevels` with each change's own event, past the checks, which Engine's removal ran first); calls Engine, Skills and MCP servers (the Project page's Server values, `GET`/`PUT /projects/:id/server-values`, in `ProjectServerValuesController`; the library's refusals answered as the Project's). Serves Work (`ProjectService`, `TaskWorktrees`, and `ProjectsFromRepositories` as `NewProjects`: a Proposal's Project by its folder, or by its Repository URL judged from the remote's branches with nothing cloned and, applied, cloned through `RepositoryClones.clone`, which waits, then added), Pipelines (`TaskWorktrees` as `TaskGit`, `TaskCommands` and `TaskPublishing`; `ProjectService` as `ProjectDefaults`, which the library asks before removing a Pipeline) and Conversations (`BaseCheckouts`; Devops' `read_repository` in their chat, reading a repository's local branches and the names and manifest files of its top level or one folder inside it before it is a Project (`LocalRepositories`, refusing a repository folder as adding a Project does, and a folder that leaves the repository or is git's own), or one on a host by its Repository URL: the remote's branches and the same of its default branch, read from that branch's last commit fetched alone into a bare repository in a temp folder removed after each read, nothing cloned (`RepositoriesByUrl`, `Git.readBranchTip`); and `ProjectService` for Devops' Proposals of commands and install inputs: `proposedCommandsProblems` and `changeCommandsAsProposed`; and Work's `NewProjects` for a Project to onboard: `add` and its dry run `newProjectProblems`, which applies the whole Proposal or none of it: judged against the row as it is held and saved in one update, each field still announced with its own event as the Project page announces it). Holds Engine's `EngineReferenceLock` over each save of the engine levels (`changeEngineLevels`), from reading the engines through the write, publishing after it is released, so an engine removed meanwhile is never named. Counts a running clone and environment check as Office-updates' `BusyWork`.

**Traps:**

- A `CommandRun` carries a command's output twice: `output`, filtered for an Agent to read, and `wholeOutput`, the last 64 KB for the user's Stage history. The shell runner's 16 MB tail feeds both, so `filteredOutput` sees failures long before the end; don't shrink it to the 64 KB. An environment check keeps only the first (`CheckedCommandRun`).
- The module is registered once in `AppModule`, so every git change on a repository goes through the same locks.
- A branch Resolve merged holds a merge commit: Publish in merge mode takes in a base that moved on again by another merge (`hasMergesSince`), never a rebase, which would drop the merge and bring its conflicts back.
- After Publish, Changes diffs from `refs/office/published-from/<task>` (spec [2.3 Defaults](../../../../../docs/spec/2.3-pipelines.md#defaults)), the branch-only push (a Publish Stage's `branch-only` target) included.
- A clone is made in a hidden folder beside its own and moved there when complete (`adapters/git/git-clone.ts`), so a folder found there is a whole clone, used again, with `origin` pointed at the URL given last (one folder holds every spelling and transport of a URL) and fetched, so branches made on the remote since are there. A clone, `ls-remote` and their failure reasons decide the identity on the URL git reaches (`Git.reachedUrlOf`, `insteadOf` applied): the user's config may rewrite https to ssh, or, in the tests and e2e, a made-up host to a local folder. Only the default branch exists locally after a clone: adding it as a Project accepts a base branch that is only `origin/<branch>` and makes it locally, tracking that (`ProjectService.add`); a path-added repository's base branch must already be local.
- `CommitTree.kindOf` asks `ls-tree` by a literal pathspec, since a path is someone's words: bare `:(…)` makes git fail. `readBranchTip` shares it (`adapters/git/git-commit-tree.ts`).
- A fetch or push runs on the URL git resolves for the remote name (`ls-remote --get-url`, `remote get-url --push`), never the name itself, which `parseGitRemote` would read as a local path; a remote with several URLs gets the identity of its first.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

BaseCheckouts, BaseCheckout, ProjectService, EngineLevelsChecks, EngineLevelsCheck, EngineLevelsSave, ProjectsFromRepositories, TaskWorktrees, SessionWorktree, EnvironmentCheckFinished, EnvironmentCheckProgressed, EnvironmentCheckStarted, ProjectAdded, ProjectCommandChanged, ProjectDefaultChanged, ProjectDefaultPipelineChanged, ProjectEnvironmentChanged, ProjectInstallInputsChanged, ProjectPublishingModeChanged, ProjectRoleOverrideChanged, ProjectSkillUseChanged, ProjectUseForEveryRoleChanged, ProjectUseProjectSkillsChanged, NewProject, ProjectEngineLevels, ProjectRoleOverride, ProjectNotFound, ProjectRefused, proposedCommandFields, ProjectCommandFields, ProjectsModule

## Domain events

- `domain/environment-check-events.ts`: EnvironmentCheckStarted, EnvironmentCheckProgressed, EnvironmentCheckFinished
- `domain/project-events.ts`: ProjectAdded, ProjectCommandChanged, ProjectInstallInputsChanged, ProjectEnvironmentChanged, ProjectPublishingModeChanged, ProjectDefaultPipelineChanged, ProjectDefaultChanged, ProjectUseForEveryRoleChanged, ProjectRoleOverrideChanged, ProjectUseProjectSkillsChanged, ProjectSkillUseChanged
- `domain/repository-clone-events.ts`: RepositoryCloneStarted, RepositoryCloneProgressed, RepositoryCloneFinished

## HTTP routes (under `/api`)

- `POST /projects/:id/base-branch/fetch`: BaseBranchFilesController.fetch
- `GET /projects/:id/base-branch/:commit/folder`: BaseBranchFilesController.folder
- `GET /projects/:id/environment-check`: EnvironmentChecksController.latest
- `POST /projects/:id/environment-check`: EnvironmentChecksController.start
- `GET /projects/:id/server-values`: ProjectServerValuesController.list
- `PUT /projects/:id/server-values/:serverName`: ProjectServerValuesController.change
- `POST /projects`: ProjectsController.add
- `GET /projects`: ProjectsController.list
- `GET /projects/:id`: ProjectsController.read
- `PUT /projects/:id/commands/:key`: ProjectsController.changeCommand
- `PUT /projects/:id/install-inputs`: ProjectsController.changeInstallInputs
- `PUT /projects/:id/publishing-mode`: ProjectsController.changePublishingMode
- `GET /projects/:id/remote-needs`: ProjectsController.remoteNeeds
- `GET /projects/:id/skills`: ProjectsController.skills
- `PUT /projects/:id/use-project-skills`: ProjectsController.changeUseProjectSkills
- `PUT /projects/:id/skill-use`: ProjectsController.changeProjectSkillUse
- `PUT /projects/:id/default-pipeline`: ProjectsController.changeDefaultPipeline
- `PUT /projects/:id/project-default`: ProjectsController.changeProjectDefault
- `PUT /projects/:id/use-for-every-role`: ProjectsController.changeUseForEveryRole
- `PUT /projects/:id/role-overrides/:roleKey`: ProjectsController.changeRoleOverride
- `POST /repositories/clones`: RepositoryClonesController.start
- `GET /repositories/clones/:id`: RepositoryClonesController.read
- `GET /projects/:id/tasks/:taskId/changes`: TaskChangesController.read

## Tables

- `adapters/postgres/environment-checks.schema.ts`: environment_checks
- `adapters/postgres/projects.schema.ts`: projects

## Files

### ./

- `projects.module.ts`: ProjectsModuleOptions, ProjectsModule

### adapters/git/

- `command-line-git.fixtures.ts`: serviceVariables, WorktreeMaker, exists
- `command-line-git.ts`: CommandLineGit
- `git-branch-tip.ts`: readBranchTip
- `git-clone.ts`: remoteBranchesOf, reachedUrlOf, cloneRepository, progressOf
- `git-commit-tree.ts`: commitTreeOf
- `git-process.ts`: GitCall, GitResult, GitProcess
- `publishing-testbed.fixtures.ts`: PUBLISHING_TEST, pullRequestText, PullRequestsForTests, PublishingTestbed
- `repository-locks.ts`: RepositoryLocks
- `temporary-repository.fixtures.ts`: REAL_GIT_TEST, TemporaryRepository, createTemporaryRepository, gitIn, commitOnOrigin
- Tests: command-line-git-branches.test.ts, command-line-git-identity.test.ts, command-line-git-locks.test.ts, command-line-git-merges.test.ts, command-line-git-worktrees.test.ts, repository-locks.test.ts

### adapters/github/

- `github-api-pull-requests.ts`: GitHubApiPullRequests
- Tests: github-api-pull-requests.test.ts

### adapters/http/

- `base-branch-files.controller.ts`: BaseBranchFilesController
- `environment-checks.controller.ts`: EnvironmentChecksController
- `project-refusals.filter.ts`: ProjectRefusalsFilter
- `project-server-values.controller.ts`: ProjectServerValuesController
- `projects.controller.ts`: ProjectsController
- `repository-clones.controller.ts`: RepositoryClonesController
- `task-changes.controller.ts`: TaskChangesController
- Tests: base-branch-files.controller.test.ts, environment-checks.controller.test.ts, projects.controller.test.ts, repository-clones.controller.test.ts

### adapters/office-tools/

- `project-office-tools.ts`: LIST_PROJECTS, READ_REPOSITORY, ProjectOfficeTools
- Tests: project-office-tools.test.ts

### adapters/postgres/

- `environment-checks.schema.ts`: environmentChecks
- `postgres-environment-check-repository.ts`: PostgresEnvironmentCheckRepository
- `postgres-project-repository.ts`: PostgresProjectRepository
- `projects.schema.ts`: projects
- Tests: postgres-project-repository.test.ts

### adapters/shell/

- `shell-command-runner.ts`: ShellCommandRunner
- Tests: shell-command-runner.test.ts

### adapters/websocket/

- `project-web-events.ts`: ProjectWebEvents

### application/

- `base-branch-files.ts`: FOLDER_ENTRIES_LIMIT, BaseBranchCommit, BaseBranchFolder, BaseBranchFiles
- `base-checkouts.ts`: BaseCheckout, BaseCheckouts
- `branch-updates.ts`: BranchUpdates
- `command-environment.ts`: commandEnvironment
- `engine-levels-checks.ts`: EngineLevelsSave, EngineLevelsCheck, EngineLevelsChecks
- `environment-checks.ts`: EnvironmentChecks
- `local-repositories.ts`: LocalRepository, LocalRepositories
- `project-checks.ts`: ProjectChecks
- `project-command-runner.ts`: ProjectCommand, ProjectCommandRunner
- `project-level-moves.ts`: ProjectLevelMoves
- `project-remotes.ts`: ProjectRemotes
- `project-service.ts`: ProjectService
- `projects-from-repositories.ts`: ProjectsFromRepositories
- `publishing.ts`: Publishing
- `repositories-by-url.ts`: RepositoryByUrl, RepositoriesByUrl
- `repository-clones.ts`: NO_BRANCH_YET, RepositoryClones
- `repository-folder.ts`: FolderEntry, ManifestFile, RepositoryFolder, MANIFEST_CHARACTERS, isManifest, manifestOf, byName
- `repository-url.ts`: RepositoryUrl, RepositoryUrlReading, readRepositoryUrl, cloneFolderOf, clonePathOf
- `resolving.ts`: Resolving
- `screenshots-folder.ts`: SCREENSHOTS_FOLDER, ensureScreenshotsFolder, keepingScreenshots
- `script-commands.ts`: ScriptCommandKey, MovedFiles, ScriptCommandRun, ScriptCommands
- `task-worktrees.ts`: SessionWorktree, TaskWorktrees
- `worktrees.ts`: BaseBranch, TaskWorktree, InstallOptions, Installation, TaskChanges, ThrowawayWorktree, Worktrees
- Tests: base-branch-files.test.ts, base-checkouts.test.ts, branch-updates.test.ts, command-environment.test.ts, local-repositories.test.ts, project-checks.test.ts, project-levels-engine-removal.test.ts, publishing-branch-only.test.ts, publishing-merge.test.ts, publishing-pull-request.test.ts, repositories-by-url.test.ts, repository-url.test.ts, resolving.test.ts, script-commands.test.ts, worktrees.test.ts

### domain/

- `branch-update.ts`: ConflictHandling, BranchUpdate
- `command-run.ts`: CommandOutcome, CommandRun, filteredOutput, wholeOutputOf
- `environment-check-changes.ts`: EnvironmentCheckChange, startEnvironmentCheck, progressEnvironmentCheck, finishEnvironmentCheck
- `environment-check-events.ts`: EnvironmentCheckStarted, EnvironmentCheckProgressed, EnvironmentCheckFinished
- `environment-check.ts`: CheckState, CheckedCommandRun, CheckedBase, WorktreeCheck, CommandCheck, Check, EnvironmentCheckState, EnvironmentCheck
- `project-changes.ts`: ProjectChange, ProjectChanges, asProjectChanges, changeCommandsAsProposed, moveEngineLevels, addProject, changeCommand, changeInstallInputs, changeEnvironment, changePublishingMode, changeDefaultPipeline, changeProjectDefault, changeUseForEveryRole, changeRoleOverride, changeUseProjectSkills, changeProjectSkillUse
- `project-environment.ts`: ProjectVariable, ProjectEnvironment, UNCHANGED_ENVIRONMENT, trimmedEnvironment, environmentProblems, sameEnvironment
- `project-events.ts`: ProjectAdded, ProjectCommandChanged, ProjectInstallInputsChanged, ProjectEnvironmentChanged, ProjectPublishingModeChanged, ProjectDefaultPipelineChanged, ProjectDefaultChanged, ProjectUseForEveryRoleChanged, ProjectRoleOverrideChanged, ProjectUseProjectSkillsChanged, ProjectSkillUseChanged
- `project-not-found.ts`: ProjectNotFound
- `project-refused.ts`: ProjectRefused
- `project.fixtures.ts`: aNewProject, aProject
- `project.ts`: PROJECT_COMMAND_KEYS, ProjectCommandKey, ProjectCommands, PUBLISHING_MODES, PublishingMode, PROJECT_MARK_COLOURS, ProjectMarkColour, ProjectMark, Project, ProjectEngineLevels, ProjectRoleOverride, NewProject, trimmedNewProject, newProjectProblems, commandProblem, trimmedInstallInputs, installInputsProblems, projectIdFor
- `proposed-commands.ts`: ProjectCommandFields, proposedCommandFields, proposedCommandsProblems
- `publication.ts`: PullRequestText, PublishTarget, RemoteBranch, BaseTakenIn, Publication, pushFailure, baseMovedError, pullRequestBlockedError, noRemoteError
- `repository-clone-events.ts`: RepositoryCloneStarted, RepositoryCloneProgressed, RepositoryCloneFinished
- `repository-clone.ts`: CloneProgress, RepositoryCloneOutcome, RepositoryClone, RepositoryCloneNotFound
- `resolve.ts`: ResolveStart, ResolveEnd, mergeMessage
- Tests: command-run.test.ts, environment-check-changes.test.ts, project-changes.test.ts, project-environment.test.ts, project.test.ts, proposed-commands.test.ts, publication.test.ts

### ports/

- `command-runner.ts`: CommandToRun, FinishedCommand, CommandRunner
- `environment-check-repository.ts`: EnvironmentCheckRepository
- `git.ts`: FolderInspection, WorktreeCheckout, NewWorktree, Upstream, LocalBranch, Head, ChangedFile, BranchChanges, NO_BRANCH_CHANGES, MergeStart, MergeConclusion, GitVariables, RemoteBranches, CLONE_REMOTE, CloneRequest, TreeEntry, TreePathKind, CommitTree, GitCommandFailed, Git
- `known-pipelines.ts`: KnownPipelines
- `project-repository.ts`: ProjectRepository
- `pull-requests.ts`: PullRequestRequest, PullRequest, PullRequestRefused, PullRequests
