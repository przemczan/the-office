# Actions: module map

**Owns:** Action runs (spec §2.15, §5.5 "An Action run's checkout"): running a Project's Actions, which Projects defines (`Project.actions`). `ActionRuns.start` resolves the source (a branch, a Task's `office/<id>` branch or an Initiative's branch, `ActionSources`) to its fetched tip and refuses, in `domain/action-run-words.ts`'s words (`ActionRunRefused`, every reason): Actions switched off, a test instance of The Office, the fire alarm on, the Action running already, Actions at once full (naming the runs that hold it), an Action that leaves the workstation off the base branch, without `commit` or with the branch moved since, a Workflow on a branch the remote lacks, a command Action naming a Project device with Run environment Off (`deviceNeedsRunEnvironmentOn`) or while the device is held (Devices' `checkFree` in Devices' words, "<device> is in use by <holder>.", or a run started here that names it and hasn't held it yet, `CommandRuns.runNaming`); a device gone since fails the run at its start (`deviceGone`), as a gone target does. The check and the insert run one start at a time (`oneAtATime`), behind the partial unique index `action_runs_one_running` (one running run per Project and key, `ActionRunningAlready`). A run is answered at once and goes on in the background (`RunsInBackground`): a Project command run (`CommandRuns`) on its own checkout (`<office-data>/action-runs/<run id>/`, no `.git`, made by Projects), in its own compose project through `CommandRunEnvironments` with Run environment On or on the workstation through `ActionProjects` with it Off, with the Project's environment and Secret variables plus `OFFICE_ACTION`, `OFFICE_ACTION_BRANCH` and `OFFICE_ACTION_COMMIT`, its time limit (`ranOutOfTime`) and Stop; a command run naming a Project device keeps its name (`deviceName`, `action_runs.device_name`), mounts the device helper and holds the device through `ActionDevices` in its compose project's `onEnvironment` hook before its first command (holder named `runName`, the start's `relayTab`, the environment's signal), its commands getting the hold's `OFFICE_CONNECTED_DEVICES`/`ANDROID_SERIAL`, not held Failed in Devices' words, let go of in the hook's `release` however it ends, Stop included; a hold Disconnected from outside while held (`ConnectedDeviceChanged` with the run as holder, any reason but run ended) fails the run, "<device> was let go of: <why>.", and halts it; a Test target run launched as a test instance "run as" the Action (`ActionTestInstances`), its state the instance's (`testTargetOutcomeOf`: Built and Installed succeeded, Installing running), the start's `relayTab` passed to the launch for an Install on a device target; a Workflow run (`WorkflowRuns`) Starting until the code host shows the first run by hand of the file on the branch by The Office's sign-in made after the start (`WORKFLOW_SHOW_MS`, 60 s, then Failed `didNotShow`), then following the CI run (`workflowOutcomeOf`), with no Stop. Each run's masked log (`ActionRunLogs`, `<office-data>/action-runs/<run id>.log`, kept after the checkout; a Test target run's log is its instance's), each Action's History (`list`, newest first, the newest `KEPT_RUNS` 20 kept, `keepTheNewest`), and Actions at once (`action_settings`, one row, `ActionLimits`, `GET /settings/actions`; its change is the Office action `set_action_settings`, `PUT` on the same path, carried out by `ActionSettingsOfficeActions` (`adapters/office-actions/`) for its route and its Office tool on the Engine's registry alike; Actions imports `EngineModule` for that registry). Stops from outside (`ActionRunReactions`): the fire alarm sounded ASAP, the Project's Actions switched off and an Action removed (its runs and logs removed, a running one stopped first); the startup sweep (`sweep`, from `office.ts`) stops each command run left running ("The Office restarted while it ran."), removes the compose projects and checkouts left, follows Workflow runs again and reads Test target runs' instances again.

**Talks to:** Projects through `ActionProjects` (`adapters/projects/`: the Project and its Actions, `ActionRunCheckouts` for the checkout, the tip and the workstation run, the environment and its mask) and `ActionWorkflowHost` (Projects' `ActionWorkflows`: the start with the Action's fixed inputs past the Workflow-file guard, the CI run read); it fills Projects' last-run port for `list_projects` (`ActionLastRunsRegistration`). Run environments only through `RunEnvironmentsCommandRuns` (its `ActionRunEnvironments`), which takes no Run environments at once slot. Test instances through `ActionTestInstances` (`launchOnBranch` with `runAs` and `relayTab`, `stop`, `read`, `TestInstanceStateChanged`). Devices through `ActionDevices` (`adapters/devices/`: `ProjectDevices.read`, `checkFree`, `hold`, `letGo`, `ConnectedDevices.read` for why a hold ended, `ConnectedDeviceChanged`); the sweep needs nothing for devices, as Devices' own sweep ends every hold as run ended. Work through `ActionSources` (a Task's or Initiative's branch) and the fire alarm's state; `AlarmSounded`, `ProjectFeaturesChanged` and `ProjectActionsChanged` reach it through `ActionRunSignals` (`DomainEventSignals`). It raises `ActionRunStarted`, `ActionRunStateChanged` (Notifications' Outcomes, Activity), `ActionRunChanged`, `ActionRunsRemoved` and `ActionSettingsChanged`; the web gets `action-run.changed` (Project, key) and the settings' event. [app.module.ts](../../app.module.ts) binds Activity's and Office updates' ports to `ActionRuns.runningCommandRuns()`: a running command run is busy work (`action-run`).

**Traps:**

- The running command runs (their abort, their timers) are in memory: only the sweep from `office.ts` ends rows left running, never a module's start, so a test app never touches the shared rows or the runtime.
- A Workflow run's CI run is found by its file, branch, actor and creation time only (Projects allows a clock leeway before the start), so two starts by hand of the same file on the same branch at once can't be told apart: a run skips the CI runs the Project's other Action runs follow already (two Actions of one Workflow, or an Action's last run ended moments before), and takes the oldest left.
- A Test target run raises no Outcome of its own: the test instance's are raised by Test instances.
- A hold's own end (`release`, or the environment's signal as the commands end) is Disconnected as run ended, so `CommandRuns` forgets the hold before letting go and reads the record's reason before failing a run: only an end from outside fails it.
- A device hold's check at the start (`checkFree`) holds nothing: the device is held only once the compose project is up, so a start in between by another environment fails the run at its hold, in Devices' words, rather than refusing it.
- The application's tests run on rows in memory (`actions.fixtures.ts`'s `actionsTestbed`, `actions-ports.fixtures.ts`); only the Postgres repository's test writes `action_runs`.
- In e2e, a Project on the fake GitHub can't be fetched (it serves no git, and The Office reaches only https, ssh or a local remote), so a Workflow run's start and following are tested in the service, and the confirm step in e2e with a command Action on a local remote.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

ActionLimits, ActionRuns, ActionRunHistory, ActionRunLogRead, ActionRunSource, ActionRunSourceTip, ActionRunStart, LastActionRun, RunningCommandRun, ActionRun, ActionRunKind, ActionRunOutcome, ActionRunStatus, ActionRunStopReason, ActionRunUser, ActionRunChanged, ActionRunStarted, ActionRunStateChanged, ActionRunsRemoved, ActionSettingsChanged, ActionsModule, ActionsModuleOptions

## Domain events

- `domain/action-run-events.ts`: ActionRunStarted, ActionRunStateChanged, ActionRunChanged, ActionRunsRemoved, ActionSettingsChanged

## HTTP routes (under `/api`)

- `GET /projects/:id/actions/runs`: ActionRunsController.list
- `GET /projects/:id/actions/source`: ActionRunsController.source
- `POST /projects/:id/actions/:key/runs`: ActionRunsController.start
- `POST /action-runs/:id/stop`: ActionRunsController.stop
- `GET /action-runs/:id/log`: ActionRunsController.log
- `GET /settings/actions`: ActionSettingsController.read

## Tables

- `adapters/postgres/actions.schema.ts`: action_runs, action_settings

## Files

### ./

- `actions.fixtures.ts`: ANN, BOB, DEPLOY_SECRET, PIXEL_ID, MAIN_TIP, FIX_TIP, DEFINITION, NoCommandRunEnvironments, ActionsTestbed, actionsTestbed
- `actions.module.ts`: ActionsModuleOptions, ActionsModule
- Tests: actions.test.ts

### adapters/devices/

- `devices-action-devices.ts`: DevicesActionDevices

### adapters/events/

- `domain-event-signals.ts`: DomainEventSignals

### adapters/http/

- `action-run-refusals.filter.ts`: ActionRunRefusalsFilter
- `action-runs.controller.ts`: ActionRunsController, actionRunResponse
- `action-settings-office-actions.controller.ts`: ActionSettingsOfficeActionsController
- `action-settings.controller.ts`: ActionSettingsController

### adapters/office-actions/

- `action-settings-office-actions.ts`: ActionSettingsOfficeActions
- Tests: action-settings-office-actions.test.ts

### adapters/postgres/

- `actions.schema.ts`: actionRuns, actionSettings
- `postgres-action-run-repository.ts`: PostgresActionRunRepository
- `postgres-action-settings.ts`: PostgresActionSettings

### adapters/projects/

- `action-last-runs-registration.ts`: ActionLastRunsRegistration
- `projects-action-projects.ts`: ProjectsActionProjects
- `projects-workflow-host.ts`: ProjectsWorkflowHost
- `translated.ts`: translated

### adapters/run-environments/

- `run-environments-command-runs.ts`: RunEnvironmentsCommandRuns

### adapters/test-instances/

- `test-instances-action-runs.ts`: TestInstancesActionRuns

### adapters/websocket/

- `action-run-web-events.ts`: ActionRunWebEvents

### adapters/work/

- `work-action-sources.ts`: WorkActionSources

### application/

- `action-limits.ts`: ActionLimits
- `action-run-logs.ts`: LineMask, ActionRunLogs
- `action-run-reactions.ts`: ActionRunReactions
- `action-run-records.ts`: ActionRunRecords
- `action-runs.ts`: ActionRunSource, ActionRunStart, ActionRunSourceTip, ActionRunLogRead, ActionRunHistory, RunningCommandRun, LastActionRun, ActionRuns
- `command-runs.ts`: CommandRunDevice, CommandRuns
- `runs-in-background.ts`: RunsInBackground
- `workflow-runs.ts`: WorkflowRuns

### domain/

- `action-run-events.ts`: ActionRunStarted, ActionRunStateChanged, ActionRunChanged, ActionRunsRemoved, ActionSettingsChanged
- `action-run-refused.ts`: ActionRunRefused, ActionRunNotFound
- `action-run-words.ts`: IN_A_TEST_INSTANCE, FIRE_ALARM_ON, WORKFLOW_HAS_NO_STOP, runningAlready, actionsAtOnceFull, notFromTheBaseBranch, noConfirmedCommit, movedSinceYouLooked, notOnTheRemote, noSuchTask, taskOfAnotherProject, taskHasNoBranch, taskEnded, noSuchInitiative, initiativeNotActive, initiativeHasNoBranch, commandsGone, targetGone, ranOutOfTime, exitCodeWords, couldNotRun, didNotShow, deviceNeedsRunEnvironmentOn, deviceGone, deviceInUseBy, deviceLetGoOf
- `action-run.ts`: ActionRunKind, CommandRunState, TestTargetRunState, WorkflowRunState, CiRunState, ActionRunStatus, ActionRunOutcome, ActionRunUser, ActionRunRanFrom, ActionRunCiRun, ActionRunStopReason, ActionRun, KEPT_RUNS, WORKFLOW_SHOW_MS, WORKFLOW_SHOW_POLL_MS, WORKFLOW_FOLLOW_POLL_MS, isRunning, testTargetOutcomeOf, workflowOutcomeOf, NewActionRun, startedRun, failedRun, succeededRun, stoppedRun, testTargetMoved, withCommit, workflowAsked, workflowFollowed, shortCommit, movedAsItStarted, stopWords, runName, runsPastTheKept, sinceWords, stateWords
- `action-settings.ts`: ActionSettings, ACTIONS_AT_ONCE_BOUNDS, DEFAULT_ACTION_SETTINGS, settingsProblems
- Tests: action-run.test.ts

### ports/

- `action-devices.ts`: ActionDevice, ActionDeviceHoldRequest, ActionDeviceHold, ActionDeviceHoldDisconnected, ActionDevices
- `action-projects.ts`: RunProject, RunAction, RunVariable, RunEnvironmentVariables, RunMask, CommandRunSettings, WorkstationRunEnd, ActionProjects
- `action-run-repository.ts`: ActionRunChange, ActionRunningAlready, ActionRunRepository
- `action-run-signals.ts`: ActionRunSignals
- `action-settings-store.ts`: ActionSettingsStore
- `action-sources.ts`: SourceTask, SourceInitiative, ActionSources
- `action-test-instances.ts`: RunTestInstance, TestInstanceMove, ActionTestInstances
- `action-workflow-host.ts`: HostCiRun, ActionWorkflowHost
- `actions-ports.fixtures.ts`: ActionRunRepositoryForTests, ActionSettingsForTests, CommandForTests, ProjectForTests, maskOf, ActionProjectsForTests, ActionSourcesForTests, ActionTestInstancesForTests, ActionWorkflowHostForTests, ActionRunSignalsForTests, HoldForTests, ActionDevicesForTests
- `command-run-environments.ts`: RunInEnvironment, RunInEnvironmentEnd, CommandRunEnvironments
