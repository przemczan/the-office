# Service platform: map

**Owns:** the shared plumbing below every module: config, database, domain events, HTTP (`http/`: `officeActionRoutes(actions)` (`office-action-routes.ts`, beside `ContractPipe`), the base a module's controller of Office actions extends: one route per declared action, its method and path from the declaration, its input the path's parameters and the body together parsed with the declaration's schema, answering 200 with the controller's `answer` for the signed-in user; the module keeps that controller in its own `adapters/http`; `textOrUndefined` (`query-text.ts`) reads a query parameter, such as one GitHub sent the browser back with; `configureHttp` puts the Host and Origin check first, `OfficeAddresses` accepting `localhost`, loopback and local-network IPs and the public address, `OFFICE_PUBLIC_ADDRESS`, with its https origin, and telling each request's `AddressKind` and whether it came over HTTPS (the public address with `X-Forwarded-Proto: https`); then the sign-in guard, `refuseSignedOutRequests`, answering 401 to every `/api` path but `/api/sign-in/**`, `/api/health` and the `-p` hook when the `SignedInRequests` port, bound by `RequestAccessModule` to the users module, finds no signed-in device, and keeping who it found for `@SignedIn()`; the web app's own files need no sign-in), the Office data directory, per-key locks within the process, the `Schedule`, The Office's clock: the time and the jobs and one-off waits it runs by itself (`ScheduleModule`; tests get a `ManualSchedule` from `startTestApplication`, whose time is the system's until a test sets it and moves only by `advanceTo`, the e2e service a two-second day), the WebSocket push (`websocket/event-stream.ts`: an upgrade needs a signed-in device (401 otherwise, localhost too), each client is kept with its device, and a `SignedOut` device's sockets close with `SIGNED_OUT`, as do, at a check each minute on the `Schedule` (`SignedInRequests.signedOutAmong`), those of a device signed out by another process, such as `set-password`, or expired; a client subscribes to event types, each with or without a scope, a `threadId`; a subscription without one gets every event of its type, one scoped to a Thread the events of its type whose `threadId` is that Thread's; unsubscribing with a scope removes only that scope's types, and the `subscriptions` reply to a scoped message lists that scope's types with its `threadId`), telemetry (`telemetry/`: a setting, Off, Bundled Grafana or Your own endpoint with headers and a timeout, kept in `<office-data>/telemetry.json` owner-only by `telemetry-file.ts`; `launch.ts` reads it with the environment before any module loads, `telemetrySettingsFrom` resolving what applies (any of `OTEL_SDK_DISABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_HEADERS` wins, then the file, else off), and `startTelemetry` starts no SDK when off; what this run started with is remembered process-wide (`telemetry-in-effect.ts`) for `TelemetryModule`, and `TelemetryHttpModule`, imported by the app alone, serves `GET`/`PUT /settings/telemetry`, never a header's value, and `POST /settings/telemetry/bundled-grafana/start` (Try again); the bundled Grafana (`telemetry/bundled-grafana/`): The Office runs grafana/otel-lgtm itself, at the pin in `bundled-grafana.ts`, as its own Compose project `the-office-grafana` from `<office-data>/grafana/compose.yaml`, which `DockerComposeBundledGrafana` writes (127.0.0.1 only: 3300, 4317, 4318; a named data volume; its own healthcheck; `restart: unless-stopped`) and drives with `up --wait`, `stop` and `ps` through `startProgram`, plus `ps`/`stop` of an earlier bundled Grafana (the `otel-lgtm` service of project `the-office`, or a container named `the-office-grafana`), stopped, never removed; `BundledGrafanaKeeper` starts it after a save that chooses it and on Try again, and at each start of The Office (`keepAtStart`, from `office.ts`) starts it while Bundled Grafana is saved or this run exports to it and stops The Office's own otherwise, leaving it alone while OTEL_* variables set telemetry; it keeps only this run's Starting and Couldn't start, reading Running from Docker), `config/address-to-open.ts`'s `addressToOpen`, where a person opens The Office (the public address, else `localhost` at the port for a loopback or every-address listen), printed with a setup token, the web app's pages, the rules of every image The Office keeps (`images/`: `readImage` tells what bytes are from the bytes alone, or why they can't be one, and each module turns the problem into its own refusal; `ImageFolder`, the files of one Office data folder under their ids; `imageContent`, the headers that keep an opened SVG from running or loading anything), The Office's MCP client (`mcp/`: `McpClient`, bound by `McpClientModule` to `SdkMcpClient` on `@modelcontextprotocol/sdk`; it connects to a local server (stdio) or a remote one (Streamable HTTP), lists tools, calls one and closes, for the MCP server review and the engines' sessions), the Office identity for git (`git-identity/`, `GitIdentityModule`: `OfficeIdentity.forGitCommand(remote, inherited)` gives one git command its `-c` arguments and whole environment, and `needsOf(remote)` which part of the identity a remote needs and what is missing (`RemoteNeeds`), making nothing; `OfficeGitHome`, the home folder and global config file every Office git command runs with, in `<office-data>/identity/`; `OfficeSshKey`, made on first need there and `regenerate()`d at the user's request (made beside the current key as `office_ssh_key.new`, moved over it only once made, one at a time); `OfficeKnownHosts`, GitHub's keys from its meta API (`<api>/meta`) and other hosts' after the user confirms a fingerprint, the Trusted hosts with their keys, and the Unconfirmed hosts (in memory: listed when `forGitCommand` reaches an ssh host that isn't trusted or a refusal sends the user to confirm one through `addUnconfirmedHost`, dropped once confirmed); `GitHubSite`, where GitHub is (website and REST API, `GITHUB_SITE` by default): the bound `GitHubUserToken` extends it and `GitIdentityModule` provides it from that binding, so the https check, the credential helper's origin, GitHub's ssh host (the website's hostname) and the meta URL all read one value; `OfficeIdentityHttpModule`, imported by the app alone, serves the Office ssh key's public half, its regeneration and the known hosts for Settings › Office identity (`OfficeIdentityController`); the `GitHubUserToken` port, bound in `app.module.ts` to the github module's `GitHubAccess` by the global `GitHubUserTokenModule`; `GitCredentialHelper`, the credential helper Office code answers: a command reaching GitHub's https origin while signed in gets `-c credential.<origin>.helper=!<node> <script> <port> <secret>`, the script (`identity/git-credential-helper-<digest>.cjs`) asks a loopback listener with that command's secret, and `GitCommandIdentity.release()` ends the secret once the command exits), the workstation's load (`workstation/`: `GET /workstation/load` for the Workstation figure, read on demand from Node's `os` through the `Workstation` port by `WorkstationLoadReader`, the CPU use measured since the previous read by `cpuUseBetween`, none on the first read or one over 10 s after the previous, and the last one again within 500 ms; no job, database or events), and `os/`, the only code that branches on the operating system (`hasLoadAverage`: Linux yes, Windows no). What a module may use is in the [module template](../../docs/module-template.md). Paging (`paging/page.ts`, `http/page-cursors.ts`, `database/page-sql.ts`), the pattern for every list that grows without end: newest first by a time and then the id, `PAGE_SIZE` (30, contracts' `paging.ts`) rows a page, read one past the page's size to know whether another follows (`pageOf`); the next page's cursor is the last row's `(at, id)`, opaque to the web as base64url JSON (`cursorText`, `pageRequested` answering 400 for a cursor no page gave), sent back as `?after=`; the query takes `afterCursor` (a row comparison) and `newestFirst`, with an index on `(…, at desc, id desc)` so a page reads from where it starts; the response is `{ rows, next, total }` (`toPageResponse`, contracts' `pageSchemaOf`), `total` counting the whole list for its heading. A module's repository port takes the cursor's `at` and `id` and a limit and answers the rows with the count, as ports use nothing of the platform but domain events; its application asks one row past the page and builds the page with `pageOf`. The web reads such a list with `pagedQueryOptions` and "Show more" (`shell/show-more.tsx`). The Archive of Initiatives keeps its numbered pages of 25, as the user moves between them.

**Traps:** a thread-scoped event type (contracts' `THREAD_SCOPED_EVENT_TYPES`: `thread.sub-agent-messages`, `thread.process-output`) reaches only subscriptions scoped to its event's `threadId`, never one without a scope, so a page subscribing to it unscoped gets nothing, silently; the `threadId` is read from the web event's payload, so a scoped type's mapping must carry it. An engine that runs Agents' shells itself takes each from `agentShells`: on Windows Git Bash is found as Claude Code finds it (`CLAUDE_CODE_GIT_BASH_PATH`, beside `git.exe` on PATH, then `Program Files\Git`), never a `bash.exe` on PATH (System32's is WSL's), and PowerShell gets its command line as `-Command`, since `-EncodedCommand` writes errors as CLIXML once output is piped. `EventBus.publish` waits for asynchronous handlers (a failing one stops neither the others nor the publisher), so a long reaction must run in the background. `TimerSchedule` waits for a running job in `beforeApplicationShutdown`, before the database closes. A program a user names by its command (a local MCP server's `npx`) starts through `startProgram` (cross-spawn, which runs a `.cmd` in cmd.exe with each argument quoted for it), never the SDK's own stdio transport, which signals only cmd.exe and leaves the server running; `ProgramStdioTransport` ends the tree on close, and tells of the server's end only on `close`, once its standard error has ended: Node may emit `exit` before the last of it is read, which left a failed review's problem without the server's own words; it waits for `close` two seconds at most, as a process that escaped the tree can hold that output open for ever. A local MCP server gets the service's environment without The Office's own variables. The test MCP servers are `mcp/fake-*.fixtures.ts`; the stdio one is a script Node runs with its types stripped, so it imports packages only. A test that checks a process has ended any later than right after its end, such as after `close` (whose leftovers query takes PowerShell a second), checks it with `isMarkedRunning` and a `processMark` on its command line: Windows hands an ended process's id to a new process within about a second. Every caller of `forGitCommand` calls `release()` once git exits. The token is read only when git asks the helper, so a public repository needs no refresh; a read that throws or finds the user signed out fails the command with the reason on git's stderr (`quit=1`), never anonymously. `-c` values reach hooks through `GIT_CONFIG_PARAMETERS`, so a hook can ask the helper while its command runs (spec §8's no-sandbox risk); the token itself is in no argument, variable or file, and `GIT_TRACE_REDACT=1` keeps it out of traces. The identity clears only credential helpers (`-c credential.helper=`), never global or system config, which holds LFS's filters; every command runs with `HOME` in the identity folder, so neither curl nor git-lfs finds the user's `.netrc`, and `GIT_CONFIG_GLOBAL` names an Office file that includes the user's global config by absolute path (`~` in it then means the Office home, and hooks see that home too); `http.emptyAuth=false`, since an empty user name lets curl answer a 401 with the Windows sign-in, and no git setting turns NTLM or Negotiate off on the pinned git; git-lfs still answers Negotiate with the Windows sign-in (spec §5.5's known gap); the http settings are set again for an https remote's own URL, which outranks the bare key; its `GIT_SSH_COMMAND` overrides `core.sshCommand`, runs in git's sh (forward slashes, single quotes) and names files by `-o IdentityFile=`, never `-i`, which ssh checks unexpanded and then reads with `%` expanded. `GIT_ALLOW_PROTOCOL` is `https:ssh`, plus `file` only when the remote itself is local, since setting it overrides git's own limit on submodules' `file` URLs. On Windows ssh, ssh-keygen and ssh-keyscan are Git for Windows' own (`usr\bin`), and owner-only is an icacls access list of the user alone. `OperatingSystem.officeUpdateRefusal` says where The Office can't update itself (Windows). A `ToWebEvent` may give undefined, keeping that event inside the service. `OFFICE_UPDATE_FOLDER` is set by the launcher alone. The bundled Grafana is started or stopped only from `office.ts` and the telemetry routes, never by a test app's start: tests and the end-to-end service bind `BundledGrafana` to `ScriptedBundledGrafana`. It only ever touches its own project `the-office-grafana` (and stops, never removes, an earlier one), and without its compose file `state()` answers `absent` with no Docker call, so an Office without Docker and with telemetry Off never sees an error about it.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Domain events

- `websocket/event-stream.fixtures.ts`: LampLit, LampDimmed

## HTTP routes (under `/api`)

- `GET /office-identity/ssh-key`: OfficeIdentityController.publicKey
- `POST /office-identity/ssh-key/regenerate`: OfficeIdentityController.regenerate
- `GET /office-identity/known-hosts`: OfficeIdentityController.knownHostsList
- `POST /office-identity/known-hosts/scan`: OfficeIdentityController.scan
- `POST /office-identity/known-hosts`: OfficeIdentityController.confirm
- `GET /health`: HealthController.report
- `GET /settings/telemetry`: TelemetrySettingsController.settings
- `PUT /settings/telemetry`: TelemetrySettingsController.save
- `POST /settings/telemetry/bundled-grafana/start`: TelemetrySettingsController.startBundledGrafana
- `GET /workstation/load`: WorkstationController.load

## Files

### config/

- `address-to-open.ts`: addressToOpen
- `invalid-office-config-error.ts`: ConfigProblem, InvalidOfficeConfigError
- `office-config.fixtures.ts`: port, databaseUrl, officeDataDirectory, defaultOfficeDataDirectory, platformDefaults, readProblems
- `office-config.ts`: OfficeConfig, OfficeConfigDefaults, EnvironmentVariables, readOfficeConfig, readDatabaseUrl, isOfficeOwnVariable
- `office-env-file.ts`: OFFICE_ENV_FILE
- Tests: office-config.full.test.ts, office-config.test.ts

### database/

- `database-health.ts`: DatabaseState, DatabaseHealth
- `database-lifecycle.ts`: DatabaseLifecycle
- `database-pool.ts`: DATABASE_POOL, createDatabasePool
- `database.module.ts`: DatabaseOptions, DatabaseModule
- `database.ts`: Database, DATABASE
- `migrations.ts`: runPendingMigrations
- `page-sql.ts`: afterCursor, newestFirst
- Tests: database.module.test.ts

### earlier-records/

- `earlier-records.module.ts`: EarlierRecordsModule
- `earlier-records.ts`: EarlierRecordsClaim, EarlierRecords

### events/

- `domain-event.ts`: DomainEvent, DomainEventClass
- `event-bus.ts`: EventHandler, Unsubscribe, EventBus
- `events.module.ts`: EventsModule
- Tests: event-bus.test.ts

### git-identity/

- `fake-github-meta.fixtures.ts`: GITHUB_ED25519, FakeGitHubMeta, startFakeGitHubMeta
- `git-credential-helper.ts`: GitCredentialAnswer, GitCredentialGrant, GitCredentialHelper
- `git-identity.module.ts`: GitIdentityModule, GitHubUserTokenOptions, GitHubUserTokenModule
- `git-remote.ts`: SSH_PORT, GitRemote, parseGitRemote
- `github-site.ts`: GitHubSite, GITHUB_SITE, gitHubSshHostOf, gitHubMetaUrlOf
- `github-user-token.ts`: GitHubUserToken
- `host-key-scanner.ts`: HostKeyScanner
- `host-keys.ts`: HostKey, hostKeyOf, knownHostName, knownHostsLine, SshHost, TrustedHost, trustedHostNames, trustedHostKeys
- `identity-folder.ts`: IdentityFolder
- `office-git-home.ts`: UserGlobalConfig, userGlobalConfig, OfficeGitHome
- `office-identity-github.fixtures.ts`: run, TOKEN, COMMIT_AS, TestUserToken, bareRepositoryWithOneCommit, basic, gitCommand
- `office-identity-http.module.ts`: OfficeIdentityHttpModule
- `office-identity.controller.ts`: OfficeIdentityController
- `office-identity.fixtures.ts`: NoHostKeyScanner, officeIdentityForTests
- `office-identity.ts`: GitCommandIdentity, SshFiles, OfficeIdentity, GitHome, gitCommandIdentity
- `office-known-hosts.ts`: HostKeyRefused, OfficeKnownHosts
- `office-ssh-key.ts`: OfficeSshKey
- `remote-needs.ts`: MissingForSsh, RemoteNeeds
- `sh-words.ts`: shellQuoted, forSh
- `ssh-keyscan.ts`: SshKeyscan, keysFromKeyscan
- `token-git-server.fixtures.ts`: TokenGitServer, startTokenGitServer
- `user-credentials.fixtures.ts`: UserCredentials, USER_NAME, USER_LFS_CONCURRENT_TRANSFERS, USER_IGNORED_EXTENSION, userCredentials, repositoryWithLfsPointer, isGitLfsInstalled, FakeGitHttpServer, startFakeGitHttpServer
- Tests: git-remote.full.test.ts, office-identity-github.full.test.ts, office-identity-github.test.ts, office-identity.controller.full.test.ts, office-identity.controller.test.ts, office-identity.full.test.ts, office-identity.test.ts, office-known-hosts.full.test.ts, office-known-hosts.test.ts, office-ssh-key.full.test.ts, office-ssh-key.test.ts

### health/

- `health.controller.ts`: HealthController
- `health.module.ts`: HealthModule
- Tests: health.controller.test.ts

### http/

- `api-path.ts`: apiRoutePathOf, isApiPath
- `configure-http.ts`: HTTP_APPLICATION_OPTIONS, configureHttp
- `contract-pipe.ts`: ContractPipe
- `fetch-failure.ts`: fetchFailure
- `local-requests.ts`: RequestAddressing, AddressKind, RequestAddress, localRequestRefusal, requestAddressOf, addressingOf
- `office-action-routes.ts`: OfficeActionRoutes, officeActionRoutes
- `office-addresses.ts`: OfficeAddresses
- `page-cursors.ts`: toPageResponse, pageRequested
- `query-text.ts`: textOrUndefined
- `request-access.module.ts`: RequestAccessOptions, RequestAccessModule
- `request-access.ts`: needsSignIn, refuseNonLocalRequests, refuseSignedOutRequests
- `signed-in-requests.fixtures.ts`: SIGNED_IN_FOR_TESTS, ANOTHER_SIGNED_IN_FOR_TESTS, signedInAs, EveryoneSignedIn, everyoneSignedIn
- `signed-in-requests.ts`: SignedInUser, SignedIn, userOf, SignedInRequests, rememberSignedIn, signedInOfRequest, SIGN_IN_FIRST
- `upload-body.ts`: uploadBody, uploadedBytes
- Tests: configure-http.test.ts, contract-pipe.test.ts, local-requests.test.ts

### images/

- `image-content.ts`: imageContent
- `image-folder.ts`: ImageFolder
- `image-rules.ts`: IMAGE_MEDIA_TYPES, ImageMediaType, IMAGE_SIZE_LIMIT, IMAGE_TOO_LARGE, ImageReading, readImage, mediaTypeOf
- Tests: image-rules.full.test.ts

### locks/

- `keyed-locks.ts`: KeyedLocks

### mcp/

- `fake-mcp-servers.fixtures.ts`: FAKE_STDIO_MCP_SERVER, FAKE_STDIO_MCP_TOOLS, fakeStdioMcpServer, FAKE_HTTP_MCP_TOOLS, FakeHttpMcpServer, startFakeHttpMcpServer
- `fake-stdio-mcp-server.fixtures.ts`
- `mcp-client.module.ts`: McpClientModule
- `mcp-client.ts`: McpServerLaunch, McpTool, McpToolContent, McpToolResult, McpRequestOptions, McpConnection, McpClient, McpServerFailure
- `program-stdio-transport.ts`: ProgramStdioTransport
- `sdk-mcp-client.ts`: SdkMcpClient
- Tests: sdk-mcp-client.full.test.ts, sdk-mcp-client.test.ts

### office-data/

- `office-data-directory.ts`: OfficeDataFolder, OfficeDataDirectory
- `office-data.module.ts`: OfficeDataModule

### os/

- `current-operating-system.ts`: currentOperatingSystem, processorArchitecture
- `linux-processes.ts`: LinuxProcess, hasEnded, processFromStat, runningInGroup
- `linux.ts`: linux
- `move-when-free.ts`: moveWhenFree
- `operating-system.ts`: OperatingSystem, FileOwner, SshPrograms, UserEnvironment
- `owner-only.fixtures.ts`: isOwnerOnly
- `path-rules.ts`: PathRules, PathEntry, PathLimits, pathLengthProblem
- `process-trees.fixtures.ts`: isRunning, processMark, isMarkedRunning, commandLinesHolding
- `process-trees.ts`: ProcessTrees
- `program.ts`: Program, startProgram, isOnPath
- `shell.ts`: AgentShell, ShellProgram, AgentShellProgram, Shell, ShellInvocation, FailedShellCommand
- `windows.ts`: windows, programOf, programCandidates
- Tests: current-operating-system.full.test.ts, current-operating-system.test.ts, linux-processes.full.test.ts, linux.full.test.ts, linux.test.ts, move-when-free.full.test.ts, move-when-free.test.ts, program.full.test.ts, program.test.ts, windows.full.test.ts, windows.test.ts

### paging/

- `page.ts`: PageCursor, PageRequest, Page, pageOf, mapPage

### schedule/

- `schedule.fixtures.ts`: ManualSchedule
- `schedule.module.ts`: ScheduleModule
- `schedule.ts`: ScheduledJob, Wait, Schedule
- `timer-schedule.ts`: TimerSchedule
- Tests: timer-schedule.full.test.ts, timer-schedule.test.ts

### streams/

- `async-channel.ts`: AsyncChannel
- Tests: async-channel.test.ts

### telemetry/

- `export-timeout.ts`: BUNDLED_EXPORT_TIMEOUT_MILLISECONDS, exportTimeoutMilliseconds
- `office-logger.fixtures.ts`: setUp
- `office-logger.ts`: OfficeLogger
- `saved-telemetry-setting.ts`: SavedTelemetrySetting
- `start-telemetry.ts`: StartedTelemetry, startTelemetry
- `telemetry-choice.ts`: ChoiceToSave, choiceToSave, savedChoiceOf
- `telemetry-file.ts`: TELEMETRY_FILE, telemetryFilePath, TelemetryFileReading, readTelemetryFile, writeTelemetryFile
- `telemetry-http.module.ts`: TelemetryHttpModule
- `telemetry-in-effect.ts`: rememberTelemetryInEffect, RunningTelemetrySettings
- `telemetry-settings.controller.ts`: TelemetrySettingsController
- `telemetry-settings.ts`: TELEMETRY_VARIABLES, TelemetryInEffect, TELEMETRY_OFF, telemetrySetByEnvironment, telemetrySettingsFrom, isSetByEnvironment, runningTelemetryOf, sameTelemetry
- `telemetry.fixtures.ts`: CollectingMetricReader, setUp
- `telemetry.module.ts`: TelemetryModule
- `telemetry.ts`: TelemetryAttributes, TokenUsage, TraceRoot, Telemetry
- Tests: export-timeout.full.test.ts, office-logger.full.test.ts, office-logger.test.ts, start-telemetry.test.ts, telemetry-settings.controller.test.ts, telemetry-settings.test.ts, telemetry.full.test.ts, telemetry.test.ts

### telemetry/bundled-grafana/

- `bundled-grafana-keeper.ts`: BundledGrafanaKeeper
- `bundled-grafana.ts`: BUNDLED_GRAFANA_IMAGE, BUNDLED_GRAFANA_PROJECT, BundledGrafanaRunState, BundledGrafanaProblem, BundledGrafanaFailed, problemWords, BundledGrafana
- `docker-compose-bundled-grafana.ts`: COMPOSE_FILE, UP_WAIT_SECONDS, UP_TIMEOUT_MS, STOP_TIMEOUT_MS, READ_TIMEOUT_MS, DockerCall, DockerOutcome, RunDocker, DockerComposeBundledGrafana, bundledGrafanaComposeFile, problemOf, runStateOf, runDockerProgram
- `scripted-bundled-grafana.ts`: BundledGrafanaCall, ScriptedBundledGrafana
- Tests: bundled-grafana-keeper.test.ts, docker-compose-bundled-grafana.full.test.ts, docker-compose-bundled-grafana.test.ts

### web-app/

- `built-web-app.ts`: BuiltWebApp
- `unbuilt-web-app-warning.ts`: UnbuiltWebAppWarning
- `vite-web-app.ts`: ViteWebApp
- `web-app-directory.ts`: WEB_APP_DIRECTORY
- `web-app.module.ts`: WebAppSource, WebAppOptions, WebAppModule
- Tests: web-app.module.full.test.ts, web-app.module.test.ts

### websocket/

- `event-stream.fixtures.ts`: LampLit, LampDimmed, OutputPrinted, SubAgentWrote, ThreadLampLit, THREAD_A, THREAD_B, lampLitSchema, lampDimmedSchema, messageSchema, Message, forwardThreadEvents, changeSubscription, DevicesForTests, devicesForTests
- `event-stream.module.ts`: EventStreamModule
- `event-stream.ts`: SIGNED_OUT, SIGNED_IN_CHECK_EVERY_MS, EventStream
- `web-event-forwarding.ts`: ToWebEvent, WebEventForwarding
- Tests: event-stream.full.test.ts, event-stream.test.ts

### workstation/

- `cpu-use.ts`: CoreTimes, coreTimesOf, cpuUseBetween
- `workstation-load-reader.ts`: SHORTEST_MEASURE_MS, LONGEST_MEASURE_MS, WorkstationLoadReader
- `workstation.controller.fixtures.ts`: GIB, FakeWorkstation
- `workstation.controller.ts`: WorkstationController
- `workstation.module.ts`: WorkstationModule
- `workstation.ts`: Workstation, NodeWorkstation
- Tests: cpu-use.full.test.ts, workstation.controller.full.test.ts, workstation.controller.test.ts
