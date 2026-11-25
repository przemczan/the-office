# Test instances: module map

**Owns:** Test instances (spec §2.12, §5.5 "A test instance's checkout"): a Hosted test target launched on an Initiative's branch (`launchOnInitiative`) or on any branch of a Project (`launchOnBranch`), both through one private `launch`; `launchOnBranch` (optionally run as an Action, `TestInstanceRunAs` `{ actionKey, actionName }`, kept in `action_key`/`action_name` and answered as `runAs`; Test instances never read Actions) links the row to the Initiative `Initiatives.activeInitiativeOnBranch` finds on that branch, so it also shows on that Initiative and stops with it, and an unlinked one stops only on Stop, the Idle time or the sweep; `listForProject` answers the Project's targets, its branches with instances and the Initiatives' names. While the Project has Test targets switched off (spec §2.1.1, `ProjectTestTargets.testTargetsOn`), `listForProject` and `listFor` list no targets (instances still listed), a launch is refused by `launchOf` in Projects' words (`TestTargets.launchSettingsOf` throws `FeatureSwitchedOff`), and `ProjectFeaturesChanged` with `test-targets` off stops each of the Project's Building and Running instances, linked or not, in the background (`stopEachOfProject`, `BY_TEST_TARGETS_OFF`: "Stopped because Test targets were switched off for the Project."). Every row records its `branch` (`initiative_id` is nullable; an old row with no branch reads as its Initiative's branch, `onBranch`). A launch is refused (`TestInstanceRefused`, every reason) unless, for an Initiative, it is active with a branch in the Project, for a branch, the repository or its remote has it, the target is Hosted with its Secret variables typed, the Project's Run environment On, Test instances at once has room (Building counts; the refusal names each "<target> in <Initiative>" when linked, else "<target> on <branch>") and a Proxy port is free (the lowest of the range not held by a Building or Running row, `freeProxyPort`); the check and the insert run one launch at a time (`oneAtATime`), with a partial unique index on `port` while Building or Running behind it. The row is answered Building at once; in the background the branch is fetched and exported into `<office-data>/test-instances/<id>/` (no `.git`), its commit recorded, the entry point checked again at that commit, then `HostedServices.start` with the target's own variables, its port, its port variable, its commands before the entry point, its own Memory per service and the Project's install, ending Running (the host port kept in memory by `RunningTestInstances`, the Idle time stop armed) or Failed with why. Its log, `<office-data>/test-instances/<id>.log`, beside the checkout and kept after it: The Office's lines (`InstanceFiles.note`, `[The Office] …`) and the runtime's output, all through the target's mask (`readLog`, from a byte offset, never cutting a character). Stop (`stop`, Building or Running → Stopped, idempotent), Idle time (`Schedule.once`, re-armed lazily from the last activity, so `recordActivity` costs no timer), the Initiative Done or Dropped, and the sweep from `office.ts` (Running → Stopped, Building → Failed "The Office restarted while it was Building.", then `HostedServices.sweep` and the checkouts left): each frees the port (null on the row), removes the compose project with its volumes and the checkout, and writes how it ended last in the log. Build to install test instances (spec §2.12 "Build to install", "Kept Build to install files"): launched like a Hosted one but with no Proxy port and no Run environment requirement (any other kind refused, `notLaunchable`), Building counted toward the limit; after the same checkout and entry point check (`checkedOut`) the build (`runBuild`) runs in the run environment through `HostedServices.build` when the Project's Run environment is On, else on the workstation through `ProjectTestTargets.runBuild` (`workstationBuildCommandOf`), with only the target's variables and `BUILD_TIMEOUT_MS` (60 minutes), shared with the target's commands before the entry point, which run first (on the workstation each through `ProjectTestTargets.runBuild` in the checkout, the first not exiting 0 failing it in the words `commandBeforeFailureOf` gives, as the run environment's); a target whose commands before the entry point name one the Project no longer has (`TargetLaunch.missingCommands`) fails at once, before the checkout (`missingCommands`); a non-zero exit, the timeout or a build that couldn't run fails it (`buildFailureOf`); on exit 0 the output patterns are matched in the checkout (`keepOutputs`, `fs.promises.glob`), a pattern or a match leading outside it refused, naming it, with nothing copied, no match failing it naming the patterns, and the regular files copied to `<office-data>/test-builds/<id>/` under their base names (`keptNamesOf`: a second `app.apk` is `app-2.apk`), then Built (`files` on the row) and `Built: <names>.` in its log; Stop while Building ends it Failed with the stop's words. Their files (`TestBuildFilesController`): `GET /test-instances/:id/files/:name` behind sign-in, a name served only as the row lists it (`TestInstances.builtFile`, else 404), `nosniff`, `attachment`, an APK as `application/vnd.android.package-archive`; `POST …/:name/link` answers `{ kind: "needs-lan-address" }` at `localhost` or a loopback IP, else a link at the address the page was opened at to `GET /sign-in/test-builds/:token`, open without sign-in as every `/api/sign-in/**` path is: the token (`TestBuildLinks`) names the instance, the file and its expiry (`TEST_BUILD_LINK_MS`, 1 hour by `Schedule.now()`), HMAC-SHA256 under a 32-byte key made once in `<office-data>/test-builds/.link-key` (0600), any token not holding answering a bare 404. Retention (`TestBuildRetention`): after each Built the target's builds on the Initiative, or an unlinked target's per branch, past the newest `KEPT_BUILDS` (3) lose their files (`files_removed_at`, `TestInstanceFilesRemoved`, a line in their log), and a daily run started by office.ts removes every build's files once its Initiative has been Done or Dropped `KEPT_AFTER_INITIATIVE_ENDS_DAYS` (7) days (`Initiatives.find`'s `endedAt`), and an unlinked build's files `KEPT_AFTER_BUILT_DAYS` (7) days after it was Built (its log: "The files were removed: they were Built 7 days ago."). Install on a device test instances (spec §2.12 "Install on a device"; `launchInstall`): refused unless the Project's Run environment is On (`RUN_ENVIRONMENT_OFF_FOR_INSTALL`), its Build to install target is there (`buildTargetGone`) with its Secret variables typed, its device free (`InstallDevices.checkFree`, Devices' "<device> is in use by <holder>." as a `TestInstanceRefused`, 409) and the limit has room; the row keeps the device's id, name and kind (`device`) and the `relayTab` stays in memory (`Held`). In the background (`install`): its own checkout (no entry point check), then the build target's newest Built instance on the branch (`newestBuilt`) when it ran the same commit with its files kept (`reusedBuild`, "Reusing the files Built from <short commit> on <day> at <time> UTC. Its build: the Test instance <id>."), else a Build to install instance of it on the same branch (`buildFor`: linked, kept and retained as any other, `builtFor` the install's target, `build_instance_id` written on the install before the build's row, inside `oneAtATime`), awaited while the install is Building, its Failed failing the install "The build failed: <its reason>."; then Installing (`installFrom`, `startedInstalling`, the Install time `INSTALL_TIMEOUT_MS`, 5 minutes, armed on `Schedule.once` from here): only `.apk` files (`apksOf`, the others named in the log, none failing it `NO_APK` before any hold), `checkFree` again (a device taken during the build fails it in Devices' words, the build kept), `HostedServices.install` with the build's kept files, `InstallDevices.hold` in that environment (named "<target> in <Initiative>" or "<target> on <branch>", `holderNameOf`; not held fails it with Devices' problem), then adb attached there (`runAdbInstall`: `adb -s <serial> install -r` for one, `install-multiple -r` for several, from `/office-test-build/`, its output into the masked log) ending Installed on `Success` or Failed in `installFailureOf`'s words ("The phone refused the install: <CODE>.", "<device> didn't answer."), `INSTALL_RAN_OUT`, or `deviceLetGo` when Devices ends the hold under it (`onHoldEnded`); the device is let go of (`letGoOf`) and the environment removed before the state is written, however it ends. A stop, the Initiative's end or Test targets switched off fail it with the stop's words and stop the build it launched (`stopItsBuild`); the sweep fails one left Installing (`RESTARTED_WHILE_INSTALLING`). Test instances at once counts the two as one (`countedTowardTheLimit` leaves out a build an active install names in `buildInstanceId`). The Test instances limits (`test_instance_settings`, one row, the spec's defaults until saved; `TestInstanceLimits`, `GET`/`PUT /settings/test-instances`). The test-instance proxy (spec §5.1, §2.10): `TestInstanceProxy` opens a listener (`ProxyListeners`, `adapters/proxy/NodeHttpProxyListeners`, one `node:http` server per port on `OFFICE_HOST`, `OfficeHost`) on `TestInstanceLaunched`, keeps it while Running and closes it on Stopped or Failed, every one on module destroy. At a port: a Host other than `localhost`, `127.0.0.1`, `OFFICE_HOST` or the address the request arrived at, at the port, gets a plain 421; no Running instance the 503 page; `GET /__office/hand-off?t=` exchanges a hand-off token (`TestInstanceHandOffs`: `POST /test-instances/:id/open` answers `{ url }` at the hostname The Office was reached at; 32 random bytes, kept as a hash, single use, 60 s by `Schedule.now()`, bound to its instance) for the cookie `office_test_instance_<id>` (HttpOnly, SameSite=Strict, Path=/, a random session kept as a hash, all dropped as the instance ends) and a 303 to `/`, else the 403 page; no valid cookie the 401 page. The rest, WebSocket upgrades too, goes to `127.0.0.1:<hostPort>` with Host and Origin `localhost:<target port>` (`appPortOf`), only the app's cookies, renamed back from `oti_<first 8 hex of the id>_<name>`, its `Set-Cookie` names prefixed so and `Domain` dropped, a `Location` at its own address pointed back at the port; each request and each WebSocket message from the browser is `recordActivity`; an app not answering gets the 502 page (`proxy-pages.ts`).

**Talks to:** Run environments only through `HostedServices` (`start`, `build`, `install`, `stop`, `sweep`; spec §5.3), which takes no run environment slot and isn't busy work: a Running instance holds back no Office update. Projects through `ProjectTestTargets` (`adapters/projects/`: `TestTargets`, `TestInstanceCheckouts` with its `runBuild` for a workstation build, `ProjectService`, `ProjectFeatures.isOn` for `testTargetsOn`; `ProjectRefused` becomes `TestInstanceRefused`, `ProjectNotFound` `TestInstanceNotFound`). Devices through `InstallDevices` (`adapters/devices/`: `ProjectDevices.list` for a target's device name, `checkFree`, `hold`, `letGo`, and `ConnectedDeviceChanged` Disconnected for a test instance's hold, `onHoldEnded`; `ProjectDeviceRefused` becomes `TestInstanceRefused`). Work through `Initiatives` (`adapters/work/`: `InitiativeService.read`, its `endedAt` for the retention, the branch named by `initiativeBranchOf`, and `activeInitiativeOnBranch(projectId, branch)` for the link) and Work's `InitiativeStateChanged`, handled in the background since the bus waits. [app.module.ts](../../app.module.ts) gives it Work, Projects, Run environments and Devices in `imports`, The Office's port (`OfficePort`), which no Proxy port may be, and `OFFICE_HOST` (`officeHost`), which the proxy listens on; office.ts starts the proxy (`TestInstanceProxy`, exported) and the builds' daily retention (`TestBuildRetention`, exported); the file routes read `OfficeAddresses` for the address the page was opened at. Its proxy reads `RunningTestInstances` (`byPort`, `upstreamOf`, `isRunning`, `recordActivity`, `portRange`, `list`) and the events `TestInstanceLaunched`, `TestInstanceStateChanged` (with the port held) and `TestInstanceCommitRecorded`; the web gets `test-instance.changed`, carrying `projectId` and, when linked, `initiativeId` (a launch, a state change, a commit, a build's files removed) and `test-instance-settings.changed`. `TestInstanceLaunched` carries no port for a build, and the proxy opens nothing for it. Notifications reacts to `TestInstanceStateChanged`, which carries what its words need: `targetName`, `branch`, `failedReason`, a Built instance's `files` by name, `deviceName`, `builtFor` (a build an install launched, which raises nothing of its own), and `stoppedBy` (the `StopReason` kind, set by `stopped()`, which `stop()` and the sweep pass the reason to), so a build failed by the user's Stop or its Initiative ending raises nothing. Activity reads the instances through `TestInstances.activity(since)`: the active ones, then those Built or Failed since (`TestInstanceRepository.endedSince`).

**Traps:**

- `TestInstanceCheckouts` refuses any folder not directly inside `<office-data>/test-instances/`, so the checkout is `<id>/` itself and the log can't live in it: it is `<id>.log` beside it, which the sweep keeps.
- The running state, the masks and the idle stops are in memory: the sweep at start ends every row left Building or Running. It runs from `office.ts` only, never a module's start, so a test app never touches the shared rows or the runtime.
- Every test file shares `test_instances`, and the limit, the ports and the sweep weigh every row: the application's tests run on rows in memory (`TestInstanceRepositoryForTests`, `test-instances.fixtures.ts`), and only the Postgres repository's test writes the table, on ports of its own (61000s). Only `test-instances-http.test.ts` writes `test_instance_settings`, and gives the defaults back.
- A stop while Building aborts the start; the background build then sees the abort and leaves the row as the stop wrote it. A checkout can't be aborted, so the build removes it again once it lands.
- The definition on the branch is read only once the checkout is made, so an invalid `.devcontainer/` ends the instance Failed with the definition's problems, not as a refused launch.
- `branchCommit` is the Initiative branch's local tip, read with no fetch (`TestInstanceCheckouts.branchCommitOf`), so "Newer commits on the branch" shows once a Task lands on the branch here; a push made elsewhere shows only after the next launch's fetch.
- The proxy listens only once office.ts calls `TestInstanceProxy.start()`, never on a module's start, so a test app opens no port; `test-instance-proxy.test.ts` starts it on three free loopback ports of its own (the settings' range set to them) over a real `node:http` app on the scripted runtime's `hostPort`.
- Browsers don't separate cookies by port: every cookie of The Office and of every instance reaches every Proxy port, so the app gets only its own prefixed ones; that drops The Office's `office_signed_in` without naming it, and an app's own `office_signed_in` reaches the browser as `oti_…_office_signed_in`.
- The listener answers for whichever instance holds its port now (`byPort` per request): `RunningTestInstances` drops an instance before its Stopped event closes the port, so a request meanwhile gets the 503 page, never the app; a port's opens and closes run one after another, so a port freed and given out again reopens after its close.
- The upstream sees Host `localhost:<target port>`, the port its app listens on inside the run environment, not `127.0.0.1:<hostPort>`: a test instance of The Office checks Host against the port the request arrived at, its container port.
- A build stopped while Building is Failed by `stopped` itself (a build has no Stopped), so the stop's words are its `failedReason` and the log's one last line, never also `Failed: …`; `ended` doesn't call `HostedServices.stop` for a build, whose compose project `HostedServices.build` removes as the aborted build ends.
- The sweep leaves `<office-data>/test-builds/` alone: a Built row isn't active, and its files go only by the retention. A build's compose project carries `office.test-instance`, so `HostedServices.sweep` removes it; the build cache volume carries none and is external, so it stays.
- `test-instance-builds.test.ts` scripts the build both ways: the `ScriptedContainerRuntime`'s `onExec` for the run environment, `ProjectTestTargetsForTests.onBuild` for the workstation, each writing files into the checkout; `test-build-files-http.test.ts` runs a guarded app at a public address of its own, since only a Host the request check lets through and that isn't `localhost` gets a link.
- An Install on a device instance and the build it launched are two rows that end apart: the install awaits `runBuild` itself, and a stop of the install stops the build (`stopItsBuild`) but a stop of the build fails the install "The build failed: Stopped by you.". The build's row is written after the install names it, both inside `oneAtATime`, so a limit check never counts it alone; a stop landing in between stops the build as soon as it is written.
- Devices publishes Disconnected for the install's own `letGo` too: `letGoOf` forgets the hold's id first, so `onHoldEnded` fails only a hold ended by something else while `installing` is set.
- `test-instance-installs.test.ts` scripts adb through the `ScriptedContainerRuntime`'s `onAttach` (an attached program's arguments after `sh -c <script> sh`) and Devices through `InstallDevicesForTests` (`ports/install-devices.fixtures.ts`), the Install time through the ManualSchedule.
- The tests that need a Running instance build it with `testInstancesTestbed(hostedServices, officeDataPath)` (`index.fixtures.ts`) over Run environments' `runEnvironmentsTestbed` and its `ScriptedContainerRuntime`, which the test makes, as `test-instances.test.ts` does.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

RunningTestInstances, RunningTestInstance, TestBuildRetention, TestInstanceProxy, TestInstances, LaunchedBy, TestInstance, TestInstanceRunAs, TestInstanceState, TestInstanceOnBranch, TestInstanceCommitRecorded, TestInstanceFilesRemoved, TestInstanceLaunched, TestInstanceSettingsChanged, TestInstanceStateChanged, TestInstancesModule, TestInstancesModuleOptions

## Domain events

- `domain/test-instance-events.ts`: TestInstanceLaunched, TestInstanceStateChanged, TestInstanceCommitRecorded, TestInstanceFilesRemoved, TestInstanceSettingsChanged

## HTTP routes (under `/api`)

- `GET /test-instances/:id/files/:name`: TestBuildFilesController.download
- `POST /test-instances/:id/files/:name/link`: TestBuildFilesController.link
- `POST /test-instances/:id/open`: TestInstanceOpenController.open
- `GET /settings/test-instances`: TestInstanceSettingsController.read
- `PUT /settings/test-instances`: TestInstanceSettingsController.change
- `GET /initiatives/:id/test-instances`: TestInstancesController.list
- `POST /initiatives/:id/test-instances`: TestInstancesController.launch
- `GET /projects/:id/test-instances`: TestInstancesController.listOfProject
- `POST /projects/:id/test-instances`: TestInstancesController.launchOnBranch
- `POST /test-instances/:id/stop`: TestInstancesController.stop
- `GET /test-instances/:id/log`: TestInstancesController.log

## Tables

- `adapters/postgres/test-instances.schema.ts`: test_instances, test_instance_settings

## Files

### ./

- `index.fixtures.ts`: ANN, APK_PATTERN, BRANCH_FILES, BUILD_SECRET, BUILD_TARGET, PROJECT_SECRET, TARGET_SECRET, TESTBED_OFFICE_PORT, testInstancesTestbed, WEB_TARGET, TestInstancesTestbed
- `test-instances.fixtures.ts`: TESTBED_OFFICE_PORT, ANN, TARGET_SECRET, PROJECT_SECRET, BRANCH_FILES, WEB_TARGET, BUILD_SECRET, APK_PATTERN, BUILD_TARGET, PIXEL, INSTALL_TARGET, TestInstancesTestbed, testInstancesTestbed
- `test-instances.module.ts`: TestInstancesModuleOptions, TestInstancesModule
- Tests: test-build-files-http.test.ts, test-instance-builds.test.ts, test-instance-installs.test.ts, test-instance-proxy.test.ts, test-instances-http.test.ts, test-instances.test.ts

### adapters/devices/

- `devices-install-devices.ts`: DevicesInstallDevices

### adapters/http/

- `test-build-files.controller.ts`: TEST_BUILD_LINK_PATH, TestBuildFilesController
- `test-instance-open.controller.ts`: TestInstanceOpenController
- `test-instance-refusals.filter.ts`: TestInstanceRefusalsFilter
- `test-instance-settings.controller.ts`: TestInstanceSettingsController
- `test-instances.controller.ts`: TestInstancesController, instanceResponse
- Tests: test-instance-open.controller.test.ts

### adapters/postgres/

- `postgres-test-instance-repository.ts`: PostgresTestInstanceRepository
- `postgres-test-instance-settings.ts`: PostgresTestInstanceSettings
- `test-instances.schema.ts`: testInstances, testInstanceSettings
- Tests: postgres-test-instance-repository.test.ts

### adapters/projects/

- `projects-test-targets.ts`: ProjectsTestTargets

### adapters/proxy/

- `node-http-proxy-listeners.ts`: HAND_OFF_PATH, NodeHttpProxyListeners
- `proxy-cookies.ts`: instanceCookieName, appCookiePrefix, instanceCookie, cookieValue, appCookieHeader, browserSetCookie
- `proxy-hosts.ts`: addressedToProxy, hostnameOf
- `proxy-pages.ts`: ProxyPage, OfficeLink, openFromTheOfficePage, usedLinkPage, notRunningPage, appDidNotAnswerPage

### adapters/websocket/

- `test-instance-web-events.ts`: TestInstanceWebEvents

### adapters/work/

- `work-initiatives.ts`: WorkInitiatives

### application/

- `adb-install.ts`: AdbPlace, runAdbInstall
- `build-outputs.ts`: KeptFile, KeptOutputs, keepOutputs
- `instance-files.ts`: LineMask, InstanceFiles
- `running-test-instances.ts`: RunningTestInstance, RunningTestInstances
- `test-build-links.ts`: LinkedFile, TestBuildLinks
- `test-build-retention.ts`: REMOVING_ENDED_BUILDS, TestBuildRetention
- `test-instance-hand-offs.ts`: HAND_OFF_MS, TestInstanceHandOffs
- `test-instance-limits.ts`: OfficePort, TestInstanceLimits
- `test-instance-proxy.ts`: OfficeHost, TestInstanceProxy
- `test-instances.ts`: LaunchableTarget, LaunchableInstall, TestInstanceOnBranch, InitiativeTarget, InitiativeTestProject, ProjectTestBranch, ProjectTestInstances, Launch, InstanceLog, TestInstances

### domain/

- `device-install.ts`: INSTALL_TIMEOUT_MINUTES, INSTALL_TIMEOUT_MS, INSTALL_RAN_OUT, NO_APK, buildTargetGone, buildFailed, deviceLetGo, deviceDidNotAnswer, holderNameOf, reusingWords, buildingWords, apksOf, ignoredWords, adbInstallArguments, AdbInstallEnd, installFailureOf
- `entry-point.ts`: TargetEntryPoint, DEVCONTAINER_SERVICE_BUILDS_NOTHING, WorkstationBuildCommand, workstationBuildCommandOf
- `stop-reason.ts`: StopReason, BY_USER, BY_RESTART, BY_TEST_TARGETS_OFF, stopWords, RESTARTED_WHILE_BUILDING, RESTARTED_WHILE_INSTALLING, INITIATIVE_NOT_ACTIVE, RUN_ENVIRONMENT_OFF, RUN_ENVIRONMENT_OFF_FOR_INSTALL, noInitiativeBranch, notLaunchable, notRunning, missingCommands, secretsWithoutValue
- `test-build.ts`: BUILD_TIMEOUT_MINUTES, BUILD_TIMEOUT_MS, TEST_INSTANCE_MARK, KEPT_BUILDS, KEPT_AFTER_INITIATIVE_ENDS_DAYS, KEPT_AFTER_BUILT_DAYS, TEST_BUILD_LINK_MS, BuildEnd, buildFailureOf, commandBeforeFailureOf, outputPatternProblem, noMatch, outsideTheCheckout, keptNamesOf, mediaTypeOf, hasFile, buildsPastTheKept, initiativeEndedLongAgo, builtLongAgo, FILES_REMOVED_FOR_NEWER, filesRemovedAsInitiativeEnded, FILES_REMOVED_AFTER_BUILT
- `test-instance-events.ts`: TestInstanceLaunched, TestInstanceStateChanged, TestInstanceCommitRecorded, TestInstanceFilesRemoved, TestInstanceSettingsChanged
- `test-instance-refused.ts`: TestInstanceRefused, TestInstanceNotFound
- `test-instance-settings.ts`: TestInstanceSettings, DEFAULT_SETTINGS, settingsProblems, freeProxyPort, everyPortInUse, ActiveInstanceName, overTheLimit
- `test-instance.ts`: TestInstanceKind, TestInstanceState, ACTIVE_STATES, TestInstanceDeviceKind, TestInstanceDevice, BuiltFor, LaunchedBy, TestInstance, TestInstanceRunAs, TestInstanceChange, isActive, countedTowardTheLimit, launchedInstance, withCommit, withBuild, startedInstalling, installed, startedRunning, built, filesRemoved, stopped, failed
- Tests: device-install.test.ts, entry-point.test.ts, test-build.test.ts, test-instance.test.ts

### ports/

- `initiatives.fixtures.ts`: InitiativesForTests
- `initiatives.ts`: InitiativeForTestInstances, Initiatives
- `install-devices.fixtures.ts`: InstallDevicesForTests
- `install-devices.ts`: ProjectDeviceOf, InstallHoldRequest, InstallHold, InstallDevices
- `project-test-targets.fixtures.ts`: TargetForTests, InstallTargetForTests, RunTargetForTests, ProjectForTests, ProjectTestTargetsForTests
- `project-test-targets.ts`: ListedTarget, ListedInstall, InstanceMask, TargetVariable, CommandBefore, WorkstationBuild, WorkstationBuildEnd, TargetLaunch, InstallLaunch, InstallSettings, ProjectTestTargets
- `proxy-listeners.ts`: ProxyListeners
- `test-instance-repository.fixtures.ts`: TestInstanceRepositoryForTests
- `test-instance-repository.ts`: BuildsOf, TestInstanceRepository
- `test-instance-settings-store.fixtures.ts`: TestInstanceSettingsForTests
- `test-instance-settings-store.ts`: TestInstanceSettingsStore
