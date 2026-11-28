# Run environments: module map

## Owns

- Reading and validating a worktree's Run environment definition (`.devcontainer/devcontainer.json` and its compose files; `RunEnvironments.definitionOf`, allow-lists `COMPOSE_PROPERTIES` …).
- Each Project's image (`the-office/<project>:<key>`, `imageKeyOf`, `RunEnvironmentImages`), each Task's run environment (compose project, override under `run-environments/tasks/<task id>/`), the slots (`RunEnvironmentSlots`), the idle stop, the sweeps.
- The Office-wide limits and Run environments at once (`run_environment_settings`, `serviceCpusOf`, `HostCores`).
- The Run environment routes and Set up (`ProjectRunEnvironments`, `SetUpTasks`), `RunEnvironmentDefinitions` (Pipelines' writes), `DevcontainerServices`.
- Hosted and Install on a device test instances' environments (`HostedServices`), Action runs' (`ActionRunEnvironments`), pairing environments (`PairingEnvironments`), `RunEnvironments.attach`, the device helper's files (`DeviceHelperFiles`).

## Talks to

- The container runtime's compose CLI (`ComposeCommandLine`) behind `ContainerRuntime`; `ScriptedContainerRuntime` is bound by the end-to-end service (`src/e2e.ts`) through `index.ts`.
- Projects: fills `TaskRunEnvironments`, `RunEnvironmentSetUpRegistry`, `RunEnvironmentSwitchRegistry`, `DevcontainerServices`, `TaskRunEnvironmentRunner`; the switch is saved and recorded by Projects (`ProjectSettings.change(…, by)`).
- Work: `KnownTasks`→`TaskService` for the sweep; removal on `TaskStateChanged` to done or dropped, in the background. People: `KnownPeople` for who turned it On. Busy work: `BusyWork` (`run-environment`). Bindings in [app.module.ts](../../app.module.ts).

## Traps

- The routes live here, not in Projects or Work: this module imports Work's index and Work imports Projects', so either would cycle.
- On with no valid definition ends each command `could-not-run` (`NO_VALID_DEFINITION`), never on the host. Only the set-up Task's Done turns it On.
- No variable's value is ever in a command line or script: values ride carrier names (`OFFICE_VARIABLE_<n>`) in the CLI's environment and BuildKit secrets; a Project's own names never go into the CLI's environment.
- The CLI's environment is an allow-list (`runtimeEnvironmentOf`); never pass `process.env` whole (compose would hand `DATABASE_URL` to a container). Output is masked as it streams; the scripted runtime masks too.
- Compose reads `$` in any file: values The Office writes go through `composeLiteral`; the definition refuses any interpolation; YAML merge keys are parsed as compose does.
- Everything carries `office.instance`; sweeps and removals look only at this instance's. Don't sweep by `office.managed` alone.
- The sweep runs from `office.ts`, never `onApplicationBootstrap`; `DeviceHelperFiles.copy` too. Sweeps skip what this service started.
- A running container keeps the worktree folder it mounted: `started` compares the folder's identity (runc's exit 128 would pass as the command's).
- The git folder mount is read-only, its target git's own path from Projects, never read from the `.git` file (an Agent can rewrite it). A non-root Office adds `safe.directory=*`; a root Office's script stays byte for byte.
- Mount the Stage runs' folder, never its file (bind mounts keep the inode); a running container never gains a mount (`STAGE_RUNS_NOT_MOUNTED`). The device helper's folder is made before every `up`.
- Ending `compose exec` leaves the command running: a timed-out or stopped check restarts the checks' service. `AttachedProcess.stop()` never does.
- A non-root Office hands files back after every check (`handBackScript`); rootless Docker, userns-remap and `remoteUser: node` aren't handled.
- `RunEnvironmentStarted` handlers run inside the Task's step: a handler taking the step waits for itself. Start long work in the background. `attach` bypasses `exclusively` and the slots on purpose and never resets the idle stop.
- Hosted instances, Action runs and pairing environments take no slot and aren't `BusyWork`; their resources carry no `office.task`, and each kind has its own sweep and label. `down --rmi local` for instances.
- The four compose project kinds share `ComposeProjectLifecycle`; one stuck project never stops the others.
- Readiness counts a connection only once it stays open 300 ms (the port proxy accepts regardless).
- Limits are read at a run environment's start; Run environments at once applies at once. A slot is never left held (hooks logged, never thrown).
- Running state, slots and builds are in memory; tests that want the sweep use `restartedTestbed`; idle out with `schedule.advanceBy(IDLE_STOP_MS)`.
- Only the device helper's pty mode attaches `asRoot`.
- `keepExecsRunning()` holds every exec; with commands before the entry point, hold only the entry point's.
- Runtime tests run on the real runtime when one answers (pulling `busybox:1.37.0`, `alpine:3.21`), else skip; `device-helper-runtime.test.ts` needs `npm run build:device-helper`.

## Spec

- [5.5 Git and isolation](../../../../../docs/spec/5.5-git-and-isolation.md) (Run environments, Defaults), [2.12 Test instances](../../../../../docs/spec/2.12-test-instances.md), [2.13 Connected devices](../../../../../docs/spec/2.13-connected-devices.md), [2.15 Actions](../../../../../docs/spec/2.15-actions.md)
- [docs/container-runtime.md](../../../../../docs/container-runtime.md)

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

RunEnvironments, RunEnvironmentAttachment, RunEnvironmentCommand, SlotOptions, RunEnvironmentCommandVariables, CommandVariable, CommandVariableSource, DEVICE_HELPER_ARCHITECTURES, DEVICE_HELPER_NOT_BUILT, DeviceHelperFiles, DeviceHelperArchitecture, ProjectRunEnvironments, DefinitionWriting, HostedServices, HostedService, HostedServiceStart, TestBuildEnd, TestBuildStart, TestInstallEnvironment, TestInstallStart, ActionRunEnvironments, ActionRunEnd, ActionRunEnvironmentUse, ActionRunStart, RunningActionEnvironment, PairingEnvironments, PairingEnvironment, PairingEnvironmentStart, HostedServiceReadinessOptions, RunEnvironmentDefinitions, DefinitionCommit, DefinitionFile, Reading, RunEnvironmentDefinition, RunEnvironmentCreated, RunEnvironmentImageBuilt, RunEnvironmentRemoved, RunEnvironmentStarted, RunEnvironmentStopped, RunEnvironmentRefused, DEVICE_HELPER_MOUNT, TEST_BUILD_FILES_MOUNT, CommandEntryPoint, CommandEnvironment, HostedEntryPoint, InstallVariable, TaskInWorktree, ContainerRuntime, AttachedProcess, Attachment, ComposeProject, Execution, ExecutionEnd, Removal, StreamedOutputMask, ScriptedContainerRuntime, RunEnvironmentsModule, RunEnvironmentsModuleOptions

## Domain events

- `domain/run-environment-events.ts`: RunEnvironmentCreated, RunEnvironmentStarted, RunEnvironmentStopped, RunEnvironmentRemoved, RunEnvironmentImageBuilt, RunEnvironmentSettingsChanged

## HTTP routes (under `/api`)

- `GET /projects/:id/run-environment`: ProjectRunEnvironmentsController.read
- `PUT /projects/:id/run-environment`: ProjectRunEnvironmentsController.change
- `GET /settings/run-environments`: RunEnvironmentOfficeLimitsController.read

## Tables

- `adapters/postgres/run-environment-settings.schema.ts`: run_environment_settings

## Files

### ./

- `index.fixtures.ts`: NO_MASK, ScriptedAttachedProcess, ScriptedContainerRuntime, ScriptedExecution, KnownPeopleForTests, KnownPeopleForTestsModule, restartedTestbed, runEnvironmentsTestbed, taskIn, writeFiles, RunEnvironmentsTestbed, ComposeCommandLine, REAL_RUNTIME_TEST, realRuntimeMissing, DeviceHelperSource, DEFAULT_RUN_ENVIRONMENT_OPTIONS, IDLE_STOP_MS, officeLabels
- `run-environments.module.ts`: RunEnvironmentsModuleOptions, RunEnvironmentsModule

### adapters/compose/

- `compose-command-line.fixtures.ts`: REAL_RUNTIME_TEST, realRuntimeMissing, ContainerLimits, containerLimitsOf
- `compose-command-line.ts`: ComposeCommandLine, execArguments, attachArguments, userIdsArguments, userIdsFrom, publishedPortOf, buildArguments, runtimeEnvironmentOf
- Tests: compose-arguments.test.ts, compose-command-line.test.ts, device-helper-runtime.test.ts, hosted-services-runtime.test.ts

### adapters/http/

- `project-run-environment-response.ts`: toProjectRunEnvironmentResponse
- `project-run-environments.controller.fixtures.ts`: newProjectIn, runEnvironmentOf
- `project-run-environments.controller.ts`: ProjectRunEnvironmentsController
- `run-environment-office-actions.controller.ts`: RunEnvironmentOfficeActionsController
- `run-environment-office-limits-responses.ts`: toOptions, toResponse
- `run-environment-office-limits.controller.ts`: RunEnvironmentOfficeLimitsController
- `run-environment-refusals.filter.ts`: RunEnvironmentRefusalsFilter
- Tests: project-run-environments.controller.full.test.ts, project-run-environments.controller.test.ts, run-environment-office-limits.controller.test.ts

### adapters/office-actions/

- `run-environment-office-actions.ts`: RunEnvironmentOfficeActions
- Tests: run-environment-office-actions.test.ts

### adapters/postgres/

- `postgres-run-environment-settings.ts`: PostgresRunEnvironmentSettings
- `run-environment-settings.schema.ts`: runEnvironmentSettings
- Tests: postgres-run-environment-settings.test.ts

### adapters/projects/

- `projects-devcontainer-services-registration.ts`: ProjectsDevcontainerServicesRegistration
- `projects-repository-files.ts`: ProjectsRepositoryFiles
- `projects-run-environment-switch-registration.ts`: ProjectsRunEnvironmentSwitchRegistration
- `projects-set-up-registration.ts`: ProjectsSetUpRegistration
- `projects-settings.ts`: ProjectsSettings, refusedInOurWords
- `projects-task-run-environments.ts`: ProjectsTaskRunEnvironments
- Tests: projects-task-run-environments-runtime.test.ts, projects-task-run-environments.full.test.ts, projects-task-run-environments.test.ts

### adapters/scripted/

- `scripted-container-runtime.ts`: NO_MASK, ScriptedExecution, ScriptedAttachedProcess, ScriptedContainerRuntime

### adapters/websocket/

- `run-environment-web-events.ts`: RunEnvironmentWebEvents

### adapters/work/

- `work-set-up-tasks.ts`: WorkSetUpTasks

### application/

- `action-run-environments.ts`: ActionRunStart, RunningActionEnvironment, ActionRunEnvironmentUse, ActionRunEnd, ActionRunEnvironments
- `checkout-hand-over.ts`: CheckoutToHandOver, CheckoutHandOver
- `compose-project-lifecycle.ts`: OfficeComposeProject, ComposeProjectLifecycle
- `definition-files.ts`: readDefinitionIn, readDefinitionWith, DefinitionWriting, writeDefinitionIn, imageInputsOf, ownFileIn
- `device-helper-files.ts`: DEVICE_HELPER_ARCHITECTURES, DeviceHelperArchitecture, DEVICE_HELPER_NOT_BUILT, DeviceHelperSource, DeviceHelperFiles
- `host-cores.ts`: HostCores
- `hosted-service-readiness.ts`: PortAnswers, HOSTED_READY_TIMEOUT_MS, HostedServiceReadinessOptions, HostedServiceReadiness, tcpAnswers
- `hosted-services.ts`: HostedServiceStart, TestBuildStart, TestBuildEnd, TestInstallStart, TestInstallEnvironment, HostedService, HostedServices
- `pairing-environments.ts`: PairingEnvironmentStart, PairingEnvironment, PairingEnvironments
- `project-run-environments.ts`: ProjectRunEnvironment, RunEnvironmentSetUp, ProjectRunEnvironments
- `run-environment-command-variables.ts`: CommandVariable, CommandVariableSource, RunEnvironmentCommandVariables
- `run-environment-definitions.ts`: DefinitionCommit, RunEnvironmentDefinitions
- `run-environment-folders.ts`: RunEnvironmentFolders
- `run-environment-images.ts`: RunEnvironmentImages, note
- `run-environment-office-limits.ts`: OfficeLimitsOnThisComputer, RunEnvironmentOfficeLimits
- `run-environment-slots.ts`: RunEnvironmentSlots
- `run-environments.fixtures.ts`: KnownTasksForTests, SetUpTasksForTests, RunEnvironmentsTestbed, runEnvironmentsTestbed, restartedTestbed, writeFiles, taskIn
- `run-environments.ts`: NO_VALID_DEFINITION, SlotOptions, RunEnvironmentCommand, STAGE_RUNS_NOT_MOUNTED, CommandEnd, RunEnvironments, RunEnvironmentAttachment
- `runtime-steps.ts`: RunEnvironmentAttachment, refusingOnRuntimeFailure, attachedIn
- `service-owner.ts`: ServiceOwner, serviceOwnerOf
- Tests: action-run-environments.test.ts, compose-project-lifecycle.test.ts, definition-files.test.ts, device-helper-files.test.ts, hosted-services-build.test.ts, hosted-services-install.test.ts, hosted-services.test.ts, pairing-environments.test.ts, project-run-environments.test.ts, run-environment-definitions.test.ts, run-environment-slots.full.test.ts, run-environments-attach.test.ts, run-environments.full.test.ts, run-environments.test.ts

### domain/

- `jsonc.ts`: parseJsonc
- `run-environment-definition.ts`: DEFINITION_FOLDER, DEFINITION_FILE, ServiceImage, RunEnvironmentDefinition, DevcontainerSettings, ComposeFileText, Reading, DefinitionFileText, DefinitionReading, DefinitionStatus, definitionStatusOf, definitionProblemsOf, readDevcontainer, readDefinition, DefinitionFile, definitionFilePathOf
- `run-environment-events.ts`: RunEnvironmentCreated, RunEnvironmentStarted, RunEnvironmentStopped, RunEnvironmentRemoved, RunEnvironmentImageBuilt, RunEnvironmentSettingsChanged
- `run-environment-image.ts`: KeyedFile, ImageInputs, INSTALL_FOLDER, INSTALL_INPUTS_FOLDER, imageKeyOf, imageNameOf, baseImageNameOf, installDockerfile, installSecrets
- `run-environment-refused.ts`: RunEnvironmentRefused
- `run-environment-setting-refused.ts`: RunEnvironmentSettingRefused, RunEnvironmentProjectNotFound
- `run-environment.ts`: InstallVariable, ImageSource, TaskInWorktree, CommandEnvironment, CpuLimitChoice, CpuLimit, RunEnvironmentLimits, CORES_LEFT_FOR_THE_HOST, OTHER_SERVICES_CPUS, AutomaticCpus, automaticCpusOf, serviceCpusOf, cpuLimitProblemOf, RunEnvironmentOptions, DEFAULT_RUN_ENVIRONMENT_OPTIONS, IDLE_STOP_MS, LABEL, Labels, instanceIdOf, officeLabels, taskLabels, composeProjectNameOf, composeOverrideOf, testInstanceLabels, hostedProjectNameOf, HostedRun, TEST_INSTANCE_VARIABLE, hostedOverrideOf, TestBuildRun, BUILD_CACHE_FOLDER, BUILD_CACHE_VARIABLES, BUILD_CACHE_OWNERSHIP_SCRIPT, BUILD_CACHE_FOLDERS, buildCacheVolumeOf, buildCacheLabels, buildOverrideOf, TestInstallRun, TEST_BUILD_FILES_MOUNT, installOverrideOf, actionRunLabels, actionRunProjectNameOf, ActionRunMounts, actionRunOverrideOf, pairingLabels, pairingProjectNameOf, PairingRun, pairingOverrideOf, projectVariableNameProblems, EntryPointCommand, CommandEntryPoint, HostedEntryPoint, entryPointCommandOf, entryPointScript, commandBeforeScript, DEVICE_HELPER_MOUNT, carrierOf, commandVariables, CommandScriptOptions, FileOwnerIds, ROOT_USER, HAND_BACK_TIMEOUT_MS, fileOwnerIdsOf, commandScript, handBackScript
- Tests: hosted-override.test.ts, jsonc.full.test.ts, run-environment-definition.full.test.ts, run-environment-image.full.test.ts, run-environment.full.test.ts

### ports/

- `container-runtime.ts`: ImageBuild, ComposeProject, Removal, StreamedOutputMask, Execution, Attachment, AttachedProcess, ExecutionEnd, ResourceKind, LabelledResource, LabelledImage, ContainerRuntime, ContainerRuntimeFailed
- `known-people.fixtures.ts`: KnownPeopleForTests, KnownPeopleForTestsModule
- `known-people.ts`: KnownPerson, KnownPeople
- `known-tasks.ts`: KnownTask, KnownTasks
- `project-settings.ts`: RunEnvironmentSetting, ProjectSetting, ProjectSettings
- `repository-files.ts`: RepositoryFiles
- `run-environment-settings.fixtures.ts`: RunEnvironmentSettingsForTests
- `run-environment-settings.ts`: RunEnvironmentSettings
- `set-up-tasks.ts`: SetUpTask, SetUpTasks
