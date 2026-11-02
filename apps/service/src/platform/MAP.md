# Service platform: map

**Owns:** the shared plumbing below every module: config, database, domain events, HTTP, the Office data directory, per-key locks within the process, the `Schedule`, The Office's clock: the time and the jobs and one-off waits it runs by itself (`ScheduleModule`; tests get a `ManualSchedule` from `startTestApplication`, whose time is the system's until a test sets it and moves only by `advanceTo`, the e2e service a two-second day), the WebSocket push, telemetry, the web app's pages, The Office's MCP client (`mcp/`: `McpClient`, bound by `McpClientModule` to `SdkMcpClient` on `@modelcontextprotocol/sdk`; it connects to a local server (stdio) or a remote one (Streamable HTTP), lists tools, calls one and closes, for the MCP server review and the engines' sessions), the Office identity for git (`git-identity/`, `GitIdentityModule`: `OfficeIdentity.forGitCommand(remote, inherited)` gives one git command its `-c` arguments and whole environment, and `needsOf(remote)` which part of the identity a remote needs and what is missing (`RemoteNeeds`), making nothing; `OfficeGitHome`, the home folder and global config file every Office git command runs with, in `<office-data>/identity/`; `OfficeSshKey`, made on first need there; `OfficeKnownHosts`, GitHub's keys from its meta API (`<api>/meta`) and other hosts' after the user confirms a fingerprint, the Trusted hosts with their keys, and the Unconfirmed hosts (in memory: listed when `forGitCommand` reaches an ssh host that isn't trusted or a refusal sends the user to confirm one through `addUnconfirmedHost`, dropped once confirmed); `GitHubSite`, where GitHub is (website and REST API, `GITHUB_SITE` by default): the bound `GitHubUserToken` extends it and `GitIdentityModule` provides it from that binding, so the https check, the credential helper's origin, GitHub's ssh host (the website's hostname) and the meta URL all read one value; `OfficeIdentityHttpModule`, imported by the app alone, serves the Office ssh key's public half and the known hosts for Settings › Office identity (`OfficeIdentityController`); the `GitHubUserToken` port, bound in `app.module.ts` to the github module's `GitHubAccess` by the global `GitHubUserTokenModule`; `GitCredentialHelper`, the credential helper Office code answers: a command reaching GitHub's https origin while signed in gets `-c credential.<origin>.helper=!<node> <script> <port> <secret>`, the script (`identity/git-credential-helper-<digest>.cjs`) asks a loopback listener with that command's secret, and `GitCommandIdentity.release()` ends the secret once the command exits), and `os/`, the only code that branches on the operating system. What a module may use is in the [module template](../../docs/module-template.md).

**Traps:** an engine that runs Agents' shells itself takes each from `agentShells`: on Windows Git Bash is found as Claude Code finds it (`CLAUDE_CODE_GIT_BASH_PATH`, beside `git.exe` on PATH, then `Program Files\Git`), never a `bash.exe` on PATH (System32's is WSL's), and PowerShell gets its command line as `-Command`, since `-EncodedCommand` writes errors as CLIXML once output is piped. `EventBus.publish` waits for asynchronous handlers (a failing one stops neither the others nor the publisher), so a long reaction must run in the background. `TimerSchedule` waits for a running job in `beforeApplicationShutdown`, before the database closes. A program a user names by its command (a local MCP server's `npx`) starts through `startProgram` (cross-spawn, which runs a `.cmd` in cmd.exe with each argument quoted for it), never the SDK's own stdio transport, which signals only cmd.exe and leaves the server running; `ProgramStdioTransport` ends the tree on close. A local MCP server gets the service's environment without The Office's own variables. The test MCP servers are `mcp/fake-*.fixtures.ts`; the stdio one is a script Node runs with its types stripped, so it imports packages only. A test that checks a process has ended any later than right after its end, such as after `close` (whose leftovers query takes PowerShell a second), checks it with `isMarkedRunning` and a `processMark` on its command line: Windows hands an ended process's id to a new process within about a second. Every caller of `forGitCommand` calls `release()` once git exits. The token is read only when git asks the helper, so a public repository needs no refresh; a read that throws or finds the user signed out fails the command with the reason on git's stderr (`quit=1`), never anonymously. `-c` values reach hooks through `GIT_CONFIG_PARAMETERS`, so a hook can ask the helper while its command runs (spec §8's no-sandbox risk); the token itself is in no argument, variable or file, and `GIT_TRACE_REDACT=1` keeps it out of traces. The identity clears only credential helpers (`-c credential.helper=`), never global or system config, which holds LFS's filters; every command runs with `HOME` in the identity folder, so neither curl nor git-lfs finds the user's `.netrc`, and `GIT_CONFIG_GLOBAL` names an Office file that includes the user's global config by absolute path (`~` in it then means the Office home, and hooks see that home too); `http.emptyAuth=false`, since an empty user name lets curl answer a 401 with the Windows sign-in, and no git setting turns NTLM or Negotiate off on the pinned git; git-lfs still answers Negotiate with the Windows sign-in (spec §5.5's known gap); the http settings are set again for an https remote's own URL, which outranks the bare key; its `GIT_SSH_COMMAND` overrides `core.sshCommand`, runs in git's sh (forward slashes, single quotes) and names files by `-o IdentityFile=`, never `-i`, which ssh checks unexpanded and then reads with `%` expanded. `GIT_ALLOW_PROTOCOL` is `https:ssh`, plus `file` only when the remote itself is local, since setting it overrides git's own limit on submodules' `file` URLs. On Windows ssh, ssh-keygen and ssh-keyscan are Git for Windows' own (`usr\bin`), and owner-only is an icacls access list of the user alone.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## HTTP routes (under `/api`)

- `GET /office-identity/ssh-key`: OfficeIdentityController.publicKey
- `GET /office-identity/known-hosts`: OfficeIdentityController.knownHostsList
- `POST /office-identity/known-hosts/scan`: OfficeIdentityController.scan
- `POST /office-identity/known-hosts`: OfficeIdentityController.confirm
- `GET /health`: HealthController.report

## Files

### config/

- `invalid-office-config-error.ts`: ConfigProblem, InvalidOfficeConfigError
- `office-config.ts`: OfficeConfig, OfficeConfigDefaults, EnvironmentVariables, readOfficeConfig, isOfficeOwnVariable
- `office-env-file.ts`: OFFICE_ENV_FILE
- Tests: office-config.test.ts

### database/

- `database-health.ts`: DatabaseState, DatabaseHealth
- `database-lifecycle.ts`: DatabaseLifecycle
- `database-pool.ts`: DATABASE_POOL, createDatabasePool
- `database.module.ts`: DatabaseOptions, DatabaseModule
- `database.ts`: Database, DATABASE
- `migrations.ts`: runPendingMigrations
- Tests: database.module.test.ts

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
- Tests: git-remote.test.ts, office-identity-github.test.ts, office-identity.controller.test.ts, office-identity.test.ts, office-known-hosts.test.ts, office-ssh-key.test.ts

### health/

- `health.controller.ts`: HealthController
- `health.module.ts`: HealthModule
- Tests: health.controller.test.ts

### http/

- `api-path.ts`: isApiPath
- `configure-http.ts`: HTTP_APPLICATION_OPTIONS, configureHttp
- `contract-pipe.ts`: ContractPipe
- `fetch-failure.ts`: fetchFailure
- `local-requests.ts`: RequestAddressing, localRequestRefusal, refuseNonLocalRequests, addressingOf
- `upload-body.ts`: uploadBody, uploadedBytes
- Tests: configure-http.test.ts, contract-pipe.test.ts, local-requests.test.ts

### locks/

- `keyed-locks.ts`: KeyedLocks

### mcp/

- `fake-mcp-servers.fixtures.ts`: FAKE_STDIO_MCP_SERVER, FAKE_STDIO_MCP_TOOLS, fakeStdioMcpServer, FAKE_HTTP_MCP_TOOLS, FakeHttpMcpServer, startFakeHttpMcpServer
- `fake-stdio-mcp-server.fixtures.ts`
- `mcp-client.module.ts`: McpClientModule
- `mcp-client.ts`: McpServerLaunch, McpTool, McpToolContent, McpToolResult, McpRequestOptions, McpConnection, McpClient, McpServerFailure
- `program-stdio-transport.ts`: ProgramStdioTransport
- `sdk-mcp-client.ts`: SdkMcpClient
- Tests: sdk-mcp-client.test.ts

### office-data/

- `office-data-directory.ts`: OfficeDataFolder, OfficeDataDirectory
- `office-data.module.ts`: OfficeDataModule

### os/

- `current-operating-system.ts`: currentOperatingSystem
- `linux-processes.ts`: LinuxProcess, hasEnded, processFromStat, runningInGroup
- `linux.ts`: linux
- `move-when-free.ts`: moveWhenFree
- `operating-system.ts`: OperatingSystem, SshPrograms, UserEnvironment
- `owner-only.fixtures.ts`: isOwnerOnly
- `path-rules.ts`: PathRules, PathEntry, PathLimits, pathLengthProblem
- `process-trees.fixtures.ts`: isRunning, processMark, isMarkedRunning, commandLinesHolding
- `process-trees.ts`: ProcessTrees
- `program.ts`: Program, startProgram
- `shell.ts`: AgentShell, ShellProgram, AgentShellProgram, Shell, ShellInvocation, FailedShellCommand
- `windows.ts`: windows, programOf, programCandidates
- Tests: current-operating-system.test.ts, linux-processes.test.ts, linux.test.ts, move-when-free.test.ts, program.test.ts, windows.test.ts

### schedule/

- `schedule.fixtures.ts`: ManualSchedule
- `schedule.module.ts`: ScheduleModule
- `schedule.ts`: ScheduledJob, Wait, Schedule
- `timer-schedule.ts`: TimerSchedule
- Tests: timer-schedule.test.ts

### streams/

- `async-channel.ts`: AsyncChannel
- Tests: async-channel.test.ts

### telemetry/

- `export-timeout.ts`: exportTimeoutMilliseconds
- `office-logger.ts`: OfficeLogger
- `start-telemetry.ts`: StartedTelemetry, startTelemetry
- `telemetry.module.ts`: TelemetryModule
- `telemetry.ts`: TelemetryAttributes, TokenUsage, TraceRoot, Telemetry
- Tests: export-timeout.test.ts, office-logger.test.ts, telemetry.test.ts

### web-app/

- `built-web-app.ts`: BuiltWebApp
- `unbuilt-web-app-warning.ts`: UnbuiltWebAppWarning
- `vite-web-app.ts`: ViteWebApp
- `web-app-directory.ts`: WEB_APP_DIRECTORY
- `web-app.module.ts`: WebAppSource, WebAppOptions, WebAppModule
- Tests: web-app.module.test.ts

### websocket/

- `event-stream.module.ts`: EventStreamModule
- `event-stream.ts`: EventStream
- `web-event-forwarding.ts`: ToWebEvent, WebEventForwarding
- Tests: event-stream.test.ts
