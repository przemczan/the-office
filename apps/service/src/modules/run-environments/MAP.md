# Run environments: module map

**Owns:** run environments (spec §5.5 "Run environments", §5.3 Defaults): reading and validating a worktree's Run environment definition (`.devcontainer/devcontainer.json`, JSONC, and the compose files it names; `RunEnvironments.definitionOf`, every problem in the UI's words for 7967e64c to show as they are); each Project's image, `the-office/<project>:<key>`, built once per key (the definition folder's files, the install command, the Install inputs' contents: `imageKeyOf`) over the definition's image or its own Dockerfile (`the-office/<project>-base:<key>`), with the install command run on a copy of the Install inputs in `/office-install`; each Task's compose project (`office-<instance>-<task>`): the Office's compose file over the repository's (`<office-data>/run-environments/tasks/<task>/office-override.yaml`: the worktree bind-mounted at its own path, the repository's shared git folder (`TaskInWorktree.repositoryGitFolder`) bind-mounted read-only at its own path unless it lies inside the worktree, the labels on every service, network and volume, the limits on every service), up at the Task's first check (`prepare`, or `run` when it isn't running), stopped after 10 idle minutes and started again at the next check, stopped and started again at the next check when the worktree folder it was started with was replaced (another device and inode at the same path, as when Publish removes the worktree and the next Stage adds it again), removed with its volumes and orphans, then by label, when the Task is Done or Dropped; a check run in the checks' service (`run`: `/bin/sh -c` in the worktree, the Project's environment applied, output appended to the caller's file as it comes, the exit code returned); Run environments at once (`RunEnvironmentSlots`: a running run environment holds a slot, first come first served, `onWaiting` told once before a wait and `onWaitOver` once it ends, however it ends, a failing hook logged, never thrown, so a taken slot is never left held; one check at a time per Task, so commands at once never pass it either; `admitWaiting` hands free slots to the waiting after a release or a raised limit, and a lowered one takes no slot away); the Office-wide limits and Run environments at once (`run_environment_settings`, the spec's defaults until Settings saves them: the CPU limit Automatic, 4096 MB, 1024 processes, 2 at once); the CPU limit (spec §5.5 Defaults, `serviceCpusOf`): Automatic gives the checks' service this computer's cores less 2, at least 1, and every other service 2, never more than the checks', the cores read once as the module is composed (`HostCores`, `os.availableParallelism()`, `RunEnvironmentsModuleOptions.hostCores` in tests), Fixed one number on every service, kept while Automatic is chosen and held to the cores at a start; no service gets `cpu_shares`; Settings › Office limits reads and changes all four as a whole (`RunEnvironmentOfficeLimits`, `GET`/`PUT /settings/run-environments`: the bounds in contracts, a fixed number from 1 to the cores, `RunEnvironmentSettingsChanged` then `admitWaiting`, `run-environment-settings.changed` to the web); the startup sweep (`sweep`, started by `office.ts`); each Project's Run environment setting and its set-up (`ProjectRunEnvironments`, `GET`/`PUT /projects/:id/run-environment`, `POST …/set-up`): the definition read at a commit (`readDefinitionWith`, `definitionStatusOf`: not found, valid, or not valid with each problem), the base branch's last commit fetched for the page, fetched now for On and Set up; On refused with the problems unless valid, Off always taken; Set up turns On at once with a valid definition, else asks Work for the Project's set-up Task; that Task's `TaskStateChanged` to Done reads the definition on its own branch tip (a Push + PR Task is Done before its pull request merges) and turns On, or keeps why it didn't.

**Talks to:** the container runtime's compose CLI (`ComposeCommandLine`, Docker Engine with Compose, `docs/container-runtime.md`) behind `ContainerRuntime`; Work's `TaskService` behind `KnownTasks` (bound in [app.module.ts](../../app.module.ts)) for the sweep, and Work's `TaskStateChanged` to `done` or `dropped` for removal, in the background since the bus waits for its handlers; counts building and running as Office-updates' `BusyWork` (`run-environment`). Callers (Pipelines' Script Stages and the environment check, the Agents' Office tool; Tasks 72807e9a and after) pass a `TaskInWorktree`: the Project's install command and Install inputs come from them. The Run environment setting goes through ports with adapters of their own, translating the other modules' refusals into `RunEnvironmentSettingRefused`: `ProjectSettings` (`adapters/projects/`, Projects' `ProjectService`, which keeps the setting), `RepositoryFiles` (Projects' `CommittedFiles`) and `SetUpTasks` (`adapters/work/`, Work's `RunEnvironmentSetUps`); [app.module.ts](../../app.module.ts) gives the module Projects and Work in `imports`. Gives Projects the Tasks' run environments (`ProjectsTaskRunEnvironments`, into Projects' `TaskRunEnvironments`): a Script Stage's install and command run by `run`, the command's output in a file of its own and the start's in another under `<office-data>/run-environments/command-outputs/` (removed after, and as the module starts), read back as the host's runner reads its output, a refusal as `could-not-run` with why, a stop while waiting as `stopped`; `imageOf` names the image by its key without building it, for Projects' install record; the Task's title comes from `KnownTasks.read`. Gives Pipelines the definition's writing for Agents (`RunEnvironmentDefinitions.write`, exported by the module, bound to Pipelines' port in [app.module.ts](../../app.module.ts)): each path checked to lie in `.devcontainer/` (`definitionFilePathOf`), the definition read with `readDefinitionWith`, the given files in place of the worktree's, and the files written only when it is valid, every problem returned otherwise; nothing built or started. Gives Projects Set up run environment for a Project added with the answer Yes (`ProjectsSetUpRegistration`, into Projects' `RunEnvironmentSetUpRegistry`), since Projects can't import this module.

**Traps:**

- A set-up Task is created by the user who asked (`SetUpTasks.add(projectId, by)`): Set up from the Project page, or the Yes to the question as the Project was added, which Projects' registry passes on (`RunEnvironmentSetUp(projectId, by)`).
- No variable's value is ever in a command line or the script (spec 5.5, "Secret variables"): `exec` gets each `set` variable by its carrier name alone (`carrierOf`, `--env OFFICE_VARIABLE_<n>`), its value in the compose CLI's environment, and the script exports it back under its own name; the install's build gets every `set` variable as a BuildKit secret by the same carrier ids (`installSecrets`). A Project's own names never go into the CLI's environment, where `PATH` or `DOCKER_HOST` would change the CLI. The output file is masked as it streams (`Execution.mask`), and the scripted runtime masks as the real one does.

- The Run environment routes live here, not in Projects or Work: this module imports Work's `index.ts` (for `TaskStateChanged`), and Work imports Projects', so neither could reach the definition's reading without an import cycle.
- Everything carries `office.instance`, a digest of the Office data directory, and the sweep and every removal look only at this instance's: the tests', the e2e service's and The Office's own share one runtime. Don't sweep by `office.managed` alone.
- The sweep runs from `office.ts`, never `onApplicationBootstrap`, so a test app never asks the runtime for anything; `remove` asks it only for a Task that has a folder or a running environment.
- Compose reads `$` in any compose file as a variable: a value The Office writes into the override goes through `composeLiteral`.
- The override is applied over the repository's files, which compose merges, so a definition setting its own limits, ports, container name, host mounts, privileges or an external network or volume is refused rather than merged (`readDefinition`); devcontainer.json's `workspaceFolder` is read but unused, as the spec mounts the worktree at its own path.
- A running container keeps the worktree folder it mounted at its start: `exec` into a worktree removed and added again fails in runc ("current working directory is outside of container mount namespace root") with exit code 128, which comes back as the command's exit code, not `ContainerRuntimeFailed`, so nothing would stop the environment. `started` compares the folder's identity instead; a stopped container mounts the path again when it starts.
- The git folder's mount (spec 5.5 Defaults, "The repository's git data in a run environment") is read-only on purpose: checks read the history, every git change is The Office's, and `git status` skips its index refresh when it can't write. Its target must be the path the worktree's `.git` file names, so it is git's own absolute path from Projects (`Git.repositoryGitFolderOf`), never realpath'd again or read from the `.git` file, which an Agent can rewrite. A repository owned by a user other than the checks' user meets git's "dubious ownership" refusal; not handled, as both are root on The Office's machine (the real-runtime test passes `safe.directory` itself).
- Ending `compose exec` leaves the command running in the container: a timed-out or stopped check restarts the checks' service.
- Running state, slots and builds in progress are in memory: the startup sweep stops every open Task's run environment so the slots start empty.
- The image sweep keeps the newest image of each Project, standing in for "the image no Project's current key uses" until a Project's current key is known here; an image a container still uses is kept by the runtime.
- The limits are read as the override is written, at a run environment's start: a change to the limits never reaches a running one, while Run environments at once applies at once. The cores are the service's own computer's: a service run in a container sees its cgroup's CPUs.
- `compose-command-line.test.ts` and `projects-task-run-environments-runtime.test.ts` run on the real runtime when one answers (pulling `busybox:1.37.0`, and `alpine:3.21` with git added at the build for the git mount's check), and are skipped with the reason otherwise.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

RunEnvironments, RunEnvironmentCommand, SlotOptions, DefinitionWriting, RunEnvironmentDefinitions, DefinitionFile, Reading, RunEnvironmentDefinition, RunEnvironmentCreated, RunEnvironmentImageBuilt, RunEnvironmentRemoved, RunEnvironmentRefused, CommandEnvironment, TaskInWorktree, ExecutionEnd, RunEnvironmentsModule, RunEnvironmentsModuleOptions

## Domain events

- `domain/run-environment-events.ts`: RunEnvironmentCreated, RunEnvironmentRemoved, RunEnvironmentImageBuilt, RunEnvironmentSettingsChanged

## HTTP routes (under `/api`)

- `GET /projects/:id/run-environment`: ProjectRunEnvironmentsController.read
- `PUT /projects/:id/run-environment`: ProjectRunEnvironmentsController.change
- `POST /projects/:id/run-environment/set-up`: ProjectRunEnvironmentsController.setUp
- `GET /settings/run-environments`: RunEnvironmentOfficeLimitsController.read
- `PUT /settings/run-environments`: RunEnvironmentOfficeLimitsController.change

## Tables

- `adapters/postgres/run-environment-settings.schema.ts`: run_environment_settings

## Files

### ./

- `index.fixtures.ts`: ScriptedContainerRuntime, ScriptedExecution
- `run-environments.module.ts`: RunEnvironmentsModuleOptions, RunEnvironmentsModule

### adapters/compose/

- `compose-command-line.fixtures.ts`: REAL_RUNTIME_TEST, realRuntimeMissing, ContainerLimits, containerLimitsOf
- `compose-command-line.ts`: ComposeCommandLine, execArguments, buildArguments
- Tests: compose-arguments.test.ts, compose-command-line.test.ts

### adapters/http/

- `project-run-environments.controller.fixtures.ts`: newProjectIn, runEnvironmentOf
- `project-run-environments.controller.ts`: ProjectRunEnvironmentsController
- `run-environment-office-limits.controller.ts`: RunEnvironmentOfficeLimitsController
- `run-environment-refusals.filter.ts`: RunEnvironmentRefusalsFilter
- Tests: project-run-environments.controller.full.test.ts, project-run-environments.controller.test.ts, run-environment-office-limits.controller.test.ts

### adapters/postgres/

- `postgres-run-environment-settings.ts`: PostgresRunEnvironmentSettings
- `run-environment-settings.schema.ts`: runEnvironmentSettings
- Tests: postgres-run-environment-settings.test.ts

### adapters/projects/

- `projects-repository-files.ts`: ProjectsRepositoryFiles
- `projects-set-up-registration.ts`: ProjectsSetUpRegistration
- `projects-settings.ts`: ProjectsSettings, refusedInOurWords
- `projects-task-run-environments.ts`: ProjectsTaskRunEnvironments
- Tests: projects-task-run-environments-runtime.test.ts, projects-task-run-environments.full.test.ts, projects-task-run-environments.test.ts

### adapters/scripted/

- `scripted-container-runtime.fixtures.ts`: NO_MASK, ScriptedExecution, ScriptedContainerRuntime

### adapters/websocket/

- `run-environment-web-events.ts`: RunEnvironmentWebEvents

### adapters/work/

- `work-set-up-tasks.ts`: WorkSetUpTasks

### application/

- `definition-files.ts`: readDefinitionIn, readDefinitionWith, DefinitionWriting, writeDefinitionIn, imageInputsOf
- `host-cores.ts`: HostCores
- `project-run-environments.ts`: ProjectRunEnvironment, ProjectRunEnvironments
- `run-environment-definitions.ts`: RunEnvironmentDefinitions
- `run-environment-folders.ts`: RunEnvironmentFolders
- `run-environment-images.ts`: RunEnvironmentImages, note
- `run-environment-office-limits.ts`: OfficeLimitsOnThisComputer, RunEnvironmentOfficeLimits
- `run-environment-slots.ts`: RunEnvironmentSlots
- `run-environments.fixtures.ts`: KnownTasksForTests, RunEnvironmentsTestbed, runEnvironmentsTestbed, writeFiles, taskIn
- `run-environments.ts`: SlotOptions, RunEnvironmentCommand, CommandEnd, RunEnvironments
- Tests: run-environment-definitions.test.ts, run-environment-slots.full.test.ts, run-environments.full.test.ts, run-environments.test.ts

### domain/

- `jsonc.ts`: parseJsonc
- `run-environment-definition.ts`: DEFINITION_FOLDER, DEFINITION_FILE, ServiceImage, RunEnvironmentDefinition, DevcontainerSettings, ComposeFileText, Reading, DefinitionFileText, DefinitionReading, DefinitionStatus, definitionStatusOf, definitionProblemsOf, readDevcontainer, readDefinition, DefinitionFile, definitionFilePathOf
- `run-environment-events.ts`: RunEnvironmentCreated, RunEnvironmentRemoved, RunEnvironmentImageBuilt, RunEnvironmentSettingsChanged
- `run-environment-image.ts`: KeyedFile, ImageInputs, INSTALL_FOLDER, INSTALL_INPUTS_FOLDER, imageKeyOf, imageNameOf, baseImageNameOf, installDockerfile, installSecrets
- `run-environment-refused.ts`: RunEnvironmentRefused
- `run-environment-setting-refused.ts`: RunEnvironmentSettingRefused, RunEnvironmentProjectNotFound
- `run-environment.ts`: InstallVariable, TaskInWorktree, CommandEnvironment, CpuLimitChoice, CpuLimit, RunEnvironmentLimits, CORES_LEFT_FOR_THE_HOST, OTHER_SERVICES_CPUS, AutomaticCpus, automaticCpusOf, serviceCpusOf, cpuLimitProblemOf, RunEnvironmentOptions, DEFAULT_RUN_ENVIRONMENT_OPTIONS, IDLE_STOP_MS, LABEL, Labels, instanceIdOf, officeLabels, taskLabels, composeProjectNameOf, composeOverrideOf, carrierOf, commandVariables, commandScript
- Tests: jsonc.full.test.ts, run-environment-definition.full.test.ts, run-environment-image.full.test.ts, run-environment.full.test.ts

### ports/

- `container-runtime.ts`: ImageBuild, ComposeProject, StreamedOutputMask, Execution, ExecutionEnd, ResourceKind, LabelledResource, LabelledImage, ContainerRuntime, ContainerRuntimeFailed
- `known-tasks.ts`: KnownTask, KnownTasks
- `project-settings.ts`: RunEnvironmentSetting, ProjectSetting, ProjectSettings
- `repository-files.ts`: RepositoryFiles
- `run-environment-settings.fixtures.ts`: RunEnvironmentSettingsForTests
- `run-environment-settings.ts`: RunEnvironmentSettings
- `set-up-tasks.ts`: AskingUser, SetUpTask, SetUpTasks
