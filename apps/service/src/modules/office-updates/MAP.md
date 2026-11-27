# Office-updates: module map

**Owns:** Office updates and Office restarts (spec §5.1 Defaults, "Updating The Office", "Restarting The Office" and "Released versions"; [docs/running-the-office.md](../../../../../docs/running-the-office.md)) for each install kind (`domain/install-kind.ts`: `checkout`, `release` or `container`, from `OFFICE_INSTALL`, which the image sets to `container` and the launcher to `release` when it runs from its releases folder, and from the release's stamp). The Office's own checkout (`OfficeCheckout`, bound to `CommandLineOfficeCheckout` on the checkout `AppModule.register` names, the service's own by default and `OFFICE_E2E_CHECKOUT` in the e2e service; plain git as the service's user, never the Office identity): the current commit, fetching `@{upstream}`, the commits behind it, local changes and commits its upstream doesn't have. The Office release's stamp (`OfficeReleaseStamp`, `FilesystemOfficeReleaseStamp` reading `office-release.json` in the same folder, written by `tools/release`; none in a checkout): the version Settings › Updates shows, the GitHub repository it is released from, and the current commit in place of git's, logged at boot. GitHub Releases (`OfficeReleases`, `GitHubOfficeReleases`: unauthenticated on `OFFICE_GITHUB_API_URL`, 30 s, drafts, pre-releases and non-version tags dropped; `domain/office-version.ts` compares versions and names a version whole and a commit shortened). The service's container (`OfficeContainer`, `DockerCliOfficeContainer`: the docker CLI on `/var/run/docker.sock`; its id, image, Compose labels and mounts, and starting the Office updater). `OfficeUpdates`: the check (`POST /office-update/check`, and the daily `OFFICE_UPDATE_CHECK` job, first at boot), kept in memory, of the upstream for a checkout and of GitHub Releases for a release or a container, a failed read being the check's problem; Update (`POST /office-update/schedule`) after a fresh check, refused with the reason (`domain/update-refusal.ts`, by kind: the system's refusal (`UpdateSystem`, bound to `platform/os`, which also gives the CPU); a checkout's no launcher, local changes, no upstream, diverged; a release's not installed, no repository, no tarball for this CPU; a container's no Docker socket, not started by Compose, compose files outside its folder; or nothing newer); Cancel (`DELETE`); `GET /office-update` and the update's log (`GET /office-update/log`). The schedule lives in Busy work's `ScheduledExitHold` (in memory, so a restart cancels it) as a `ScheduledExit` (generic over the target, which Busy work never reads; `OfficeScheduledExit` here fixes it to `OfficeUpdateTarget`): an update with its target (a commit or a release) or a restart, one at a time; `ScheduledExits` sets and cancels it (`ScheduledExitCancelled`) and, once nothing is busy, goes ahead with what its kind registered, calling `onReadyToExit`'s listeners when the service is to exit: `office.ts` closes the app and exits with code 75. `OfficeRestarts`: Restart (`POST /office-restart/schedule`, Cancel `DELETE`), refused with the reason (`domain/restart-refusal.ts`: no launcher, a release copy not installed, a container whose Docker restart policy isn't `always`, `unless-stopped` or `on-failure` or that can't reach Docker, or an update or restart scheduled already), shown as `restart.refusal` in `GET /office-update`; its hand-off (`RestartHandOff`) is `LauncherRestart`, writing `{ "kind": "restart" }` as the request, or `ContainerRestart`, which reads the restart policy again and fails, leaving the restart scheduled, when it no longer starts the container again. `InstalledOffice` tells the install kind and the release's stamp to both. Busy work (its own module, `../busy-work/`) counts the work an update or restart waits for, which each module reports where it starts and ends it: Engine an Agent's turn (`EngineCallSpans`, labelled by `SessionSettings.turnLabel`), Conversations a Thread's background Sub-agents still running after its turn (`SessionFollowing`, one `sub-agents` item per session while any runs, labelled by its Thread), Pipelines a Script Stage and a Publish (`ScriptStageRunner`), Projects a clone (`RepositoryClones`) and an environment check (`EnvironmentChecks`). Once an update is scheduled and nothing is busy, `OfficeUpdates` hands it over (`UpdateHandOff`): `LauncherHandOff` writes `request.json` (`OfficeUpdateRequest`: a commit, or a release's tarball) in the launcher's folder (`UpdateFolder`, `FilesystemUpdateFolder` on `OFFICE_UPDATE_FOLDER`), and the service exits. In a container `UpdaterHandOff` writes the request in `<OFFICE_DATA_DIR>/update` and starts the Office updater, and the service stays up; when the updater ends with the service still alive, it failed before replacing it, so `OfficeUpdates` announces its result and cancels the scheduled exit. At boot it takes `result.json`, keeps it as `last-result.json`, and publishes `OfficeUpdated` or `OfficeUpdateFailed`.

**Talks to:** Busy work (`BusyWork` and `ScheduledExitHold`, through `../busy-work/index.js`; `ScheduledExits` subscribes to its `BusyWorkChanged`) and Engine (`EngineModule`, imported by `OfficeUpdatesModule`), plus the platform. The others reach it: Work's Start conditions add `ScheduledExitHold.waitWords()` (Busy work's; "An update is scheduled." or "A restart is scheduled.") as a wait while it holds, and `QueueService` releases on `ScheduledExitCancelled`; Pipelines' `StageInterpreter` ends a walk before an Agent or Script Stage while one is scheduled and walks those Tasks again on `ScheduledExitCancelled`; Notifications raises `office.update.done` and `office.update.failed` on the result events, naming them with `officeVersionWords`, and its Now reads `OfficeUpdates.available()` (the target the last check found and when it was first found, in memory; none while an update or restart is scheduled) through its `OfficeUpdateAvailable` port, bound in app.module.ts to the one instance `AppModule` registers. Engine and the modules counting work import `BusyWorkModule` from Busy work, never `OfficeUpdatesModule`, which `AppModule` registers with the config and gives Notifications in `imports`; so Office updates may import Engine without a cycle.

**Traps:** Busy work must never import this module (`ScheduledExits.scheduled` casts the hold's untyped target back to `OfficeUpdateTarget`, which only this module sets). `BusyWork.begin` announces `BusyWorkChanged` in the background, so a turn counted mid-call never waits on the reactions; the web hears it only while an update or restart is scheduled. A failed hand-off of either kind leaves it scheduled without announcing anything, so held work stays held until the next `BusyWorkChanged` tries again or the user cancels. Windows refuses every Update before any other reason, so a test of Update overrides the system with `updateSystem()`, and the e2e service (`e2e.ts`) binds `UpdateSystem` the same way. A Gate isn't held at the Stage boundary: it does no work and asks the user. A Task held at the boundary stays In progress; after the update's restart the Stage interpreter takes it up as after any restart. The launcher and the Office updater (`tools/office-launcher/`, `update-folder.ts` there) and `tools/release` share the files' names and shapes with this module by convention only: workspaces stay apart. A release's commit comes from its stamp, never from git, which would read a repository above the install folder. A release's request needs the check's releases (their asset URLs), so the request is built from the last check, which `schedule` has just run. A test of a release or container overrides `OfficeReleases` and `OfficeContainer` with fakes: nothing reaches GitHub or Docker. A container's updater success is never seen by this service: the updater's `compose up` stops it, and the new container takes the result at boot.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

ScheduledExits, OFFICE_UPDATE_CHECK, OfficeUpdates, OfficeRestarts, officeVersionWords, OfficeRestartScheduled, OfficeUpdateChecked, OfficeUpdated, OfficeUpdateFailed, OfficeUpdateScheduled, ScheduledExitCancelled, OfficeUpdatesModule, OfficeUpdatesOptions, UpdateSystem

## Domain events

- `domain/office-update-events.ts`: OfficeUpdateChecked, OfficeUpdateScheduled, OfficeRestartScheduled, ScheduledExitCancelled, OfficeUpdated, OfficeUpdateFailed

## HTTP routes (under `/api`)

- `GET /office-update`: OfficeUpdatesController.read
- `GET /office-update/log`: OfficeUpdatesController.log

## Files

### ./

- `index.fixtures.ts`: createOfficeCheckout, OfficeCheckoutForTests, updateSystem
- `office-updates.module.ts`: OfficeUpdatesOptions, OfficeUpdatesModule

### adapters/docker/

- `container-restart.ts`: ContainerRestart
- `docker-cli-office-container.ts`: DOCKER_SOCKET, UPDATER_LABEL, UPDATER_ENTRY, containerIdFrom, officeContainerFrom, composeProjectFrom, hostPathOf, updaterRunArguments, DockerCliOfficeContainer
- `updater-hand-off.ts`: UpdaterHandOff
- Tests: docker-cli-office-container.test.ts

### adapters/filesystem/

- `filesystem-office-release-stamp.ts`: FilesystemOfficeReleaseStamp
- `filesystem-update-folder.ts`: FilesystemUpdateFolder
- `launcher-hand-off.ts`: LauncherHandOff
- `launcher-restart.ts`: LauncherRestart

### adapters/git/

- `command-line-office-checkout.ts`: CommandLineOfficeCheckout
- `office-checkout.fixtures.ts`: OfficeCheckoutForTests, createOfficeCheckout
- Tests: command-line-office-checkout.full.test.ts, command-line-office-checkout.test.ts

### adapters/github/

- `github-office-releases.ts`: GitHubOfficeReleases
- Tests: github-office-releases.test.ts

### adapters/http/

- `office-update-office-actions.controller.ts`: OfficeUpdateOfficeActionsController
- `office-update-response.ts`: officeUpdateResponse
- `office-updates.controller.fixtures.ts`: refusalOf, AnnouncedResults
- `office-updates.controller.ts`: OfficeUpdatesController
- `scheduled-exit-refusals.filter.ts`: ScheduledExitRefusalsFilter
- Tests: office-restart.controller.test.ts, office-updates.controller.full.test.ts, office-updates.controller.test.ts, released-office-updates.controller.test.ts

### adapters/office-actions/

- `office-update-office-actions.ts`: OfficeUpdateOfficeActions
- Tests: office-update-office-actions.test.ts

### adapters/websocket/

- `office-update-web-events.ts`: OfficeUpdateWebEvents

### application/

- `installed-office.ts`: InstalledOffice
- `office-install.ts`: OfficeInstallSetting
- `office-restarts.ts`: NO_RESTART_SCHEDULED, RESTARTING, OfficeRestarts
- `office-updates.ts`: OFFICE_UPDATE_CHECK, UP_TO_DATE, ALREADY_SCHEDULED, NOTHING_SCHEDULED, UNDER_WAY, RESTART_SCHEDULED, OfficeUpdateCheck, OfficeUpdateTargetFound, OfficeUpdateFound, OfficeUpdateView, OfficeUpdates
- `scheduled-exits.ts`: GoAhead, ScheduledExits

### domain/

- `install-kind.ts`: InstallKind, installKindOf
- `office-commit.ts`: OfficeCommit, shortCommit
- `office-container.ts`: ComposeProject, ContainerMount, RunningOfficeContainer, OfficeContainerRead, imageRepository, composeFilesOutside
- `office-release.ts`: OfficeRelease, releaseWords
- `office-update-events.ts`: OfficeUpdateChecked, OfficeUpdateScheduled, OfficeRestartScheduled, ScheduledExitCancelled, OfficeUpdated, OfficeUpdateFailed
- `office-update-request.ts`: OfficeUpdateRequest, RestartRequest, LauncherRequest
- `office-update-result.ts`: OfficeUpdateStep, OfficeUpdateResult, stepWords
- `office-update-target.ts`: OfficeUpdateTarget, targetWords
- `office-version.ts`: OfficeVersion, parseVersion, compareVersions, isNewer, versionText, officeVersionWords
- `published-release.ts`: ReleaseAsset, PublishedRelease, TarballAssets, tarballName, tarballAssetsOf
- `restart-refusal.ts`: RestartState, NO_LAUNCHER_TO_RESTART, NOT_INSTALLED_TO_RESTART, UPDATE_SCHEDULED_ALREADY, RESTART_SCHEDULED_ALREADY, dockerUnreachable, noRestartPolicy, containerRestartRefusal, alreadyScheduled, restartRefusal
- `scheduled-exit-refused.ts`: ScheduledExitRefused
- `scheduled-exit.ts`: OfficeScheduledExit
- `update-refusal.ts`: CheckoutState, ReleaseState, ContainerState, UpdateState, NO_LAUNCHER, LOCAL_CHANGES, NO_UPSTREAM, NOT_INSTALLED, NO_REPOSITORY, NO_DOCKER_SOCKET, diverged, noTarball, notComposed, composeFilesElsewhere, updateRefusal
- Tests: office-version.test.ts, restart-refusal.test.ts, update-refusal.full.test.ts, update-refusal.test.ts

### ports/

- `office-checkout.ts`: UpstreamRead, OfficeCheckout
- `office-container.ts`: UpdaterRequest, StartedUpdater, OfficeContainer
- `office-release-stamp.ts`: OfficeReleaseStamp
- `office-releases.ts`: OfficeReleases
- `restart-hand-off.ts`: RestartHandOff
- `update-folder.ts`: UpdateFolder
- `update-hand-off.ts`: HandedOff, UpdateHandOff
- `update-system.fixtures.ts`: TEST_ARCHITECTURE, updateSystem
- `update-system.ts`: UpdateSystem
