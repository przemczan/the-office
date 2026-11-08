# Run environments: module map

**Owns:** run environments (spec §5.5 "Run environments", §5.3 Defaults): reading and validating a worktree's Run environment definition (`.devcontainer/devcontainer.json`, JSONC, and the compose files it names; `RunEnvironments.definitionOf`, every problem in the UI's words for 7967e64c to show as they are); each Project's image, `the-office/<project>:<key>`, built once per key (the definition folder's files, the install command, the Install inputs' contents: `imageKeyOf`) over the definition's image or its own Dockerfile (`the-office/<project>-base:<key>`), with the install command run on a copy of the Install inputs in `/office-install`; each Task's compose project (`office-<instance>-<task>`): the Office's compose file over the repository's (`<office-data>/run-environments/tasks/<task>/office-override.yaml`: the worktree bind-mounted at its own path, the labels on every service, network and volume, the limits on every service), up at the Task's first check (`prepare`, or `run` when it isn't running), stopped after 10 idle minutes and started again at the next check, removed with its volumes and orphans, then by label, when the Task is Done or Dropped; a check run in the checks' service (`run`: `/bin/sh -c` in the worktree, the Project's environment applied, output appended to the caller's file as it comes, the exit code returned); Run environments at once (`RunEnvironmentSlots`: a running run environment holds a slot, first come first served, `onWaiting` told once before a wait; one check at a time per Task, so commands at once never pass it either); the Office-wide limits and Run environments at once (`run_environment_settings`, the spec's defaults until Settings saves them: 2 CPUs, 4096 MB, 1024 processes, 2 at once); the startup sweep (`sweep`, started by `office.ts`); each Project's Run environment setting and its set-up (`ProjectRunEnvironments`, `GET`/`PUT /projects/:id/run-environment`, `POST …/set-up`): the definition read at a commit (`readDefinitionWith`, `definitionStatusOf`: not found, valid, or not valid with each problem), the base branch's last commit fetched for the page, fetched now for On and Set up; On refused with the problems unless valid, Off always taken; Set up turns On at once with a valid definition, else asks Work for the Project's set-up Task; that Task's `TaskStateChanged` to Done reads the definition on its own branch tip (a Push + PR Task is Done before its pull request merges) and turns On, or keeps why it didn't.

**Talks to:** the container runtime's compose CLI (`ComposeCommandLine`, Docker Engine with Compose, `docs/container-runtime.md`) behind `ContainerRuntime`; Work's `TaskService` behind `KnownTasks` (bound in [app.module.ts](../../app.module.ts)) for the sweep, and Work's `TaskStateChanged` to `done` or `dropped` for removal, in the background since the bus waits for its handlers; counts building and running as Office-updates' `BusyWork` (`run-environment`). Callers (Pipelines' Script Stages and the environment check, the Agents' Office tool; Tasks 72807e9a and after) pass a `TaskInWorktree`: the Project's install command and Install inputs come from them. The Run environment setting goes through ports with adapters of their own, translating the other modules' refusals into `RunEnvironmentSettingRefused`: `ProjectSettings` (`adapters/projects/`, Projects' `ProjectService`, which keeps the setting), `RepositoryFiles` (Projects' `CommittedFiles`) and `SetUpTasks` (`adapters/work/`, Work's `RunEnvironmentSetUps`); [app.module.ts](../../app.module.ts) gives the module Projects and Work in `imports`.

**Traps:**

- The Run environment routes live here, not in Projects or Work: this module imports Work's `index.ts` (for `TaskStateChanged`), and Work imports Projects', so neither could reach the definition's reading without an import cycle.
- Everything carries `office.instance`, a digest of the Office data directory, and the sweep and every removal look only at this instance's: the tests', the e2e service's and The Office's own share one runtime. Don't sweep by `office.managed` alone.
- The sweep runs from `office.ts`, never `onApplicationBootstrap`, so a test app never asks the runtime for anything; `remove` asks it only for a Task that has a folder or a running environment.
- Compose reads `$` in any compose file as a variable: a value The Office writes into the override goes through `composeLiteral`.
- The override is applied over the repository's files, which compose merges, so a definition setting its own limits, ports, container name, host mounts, privileges or an external network or volume is refused rather than merged (`readDefinition`); devcontainer.json's `workspaceFolder` is read but unused, as the spec mounts the worktree at its own path.
- Ending `compose exec` leaves the command running in the container: a timed-out or stopped check restarts the checks' service.
- Running state, slots and builds in progress are in memory: the startup sweep stops every open Task's run environment so the slots start empty.
- The image sweep keeps the newest image of each Project, standing in for "the image no Project's current key uses" until a Project's current key is known here; an image a container still uses is kept by the runtime.
- `compose-command-line.test.ts` runs on the real runtime when one answers (pulls `busybox:1.37.0`), and is skipped with the reason otherwise.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

RunEnvironments, RunEnvironmentCommand, SlotOptions, Reading, RunEnvironmentDefinition, RunEnvironmentCreated, RunEnvironmentImageBuilt, RunEnvironmentRemoved, RunEnvironmentRefused, CommandEnvironment, TaskInWorktree, ExecutionEnd, RunEnvironmentsModule, RunEnvironmentsModuleOptions

## Domain events

- `domain/run-environment-events.ts`: RunEnvironmentCreated, RunEnvironmentRemoved, RunEnvironmentImageBuilt

## HTTP routes (under `/api`)

- `GET /projects/:id/run-environment`: ProjectRunEnvironmentsController.read
- `PUT /projects/:id/run-environment`: ProjectRunEnvironmentsController.change
- `POST /projects/:id/run-environment/set-up`: ProjectRunEnvironmentsController.setUp

## Tables

- `adapters/postgres/run-environment-settings.schema.ts`: run_environment_settings

## Files

### ./

- `index.fixtures.ts`: ScriptedContainerRuntime, ScriptedExecution
- `run-environments.module.ts`: RunEnvironmentsModuleOptions, RunEnvironmentsModule

### adapters/compose/

- `compose-command-line.fixtures.ts`: REAL_RUNTIME_TEST, realRuntimeMissing, ContainerLimits, containerLimitsOf
- `compose-command-line.ts`: ComposeCommandLine
- Tests: compose-command-line.test.ts

### adapters/http/

- `project-run-environments.controller.ts`: ProjectRunEnvironmentsController
- `run-environment-refusals.filter.ts`: RunEnvironmentRefusalsFilter
- Tests: project-run-environments.controller.test.ts

### adapters/postgres/

- `postgres-run-environment-settings.ts`: PostgresRunEnvironmentSettings
- `run-environment-settings.schema.ts`: runEnvironmentSettings
- Tests: postgres-run-environment-settings.test.ts

### adapters/projects/

- `projects-repository-files.ts`: ProjectsRepositoryFiles
- `projects-settings.ts`: ProjectsSettings, refusedInOurWords

### adapters/scripted/

- `scripted-container-runtime.fixtures.ts`: ScriptedExecution, ScriptedContainerRuntime

### adapters/work/

- `work-set-up-tasks.ts`: WorkSetUpTasks

### application/

- `definition-files.ts`: readDefinitionIn, readDefinitionWith, imageInputsOf
- `project-run-environments.ts`: ProjectRunEnvironment, ProjectRunEnvironments
- `run-environment-folders.ts`: RunEnvironmentFolders
- `run-environment-images.ts`: RunEnvironmentImages, note
- `run-environment-slots.ts`: RunEnvironmentSlots
- `run-environments.fixtures.ts`: KnownTasksForTests, RunEnvironmentsTestbed, runEnvironmentsTestbed, writeFiles, taskIn
- `run-environments.ts`: SlotOptions, RunEnvironmentCommand, RunEnvironments
- Tests: run-environments.test.ts

### domain/

- `jsonc.ts`: parseJsonc
- `run-environment-definition.ts`: DEFINITION_FOLDER, DEFINITION_FILE, ServiceImage, RunEnvironmentDefinition, DevcontainerSettings, ComposeFileText, Reading, DefinitionFileText, DefinitionReading, DefinitionStatus, definitionStatusOf, definitionProblemsOf, readDevcontainer, readDefinition
- `run-environment-events.ts`: RunEnvironmentCreated, RunEnvironmentRemoved, RunEnvironmentImageBuilt
- `run-environment-image.ts`: KeyedFile, ImageInputs, INSTALL_FOLDER, INSTALL_INPUTS_FOLDER, imageKeyOf, imageNameOf, baseImageNameOf, installDockerfile
- `run-environment-refused.ts`: RunEnvironmentRefused
- `run-environment-setting-refused.ts`: RunEnvironmentSettingRefused, RunEnvironmentProjectNotFound
- `run-environment.ts`: TaskInWorktree, CommandEnvironment, RunEnvironmentLimits, RunEnvironmentOptions, DEFAULT_RUN_ENVIRONMENT_OPTIONS, IDLE_STOP_MS, LABEL, Labels, instanceIdOf, officeLabels, taskLabels, composeProjectNameOf, composeOverrideOf, commandScript
- Tests: jsonc.test.ts, run-environment-definition.test.ts, run-environment-image.test.ts, run-environment.test.ts

### ports/

- `container-runtime.ts`: ImageBuild, ComposeProject, Execution, ExecutionEnd, ResourceKind, LabelledResource, LabelledImage, ContainerRuntime, ContainerRuntimeFailed
- `known-tasks.ts`: KnownTask, KnownTasks
- `project-settings.ts`: RunEnvironmentSetting, ProjectSetting, ProjectSettings
- `repository-files.ts`: RepositoryFiles
- `run-environment-settings.fixtures.ts`: RunEnvironmentSettingsForTests
- `run-environment-settings.ts`: RunEnvironmentSettings
- `set-up-tasks.ts`: SetUpTask, SetUpTasks
