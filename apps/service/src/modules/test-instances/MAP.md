# Test instances: module map

**Owns:** Test instances (spec §2.12, §5.5 "A test instance's checkout"): a Hosted test target launched on an Initiative's branch (`TestInstances.launch`): refused (`TestInstanceRefused`, every reason) unless the Initiative is active with a branch in the Project, the target is Hosted with its Secret variables typed, the Project's Run environment On, Test instances at once has room (Building counts; the refusal names each "<target> in <Initiative>") and a Proxy port is free (the lowest of the range not held by a Building or Running row, `freeProxyPort`); the check and the insert run one launch at a time (`oneAtATime`), with a partial unique index on `port` while Building or Running behind it. The row is answered Building at once; in the background the branch is fetched and exported into `<office-data>/test-instances/<id>/` (no `.git`), its commit recorded, the entry point checked again at that commit, then `HostedServices.start` with the target's own variables, its port and the Project's install, ending Running (the host port kept in memory by `RunningTestInstances`, the Idle time stop armed) or Failed with why. Its log, `<office-data>/test-instances/<id>.log`, beside the checkout and kept after it: The Office's lines (`InstanceFiles.note`, `[The Office] …`) and the runtime's output, all through the target's mask (`readLog`, from a byte offset, never cutting a character). Stop (`stop`, Building or Running → Stopped, idempotent), Idle time (`Schedule.once`, re-armed lazily from the last activity, so `recordActivity` costs no timer), the Initiative Done or Dropped, and the sweep from `office.ts` (Running → Stopped, Building → Failed "The Office restarted while it was Building.", then `HostedServices.sweep` and the checkouts left): each frees the port (null on the row), removes the compose project with its volumes and the checkout, and writes how it ended last in the log. The Test instances limits (`test_instance_settings`, one row, the spec's defaults until saved; `TestInstanceLimits`, `GET`/`PUT /settings/test-instances`). The test-instance proxy (spec §5.1, §2.10): `TestInstanceProxy` opens a listener (`ProxyListeners`, `adapters/proxy/NodeHttpProxyListeners`, one `node:http` server per port on `OFFICE_HOST`, `OfficeHost`) on `TestInstanceLaunched`, keeps it while Running and closes it on Stopped or Failed, every one on module destroy. At a port: a Host other than `localhost`, `127.0.0.1`, `OFFICE_HOST` or the address the request arrived at, at the port, gets a plain 421; no Running instance the 503 page; `GET /__office/hand-off?t=` exchanges a hand-off token (`TestInstanceHandOffs`: `POST /test-instances/:id/open` answers `{ url }` at the hostname The Office was reached at; 32 random bytes, kept as a hash, single use, 60 s by `Schedule.now()`, bound to its instance) for the cookie `office_test_instance_<id>` (HttpOnly, SameSite=Strict, Path=/, a random session kept as a hash, all dropped as the instance ends) and a 303 to `/`, else the 403 page; no valid cookie the 401 page. The rest, WebSocket upgrades too, goes to `127.0.0.1:<hostPort>` with Host and Origin `localhost:<target port>` (`appPortOf`), only the app's cookies, renamed back from `oti_<first 8 hex of the id>_<name>`, its `Set-Cookie` names prefixed so and `Domain` dropped, a `Location` at its own address pointed back at the port; each request and each WebSocket message from the browser is `recordActivity`; an app not answering gets the 502 page (`proxy-pages.ts`).

**Talks to:** Run environments only through `HostedServices` (`start`, `stop`, `sweep`; spec §5.3), which takes no run environment slot and isn't busy work: a Running instance holds back no Office update. Projects through `ProjectTestTargets` (`adapters/projects/`: `TestTargets`, `TestInstanceCheckouts`, `ProjectService`; `ProjectRefused` becomes `TestInstanceRefused`, `ProjectNotFound` `TestInstanceNotFound`). Work through `Initiatives` (`adapters/work/`: `InitiativeService.read`, the branch named by `initiativeBranchOf`) and Work's `InitiativeStateChanged`, handled in the background since the bus waits. [app.module.ts](../../app.module.ts) gives it Work, Projects and Run environments in `imports`, The Office's port (`OfficePort`), which no Proxy port may be, and `OFFICE_HOST` (`officeHost`), which the proxy listens on; office.ts starts the proxy (`TestInstanceProxy`, exported). Its proxy reads `RunningTestInstances` (`byPort`, `upstreamOf`, `isRunning`, `recordActivity`, `portRange`, `list`) and the events `TestInstanceLaunched`, `TestInstanceStateChanged` (with the port held) and `TestInstanceCommitRecorded`; the web gets `test-instance.changed` and `test-instance-settings.changed`.

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
- The tests that need a Running instance build it with `testInstancesTestbed(hostedServices, officeDataPath)` (`index.fixtures.ts`) over Run environments' `runEnvironmentsTestbed` and its `ScriptedContainerRuntime`, which the test makes, as `test-instances.test.ts` does.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

RunningTestInstances, RunningTestInstance, TestInstanceProxy, TestInstances, TestInstanceCommitRecorded, TestInstanceLaunched, TestInstanceSettingsChanged, TestInstanceStateChanged, TestInstancesModule, TestInstancesModuleOptions

## Domain events

- `domain/test-instance-events.ts`: TestInstanceLaunched, TestInstanceStateChanged, TestInstanceCommitRecorded, TestInstanceSettingsChanged

## HTTP routes (under `/api`)

- `POST /test-instances/:id/open`: TestInstanceOpenController.open
- `GET /settings/test-instances`: TestInstanceSettingsController.read
- `PUT /settings/test-instances`: TestInstanceSettingsController.change
- `GET /initiatives/:id/test-instances`: TestInstancesController.list
- `POST /initiatives/:id/test-instances`: TestInstancesController.launch
- `POST /test-instances/:id/stop`: TestInstancesController.stop
- `GET /test-instances/:id/log`: TestInstancesController.log

## Tables

- `adapters/postgres/test-instances.schema.ts`: test_instances, test_instance_settings

## Files

### ./

- `index.fixtures.ts`: ANN, BRANCH_FILES, PROJECT_SECRET, TARGET_SECRET, TESTBED_OFFICE_PORT, testInstancesTestbed, WEB_TARGET, TestInstancesTestbed
- `test-instances.fixtures.ts`: TESTBED_OFFICE_PORT, ANN, TARGET_SECRET, PROJECT_SECRET, BRANCH_FILES, WEB_TARGET, TestInstancesTestbed, testInstancesTestbed
- `test-instances.module.ts`: TestInstancesModuleOptions, TestInstancesModule
- Tests: test-instance-proxy.test.ts, test-instances-http.test.ts, test-instances.test.ts

### adapters/http/

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

- `instance-files.ts`: LineMask, InstanceFiles
- `running-test-instances.ts`: RunningTestInstance, RunningTestInstances
- `test-instance-hand-offs.ts`: HAND_OFF_MS, TestInstanceHandOffs
- `test-instance-limits.ts`: OfficePort, TestInstanceLimits
- `test-instance-proxy.ts`: OfficeHost, TestInstanceProxy
- `test-instances.ts`: InitiativeTarget, InitiativeTestProject, Launch, InstanceLog, TestInstances

### domain/

- `stop-reason.ts`: StopReason, BY_USER, BY_RESTART, stopWords, RESTARTED_WHILE_BUILDING, INITIATIVE_NOT_ACTIVE, RUN_ENVIRONMENT_OFF, noInitiativeBranch, notHosted, notRunning, secretsWithoutValue
- `test-instance-events.ts`: TestInstanceLaunched, TestInstanceStateChanged, TestInstanceCommitRecorded, TestInstanceSettingsChanged
- `test-instance-refused.ts`: TestInstanceRefused, TestInstanceNotFound
- `test-instance-settings.ts`: TestInstanceSettings, DEFAULT_SETTINGS, settingsProblems, freeProxyPort, everyPortInUse, ActiveInstanceName, overTheLimit
- `test-instance.ts`: TestInstanceKind, TestInstanceState, ACTIVE_STATES, LaunchedBy, TestInstance, TestInstanceChange, isActive, launchedInstance, withCommit, startedRunning, stopped, failed

### ports/

- `initiatives.fixtures.ts`: InitiativesForTests
- `initiatives.ts`: InitiativeForTestInstances, Initiatives
- `project-test-targets.fixtures.ts`: TargetForTests, ProjectForTests, ProjectTestTargetsForTests
- `project-test-targets.ts`: TargetEntryPoint, ListedTarget, InstanceMask, TargetLaunch, InstallSettings, ProjectTestTargets
- `proxy-listeners.ts`: ProxyListeners
- `test-instance-repository.fixtures.ts`: TestInstanceRepositoryForTests
- `test-instance-repository.ts`: TestInstanceRepository
- `test-instance-settings-store.fixtures.ts`: TestInstanceSettingsForTests
- `test-instance-settings-store.ts`: TestInstanceSettingsStore
