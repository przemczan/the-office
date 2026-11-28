# Engine: module map

## Owns

- The engines Settings › Engines lists (`engines`: id from the name, kind `claude-code` (with `-p`), `codex`, `copilot-cli`, `gemini-cli`, `openai-compatible-api`), the Office default, Default effort, Stand-in Engines and `askBeforeSwitchAbove` (`engine_settings`), Model prices (`model_prices`), model lists (`engine_model_lists`), Window starts (`engine_window_starts`).
- Removal with reference moves (`EngineSettingsService.remove`, `removalPreview`), `ENGINES_OFFICE_ACTIONS`; accounts and sign-in per kind (`EngineAccounts`, `EngineAccountsModule`).
- The `AgentEngine` port and its adapters (`AgentEngines`), `EngineSessions` (start, resume, carry, capabilities, stand-ins), the Office rules hook, `OfficeToolRegistry` and `officeActionTool`, usage windows (`UsageWindowState`, `UsageWindowChecks`, `usage_window_samples`, `engine_day_usage`), engine call telemetry (`EngineCallSpans`).
- `engineToRunOn` and `engineThroughStandIns` (`domain/stand-in-engines.ts`); `index.domain.ts` re-exports the pure values other domains use.

## Talks to

- Prompt templates (`ENGINE_PROMPT_TEMPLATES`, loaded once per `open()`), Busy work (each Agent turn); otherwise no module. Office updates imports Engine, never the reverse. It never reads Skills: Skills counts `SkillCalled`.
- Others register into it: Office tools (`OfficeToolRegistry`), Save checks (`EngineSettingsChecks`, People's capability check), removal moves (`EngineReferenceMoves`: Projects, Work); Conversations fills `OfficeToolRuling`.
- People, Projects and Work hold `EngineReferenceLock` over their saves of an engine reference.

## Traps

- Adapters stay apart: each engine type's folder imports only itself, `shared/` and engine-neutral adapters (`office-rules/`, `mcp-servers/`, `skills/`); only `agent-sdk/` and `claude-code-p/` share `claude-code/`. Lint `office/module-boundaries` enforces it.
- `OfficeToolRegistry.named(names, ruling)` requires an `OfficeToolRuling` and wraps every `run`: no adapter builds an unruled tool. A new action is declared once as an Office action ([the module template](../../../docs/module-template.md)).
- An action's `draft` fingerprint must hold every field the handler reads and writes. The `list_office_tools`/`call_office_tool` pair is unruled; only its inner call is.
- `EngineReferenceLock` is one key over `KeyedLocks` (one process), re-entrant along the async chain: publish `EngineRemoved`/`EngineAdded` after `holding` returns; take no other lock under it. A Save writes every engine back with its key, so key setters run under the lock.
- A new engine never takes a listed id; contracts' `engineIdFor` mirrors the service's. Tests give engines ids of their own (`RemovedEngineUsage` forgets shared rows). Engine settings are shared: tests use `EngineSettingsForTests`.
- Engine folders share `engines/`; each adapter's startup clean-up weighs every kind in `KINDS_WITH_A_FOLDER`, or it removes the other kinds' folders. `removeEngineConfigFolder` refuses anything not directly in `engines/`.
- Rollback: the release before can't read `codex` (0160), `copilot-cli` (0173) or `gemini-cli` (0177) rows; `office_default_model` is still written.
- Secrets: `CodexApiKey`, `PastedToken`, `AnthropicApiKey` and friends are redacted until `reveal()`; `toEqual` holds any two keys equal. `SessionOptions.mcpServers` carries Server values: never log or keep options; Server values never go on a command line or in the environment (owner-only `McpConfigFile`).
- `apiKeyHelper` goes in session settings only, naming the key file; `auth status` can't see a key-signed folder, so `account` reads the key file. A pasted token is told by `refreshToken: null` in `.credentials.json`.
- Claude Code logins are exclusive under `loginChanges`. `EngineAccountsModule` is held by `AppModule` only; tests override `ClaudeCodeAccounts`, `CodexAccounts`, `CopilotCliAccounts`; the end-to-end service binds the `StandIn…Accounts`.
- Strict MCP config is always on (a Project's `.mcp.json` would otherwise start). The API loop judges an MCP call once, before it runs; Office tools are judged again as they run.
- The Office rules hook is the only fence of Read/Grep/Glob (the engine's read fence is off). `readableInSecrets` is an allow-list (`engines/<id>/projects/` only). Workstation sessions judge secrets before their own folders (`SecretPaths.byPath`).
- The container runtime deny's accepted limit: an indirect call (an npm script running `docker compose`) passes ([docs/container-runtime.md](../../../../../docs/container-runtime.md)). A new writing program goes in `WRITING_PROGRAMS`, a path-valued option in `PATH_VALUED`.
- `.devcontainer/` writes are refused naming `WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL` (declared in `office-rules.ts`).
- Codex: the MCP endpoint lists tools without annotations (a read-only annotation would run unjudged); its token goes only in the `Authorization` header config; `RuledMcpCalls` lets through only calls the rules allowed.
- Gemini CLI: the relay exits 2 on every failure (exit 1 lets the call run); never run the relay with `spawnSync`; settings go in `<home>/.gemini/settings.json`, never `GEMINI_CLI_SYSTEM_SETTINGS_PATH`; a turn fails while the folder holds `.gemini/settings.json`; the context size comes from a private chat record a CLI bump may change.
- Copilot CLI: `mode: "empty"` needs `tools.availableTools`; a token account may list no models (only Auto runs); `tool.execution_start` comes before `onPreToolUse`; `end` must `endDescendants`.
- The used-up state is in memory only, on purpose; timed checks use `Schedule.every`, never a chained `once`; `UsageWindowState` times resets on the platform `Schedule`.
- The chat completions client doesn't use `fetch` (its ~300 s waits are too short). Each test has its own fake server.
- Keep the `-p` fallback's Office tool answers on the binary's input (a separate channel overtook `next` on Windows).
- Background events may come between turns: read a session's events while it lives; the Engine keeps none.
- The engine check keeps its own copy of the carry-over (`tools/engine-check/src/session-carry-over.ts`): change both. Re-run the [engine check](../../../../../docs/engine-check.md) on every SDK bump.
- `engineThroughStandIns` is the one mapping for Work and Conversations; change its fallback there alone.
- `PostgresEngineSettings.read` goes through platform `readOnce`; writes through `forgettingReads`.
- Metric attributes never carry ids; the estimate never adds the reported cost.
- Test instances: `EngineSessions.start`/`resume` throw `EngineRefused` and no checks or model lists run.
- Live adapter tests run only with `OFFICE_ENGINE_TESTS=live|record` ([testing](../../../docs/testing.md)); recordings replay in the default run (`CopilotReplay`, `REPLAYING_APP_SERVER`).

## Spec

- [5.4 The engine](../../../../../docs/spec/5.4-the-engine.md), [5.4.1 Engine kinds](../../../../../docs/spec/5.4.1-engine-kinds.md), [5.4.2 OpenAI-compatible API](../../../../../docs/spec/5.4.2-openai-compatible-api-engine.md), [5.4.3 Codex](../../../../../docs/spec/5.4.3-codex-engine.md)
- [5.4.4 Copilot CLI](../../../../../docs/spec/5.4.4-copilot-cli-engine.md), [5.4.5 Engines and cascade](../../../../../docs/spec/5.4.5-engines-and-cascade.md), [5.4.6 Stand-in Engines](../../../../../docs/spec/5.4.6-stand-in-engines-and-usage-windows.md), [5.4.7 Gemini CLI](../../../../../docs/spec/5.4.7-gemini-cli-engine.md)
- [2.9 Sub-agents and Processes](../../../../../docs/spec/2.9-sub-agents-and-processes.md), [6 Permissions](../../../../../docs/spec/6-permissions-and-safety.md)

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

EngineSessions, StandInOptions, EngineRefused, EngineCapability, OfficeToolRegistry, DraftedOfficeCall, canonicalJson, fingerprintOf, officeActionTool, SECRET_VALUES_GROUP, withSecretValues, SecretValuesOfCall, officeActionDraft, OfficeActionSubjectSnapshot, OfficeToolRuled, OfficeToolRuling, CommandJudgement, OfficeTool, OfficeToolCall, OfficeToolApplication, OfficeToolAuthority, OfficeToolChangedField, OfficeToolDraft, OfficeToolRedactedInput, OfficeToolPicture, OfficeToolResult, OfficeToolSubject, OfficeToolUser, ToolArea, CORE_AREA, UsageWindowState, UsageWindowReading, UsedUpUsageWindow, UsageWindowSamples, UsageWindowsNow, EngineUsageWindowsNow, EngineWindowsNow, UsageWindowRatios, EngineAdded, EngineDown, EngineRemoved, SkillCalled, UsageWindowReset, UsageWindowsChanged, UsageWindowsRead, UsageWindowUsedUp, EngineModels, StandInEngineSettings, EngineModelLists, usageWindowWords, showsFree, UsageWindowName, EngineSettingsChecks, EngineCascadeSettings, EngineSettingsSave, EngineReferenceMoves, EngineReferences, EngineReferenceLock, movedEngineId, movedEngineOverride, movedStandInList, EngineRemoval, MovedEngineReference, effortsTakenBy, ENGINE_TYPE_NAMES, FIRST_CLAUDE_CODE_ENGINE, hasUsageWindows, offeredModels, Effort, Engine, EngineId, EngineKind, EngineModel, OfficeDefault, engineTypeOffersOf, modelEffortProblems, EngineTypeOffers, ModelAndEffortSetting, engineThroughStandIns, engineToRunOn, standInListProblems, standInListWithout, EngineStandInChoice, StandInNeeds, DayUsage, ModelDayUsage, ModelPrices, READ_ONLY_GIT_COMMANDS, READ_ONLY_SHELL_RULE, WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL, RUN_PROJECT_COMMAND_TOOL, EngineModule, EngineAccountsModule, ScriptedEngine, CarriedSession, ScriptedEngineProcess, readRecording, SessionScript, ScriptedEngineModule, ClaudeCodeAccounts, StandInClaudeCodeAccounts, CodexAccounts, StandInCodexAccounts, CopilotCliAccounts, StandInCopilotCliAccounts, OPENAI_COMPATIBLE_API_CAPABILITIES, CODEX_CAPABILITIES, COPILOT_CLI_CAPABILITIES, GEMINI_CLI_CAPABILITIES, NewSession, NoEngineListed, SessionNotCarried, EngineSession, ApprovalCall, ApprovalHold, HomeAreas, OfficeToolLoading

## Domain events

- `domain/engine-events.ts`: UsageWindowsChanged, UsageWindowUsedUp, UsageWindowReset, UsageWindowsRead, EngineAdded, EngineRemoved, EngineAccountChanged, EngineModelsListed, WindowStartSettingsChanged, WindowStartRecorded, SkillCalled, EngineDown

## HTTP routes (under `/api`)

- `GET /settings/engines/:engineId/account`: EngineAccountsController.account
- `POST /settings/engines/:engineId/sign-in`: EngineAccountsController.signIn
- `POST /settings/engines/:engineId/sign-in/code`: EngineAccountsController.enterCode
- `PUT /settings/engines/:engineId/token`: EngineAccountsController.setPastedToken
- `PUT /settings/engines/:engineId/api-key`: EngineAccountsController.setApiKey
- `DELETE /settings/engines/:engineId/sign-in`: EngineAccountsController.signOut
- `GET /settings/engines`: EngineSettingsController.read
- `GET /settings/engines/:engineId/removal`: EngineSettingsController.removalPreview

## Tables

- `adapters/postgres/day-usage.schema.ts`: engine_day_usage
- `adapters/postgres/engine-settings.schema.ts`: engines, engine_settings, model_prices
- `adapters/postgres/model-lists.schema.ts`: engine_model_lists
- `adapters/postgres/usage-window-samples.schema.ts`: usage_window_samples
- `adapters/postgres/window-starts.schema.ts`: engine_window_starts

## Files

### ./

- `engine-accounts.module.ts`: EngineAccountsModule
- `engine-settings.module.ts`: EngineSettingsModule
- `engine.module.ts`: EngineModule
- `index.domain.ts`: canonicalJson, fingerprintOf, RUN_PROJECT_COMMAND_TOOL, EngineRemoval, engineTypeOffersOf, modelEffortProblems, EngineTypeOffers, effortsTakenBy, ENGINE_TYPE_NAMES, hasUsageWindows, offeredModels, Engine, EngineId, EngineKind, EngineModel, READ_ONLY_SHELL_RULE, WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL, engineToRunOn, standInListProblems, standInListWithout, usageWindowWords
- `index.fixtures.ts`: apiEngineOnFakeServer, ApiEngineOnFakeServer, textReply, FakeChatCompletionsServer, EngineSettingsForTests, EngineSettingsRepository, CodexApiKey, EngineSettingsService, anOfficeToolCall, aPlainPng, RUN_EVERY_CALL
- `scripted-engine.module.ts`: ScriptedEngineModule

### adapters/agent-sdk/

- `agent-sdk-engine.ts`: AgentSdkEngine
- `model-list-read.ts`: listModelsOnSdk
- `sdk-options.fixtures.ts`: OPTIONS, PRE_TOOL_USE, CONFIG_FOLDER, optionsFor
- `sdk-options.ts`: SdkSession, sdkOptions, sdkMcpConfig
- `usage-window-read.ts`: SdkUsageRead, sdkUsageReadOptions, readUsageWindowsOnSdk, readOnSdk
- `usage-window-start.ts`: sdkWindowStartOptions, startUsageWindowOnSdk
- Tests: agent-sdk-engine.test.ts, model-list-read.test.ts, sdk-options.full.test.ts, sdk-options.test.ts, test-project-check.test.ts, usage-window-read.test.ts, usage-window-start.test.ts

### adapters/claude-code/

- `background-tasks.fixtures.ts`: READ_EVERY_MS, COUNTING_OUTPUT, backgroundCommand, subAgentAnsweredInForeground, taskStop, taskProgress, taskNotification, Wire, AdapterReading, playRecordedSession, backgroundEvents, RECORDED_EVENTS, recordedEvents
- `background-tasks.ts`: OUTPUT_READ_EVERY_MS, BackgroundTasks
- `claude-code-cli-accounts.fixtures.ts`: FAKE_CLAUDE, TOKEN, API_KEY, folder, officeData, accounts, setUpEachTest
- `claude-code-cli-accounts.ts`: ClaudeCodeCli, ClaudeCodeCliAccounts
- `engine-credentials.ts`: writePastedToken, writeApiKey, removeEngineCredentials, removeApiKey, apiKeyFileOf, apiKeyHelperOf, holdsLogin, holdsPastedToken
- `engine-task-folder.ts`: engineTaskFolder
- `language-server-plugin.ts`: languageServerManifest, writeLanguageServerPlugin
- `listed-models.ts`: listedClaudeModels
- `mcp-config-file.ts`: McpConfig, McpConfigFile
- `mcp-server-starts.ts`: McpServerStarts
- `office-rules-hook.ts`: HookRewrites, officeRulesHook
- `office-tool-deferral.ts`: CLAUDE_CODE_DEFERS_OFFICE_TOOLS, CLAUDE_CODE_OFFICE_TOOL_LOADING
- `sdk-events.fixtures.ts`: message, RESULT
- `sdk-events.ts`: sessionEvents, TurnTokens, toolResultText, RefusedTurns, usageWindows
- `session-carry-over.ts`: carrySessionOver, carrySessionBetweenFolders, folderRewrite
- `session-forget.ts`: forgetSessionFiles
- `session-mcp-servers.ts`: McpServerConfig, mcpServerConfigs
- `session-office-rules.ts`: ClaudeCodeSessionPlaces, claudeCodeOfficeRules
- `session-settings.ts`: sessionTools, sessionSettings, sessionEnvironment
- `start-check.fixtures.ts`: folder, skills, EngineAnswers, anEngine, setUpEachTest
- `start-check.ts`: StartCheckRequests, startCheckProblems, initProblems
- `stream-events.ts`: StreamEvents, userMessage, isInit, engineStopped
- `tool-refusals.ts`: ToolRefusals
- `usage-window-start.ts`: WINDOW_START_MODEL, resultTokens, windowStartOf
- Tests: background-tasks.full.test.ts, background-tasks.test.ts, claude-code-cli-accounts.full.test.ts, claude-code-cli-accounts.test.ts, engine-task-folder.full.test.ts, language-server-plugin.full.test.ts, listed-models.test.ts, mcp-config-file.test.ts, office-rules-hook.test.ts, refused-turns.test.ts, sdk-events.full.test.ts, sdk-events.test.ts, session-carry-over.test.ts, session-forget.test.ts, start-check.full.test.ts, start-check.test.ts, stream-events.full.test.ts, tool-refusals.full.test.ts

### adapters/claude-code-p/

- `claude-code-p-arguments.fixtures.ts`: OPTIONS, SKILLS, HOOK_URL, argumentsFor, flag, settingsOf
- `claude-code-p-arguments.ts`: TOKEN_VARIABLE, ClaudeCodePSession, claudeCodePArguments, claudeCodePMcpConfig, claudeCodePEnvironment
- `claude-code-p-engine.ts`: CLAUDE_CODE_P_CAPABILITIES, ClaudeCodePEngine
- `fake-claude-code-p.fixtures.ts`: FAKE_FIVE_HOUR_RESET, FAKE_SEVEN_DAY_RESET, FAKE_TURN_USAGE, FAKE_MODEL_ROWS, FakeClaudeCodePMode, fakeClaudeCodeP, FakeClaudeCodePRun, fakeClaudeCodePRuns
- `model-list-read.ts`: listModelsOnStreamJson
- `office-tool-server.fixtures.ts`: ALLOWED, noteTool, connected, result, callNote
- `office-tool-server.ts`: OfficeToolServer
- `pinned-binary.ts`: pinnedBinaryPath
- `session-endpoints.ts`: SESSION_ENDPOINTS_ROUTE, HOOK_ROUTE, EndpointSession, OpenEndpoints, SessionEndpoints
- `stream-json.fixtures.ts`: FakeEngine, all
- `stream-json.ts`: StreamMcpServer, StreamJson
- `usage-window-read.ts`: claudeCodePReadArguments, readUsageWindowsOnStreamJson, readOnStreamJson
- `usage-window-start.ts`: claudeCodePWindowStartArguments, startUsageWindowOnStreamJson
- Tests: background-tasks.test.ts, claude-code-p-arguments.full.test.ts, claude-code-p-arguments.test.ts, claude-code-p-engine.test.ts, model-list-read.test.ts, office-tool-server.full.test.ts, office-tool-server.test.ts, stream-json.full.test.ts, stream-json.test.ts, usage-window-read.full.test.ts, usage-window-read.test.ts, usage-window-start.test.ts

### adapters/codex/

- `codex-approvals.ts`: ShellTool, CodexRefusal, CodexApprovalAnswer, CodexApprovalParts, OUTSIDE_SANDBOX_REFUSAL, UNSEEN_COMMAND_REFUSAL, GRANT_ROOT_REFUSAL, CodexApprovals, codexShellTool, unwrappedCommand
- `codex-arguments.ts`: CodexConfigValue, DISABLED_CODEX_FEATURES, CODEX_OVERRIDES, codexAppServerArguments, tomlValue, codexEnvironment, CodexMcpServerConfig, codexMcpServers
- `codex-binary.ts`: pinnedCodexPath
- `codex-cli-accounts.fixtures.ts`: FAKE_CODEX, FakeCodexRun, folder, officeData, accounts, fakeCodexRuns, approve, setUpEachTest
- `codex-cli-accounts.ts`: CodexCli, CodexCliAccounts, pageAndCode, withoutTerminalCodes
- `codex-engine.ts`: CODEX_CAPABILITIES, CodexWireProcess, CodexEngineSetup, CODEX_ENGINE_SETUP, CodexAppServerEngine, listedCodexModels, codexInstructions, mainCheckout, DECLINED_CALLS, FILE_CHANGES
- `codex-events.ts`: CodexToolCall, itemCalls, fileChangeCallId, toolCallEvent, completedItemEvents, toolResult, refusalEvents, refusalNote, codexTokens, tokensSince, tokensBefore, mergedRateLimits, rateLimitEvent, usedUpWindow, TurnEnding, TurnAccount, turnEnding, TurnOutput, outputReader
- `codex-protocol.ts`: CodexUserInput, CodexApprovalPolicy, CodexSandboxMode, CodexThreadConfig, CodexThreadSettings, CodexRequests, CodexRequestMethod, CODEX_RESULTS, CodexListedModel, CodexTurn, CodexTurnError, CodexRateLimitSnapshot, CodexRateLimitWindow, CodexAgentMessageItem, CodexCommandExecutionItem, CodexFileChangeItem, CodexFileUpdateChange, CodexMcpToolCallItem, CodexOtherItem, CodexThreadItem, CodexNotification, CodexTokenUsage, codexNotification, COMMAND_APPROVAL, FILE_CHANGE_APPROVAL, PERMISSIONS_APPROVAL, MCP_ELICITATION, CodexServerRequest, CodexCommandApprovalParams, CodexFileChangeApprovalParams, CodexElicitationParams, codexServerRequest, codexUserInput
- `codex-rpc.ts`: METHOD_NOT_FOUND, INVALID_PARAMS, INTERNAL_ERROR, CodexRpcError, CodexExit, CodexRpcHandlers, CodexWireDirection, CodexWireTap, CodexRpc, CodexAppServer, codexExitWords
- `codex-session.ts`: CodexConnect, CodexSessionParts, CodexSession, codexEffort
- `codex-thread-file.ts`: CodexThreadMissing, CodexThreadFile
- `codex-usage-window-start.ts`: CODEX_WINDOW_START_MODEL, CODEX_WINDOW_START_EFFORT, codexWindowStartThread, CodexWindowStart, startCodexUsageWindow
- `codex-usage-windows.ts`: FIVE_HOURS_MINUTES, SEVEN_DAYS_MINUTES, unknownWindowLengths, codexUsageWindows, codexWindowsOf, codexResetOf, usedUp
- `codex-wire-recording.fixtures.ts`: CodexWireLine, WIRE_PLACEHOLDERS, CodexWireRecorder, readWireRecording
- `fake-app-server.fixtures.ts`: FAKE_FIVE_HOUR_RESET, FAKE_SEVEN_DAY_RESET, FAKE_MODEL_PAGES, FAKE_APP_SERVER, fakeAppServer, FakeAppServerRun, fakeAppServerRuns
- `fake-codex-app-server.fixtures.ts`: REPLAYING_APP_SERVER, replayingAppServer, unreplayedAppServers
- `ruled-mcp-calls.ts`: UNRULED_MCP_CALL_REFUSAL, RuledMcpCalls
- `session-mcp-endpoint.ts`: SessionMcpEndpointParts, SessionMcpEndpoint
- Tests: codex-approvals.test.ts, codex-arguments.test.ts, codex-binary.test.ts, codex-cli-accounts.full.test.ts, codex-engine.test.ts, codex-events.test.ts, codex-instructions.test.ts, codex-rpc.test.ts, codex-usage-windows.test.ts, ruled-mcp-calls.test.ts, session-mcp-endpoint.test.ts

### adapters/copilot-cli/

- `copilot-cli-engine.ts`: COPILOT_CLI_CAPABILITIES, OPEN_COPILOT_SESSION, OPEN_COPILOT_MODEL_RUNTIME, CopilotSdkEngine, availableTools, copilotMcpServers
- `copilot-cli-session.ts`: CopilotSessionSkills, CopilotCliSessionParts, CopilotCliSession, sessionSkillName
- `copilot-environment.ts`: copilotEnvironment
- `copilot-events.fixtures.ts`: copilotEvent, userMessage, answer, usage, toolStart, toolDone, toolDenied, idle, READ_A_FILE_TURN
- `copilot-events.ts`: CopilotContextUsage, CopilotTurnOptions, copilotTokens, CopilotTurnEvents
- `copilot-model-list.ts`: CopilotListedModel, CopilotModelRuntime, OpenCopilotModelRuntime, sdkCopilotModelRuntimes, listModelsOnCopilotRuntime, listedCopilotModels
- `copilot-recording.fixtures.ts`: CopilotRecordingLine, CopilotRecorder, CopilotReplay
- `copilot-runtime.fixtures.ts`: StandInStep, HookedCall, StandInCopilotRuntime
- `copilot-runtime.ts`: CopilotToolCall, CopilotToolDecision, CopilotOfficeTool, CopilotSessionSpec, CopilotSessionHandlers, CopilotListedSkill, CopilotAttachment, CopilotMessage, CopilotRuntimeSession, OpenCopilotSession, CopilotEvent
- `copilot-sdk-accounts.ts`: CopilotSdkAccounts
- `copilot-sign-in-runtime.ts`: CopilotSignInStatus, CopilotDeviceLogin, CopilotSignInRuntime, OpenCopilotSignInRuntime, sdkSignInRuntimes
- `copilot-tool-actions.ts`: JudgedCall, DisplayedCall, CopilotToolSession, CopilotToolJudgement, copilotToolCall, copilotDecision
- `sdk-copilot-sessions.ts`: sdkCopilotSessions
- Tests: copilot-cli-engine.test.ts, copilot-events.test.ts, copilot-model-list.test.ts, copilot-sdk-accounts.test.ts, copilot-tool-actions.test.ts

### adapters/engine-folders/

- `engine-config-folder.fixtures.ts`: SESSION_ID, officeData, configFolder, decide, keptFile, setUpEachTest
- `engine-config-folder.ts`: engineConfigFolder, preparedEngineConfigFolder, NotAnEngineConfigFolder, ownEngineConfigFolder, engineIdsWithConfigFolders, removeEngineConfigFolder
- Tests: engine-config-folder.full.test.ts, engine-config-folder.test.ts

### adapters/gemini-cli/

- `fake-gemini-cli.fixtures.ts`: FAKE_GEMINI_REPORT_VARIABLE, writeFakeGeminiCli, FakeGeminiRun, fakeGeminiRuns
- `gemini-cli-capabilities.ts`: GEMINI_CLI_CAPABILITIES
- `gemini-cli-engine.ts`: GEMINI_CLI_ENTRY, GeminiCliHeadlessEngine
- `gemini-cli-homes.ts`: GeminiCliEngineFolders
- `gemini-cli-session.ts`: GeminiTurnCommand, GeminiSessionParts, GeminiCliSession
- `gemini-context-usage.ts`: GEMINI_CLI_CONTEXT_WINDOW, recordedContextTokens
- `gemini-environment.ts`: GEMINI_API_KEY_VARIABLE, GeminiProcessPlaces, geminiEnvironment, geminiCommandEnvironment
- `gemini-events.fixtures.ts`: TURN_WITH_A_REFUSAL, QUOTA_REFUSAL, EMPTY_ANSWER
- `gemini-events.ts`: GeminiStreamStats, GeminiStreamEvent, parsedStreamLine, turnTokens, HookRefusals, TurnEnding, GeminiTurnEvents
- `gemini-office-relay.ts`
- `gemini-session-files.ts`: GeminiSessionFileContents, preparedGeminiSessionHome, GeminiSessionFiles
- `gemini-settings.ts`: GEMINI_CORE_TOOLS, HOOK_TIMEOUT_MS, geminiMcpToolName, RelayServer, GeminiSettingsParts, geminiSettings
- `gemini-tool-actions.ts`: GeminiCall, GeminiToolJudgement, GeminiToolSession, GeminiToolUse, geminiToolCall, displayedCall, geminiDecision
- `office-channel.ts`: BeforeToolInput, HookAnswer, ChannelHandlers, ChannelPlace, OfficeChannel
- `pinned-gemini-cli.ts`: pinnedGeminiCliEntry
- `session-tool-servers.ts`: SessionToolServerParts, SessionToolServers
- Tests: gemini-cli-engine.test.ts, gemini-events.test.ts, gemini-office-relay.test.ts, gemini-tool-actions.test.ts

### adapters/http/

- `engine-account-refusal.filter.ts`: EngineAccountRefusalFilter
- `engine-accounts.controller.ts`: EngineAccountsController
- `engine-office-actions.controller.ts`: EngineOfficeActionsController
- `engine-settings-refusal.filter.ts`: EngineSettingsRefusalFilter
- `engine-settings-responses.ts`: engineSettingsResponseOf, engineResponse
- `engine-settings.controller.ts`: EngineSettingsController
- `session-endpoints.controller.ts`: SessionEndpointsController
- `session-endpoints.fixtures.ts`: ServedEndpoints, serveSessionEndpoints
- Tests: engine-accounts.controller.full.test.ts, engine-accounts.controller.test.ts, engine-model-lists.controller.test.ts, engine-settings.controller.full.test.ts, engine-settings.controller.test.ts, session-endpoints.controller.test.ts

### adapters/language-servers/

- `workstation-language-servers.ts`: WorkstationLanguageServers
- Tests: workstation-language-servers.full.test.ts

### adapters/mcp-servers/

- `contract-mcp-server.fixtures.ts`: CONTRACT_MCP_SERVER
- `mcp-server-connections.ts`: McpToolAnswer, McpServerConnections
- `server-values.ts`: withoutServerValues

### adapters/office-actions/

- `engine-office-actions.ts`: EngineCaller, EngineOfficeActions
- Tests: engine-office-actions.test.ts

### adapters/office-rules/

- `foreground-sub-agents.ts`: SUB_AGENT_TOOLS, foregroundSubAgentInput, callAsRun
- `office-tool-call.ts`: ToolDecider, sessionTemporaryFolder, removeSessionTemporaryFolder, officeToolCall
- `office-tool-names.ts`: OFFICE_TOOL_SERVER, OFFICE_TOOL_PREFIX, mcpToolName, mcpToolOf, portToolName
- `session-office-rules.ts`: EngineRuleParts, sessionOfficeRules
- `tool-actions.ts`: agentAction
- `tool-decision.ts`: SessionHolds, toolDecision
- Tests: foreground-sub-agents.test.ts, office-tool-call.test.ts, session-office-rules.test.ts, tool-actions.test.ts, tool-decision.test.ts

### adapters/office-tools/

- `office-action-draft.ts`: OfficeActionSubjectSnapshot, officeActionDraft
- `office-action-tool.ts`: officeActionTool
- `secret-values-tool.ts`: SECRET_VALUES_GROUP, SecretValuesOfCall, withSecretValues

### adapters/openai-compatible-api/

- `api-engine-on-fake-server.fixtures.ts`: ApiEngineOnFakeServer, apiEngineOnFakeServer
- `api-session.ts`: ApiSessionParts, ApiSession
- `background-commands.ts`: BackgroundStart, BackgroundStop, ProcessEvent, OUTPUT_READ_INTERVAL_MS, BackgroundCommands
- `built-in-tool.ts`: ToolOutput, SessionToolContext, ToolContext, ReadFiles, PreparedCall, InvalidCall, BuiltInTool, builtInTool, success, failure, engineRefusal, resolvedPath
- `chat-completions-client.ts`: ChatCompletionsTimeouts, DEFAULT_CHAT_COMPLETIONS_TIMEOUTS, CompletionTextEvent, CompletionEndedEvent, CompletionEvent, ChatCompletionsError, ChatCompletionsEndpoint, ChatCompletionsClient, chatCompletionsUrl
- `chat-completions.ts`: ToolCall, SystemMessage, TextPart, ImagePart, UserContentPart, UserMessage, AssistantMessage, ToolMessage, ChatMessage, ToolDefinition, ChatCompletionsRequest, ToolCallDelta, CompletionUsage, completionChunkSchema, CompletionChunk, STREAM_DONE
- `completion-assembly.ts`: Completion, CompletionAssembly
- `conversation-file.ts`: ConversationMissing, ConversationFile
- `edit-tool.ts`: EDIT_TOOL, editedContent
- `fake-chat-completions-server.fixtures.ts`: ScriptedToolCall, ScriptedUsage, ScriptedReply, ScriptedStatus, ScriptedSilence, ScriptedFromRequest, ScriptedAnswer, AnswerEnd, RecordedRequest, FakeChatCompletionsServer, textReply
- `file-listing.ts`: ListedFile, listedFiles
- `file-tools.fixtures.ts`: folder, context, run, files, setUpEachTest
- `glob-tool.ts`: GLOB_TOOL
- `grep-tool.ts`: GREP_TOOL
- `mcp-tool.ts`: mcpBuiltInTool
- `office-tool.ts`: CallJudge, officeBuiltInTool
- `openai-compatible-api-engine.fixtures.ts`: USAGE, fake, officeData, eachTestOnAFakeServer, endpoint, engineOn, toolCall, READ_ONLY, untilTurnEnds
- `openai-compatible-api-engine.ts`: OPENAI_COMPATIBLE_API_CAPABILITIES, OpenAiCompatibleApiEngine
- `project-instructions.ts`: InstructionFile, projectInstructions
- `read-tool.ts`: READ_TOOL
- `server-sent-events.ts`: ServerSentEvents
- `session-tools.ts`: SessionToolParts, SessionTools
- `shell-command.ts`: CommandLine, ShellSpawn, shellSpawn, ShellCommand, CommandEnding, runShellCommand
- `shell-tool.ts`: shellTool
- `skill-tool.ts`: skillTool
- `structured-output-tool.ts`: structuredOutputTool
- `system-prompt.ts`: SystemPromptParts, systemPrompt
- `task-stop-tool.ts`: taskStopTool
- `text-search.ts`: SearchContext, TextSearch, textSearch, splitLines, matchCount, matchingLines
- `user-content.ts`: userContent, joinedContent, ESTIMATED_IMAGE_TOKENS, withoutImageData, imageCount
- `web-fetch-tool.ts`: webFetchTool
- `web-page.ts`: WebPageLimits, DEFAULT_WEB_PAGE_LIMITS, WebPage, fetchWebPage, sizeInWords, isWebUrl
- `web-search-tool.ts`: webSearchTool
- `write-tool.ts`: WRITE_TOOL
- Tests: chat-completions-client.full.test.ts, file-tools.full.test.ts, file-tools.test.ts, office-tool.test.ts, openai-compatible-api-engine.full.test.ts, openai-compatible-api-engine.test.ts, server-sent-events.full.test.ts, system-prompt.test.ts, user-content.full.test.ts, web-tools.full.test.ts

### adapters/postgres/

- `day-usage.schema.ts`: engineDayUsage
- `engine-settings.schema.ts`: engines, engineSettings, modelPrices
- `model-lists.schema.ts`: engineModelLists
- `postgres-day-usage.ts`: PostgresDayUsage
- `postgres-engine-settings.ts`: PostgresEngineSettings
- `postgres-model-lists.ts`: PostgresModelLists
- `postgres-usage-window-samples.ts`: PostgresUsageWindowSamples
- `postgres-window-starts.ts`: PostgresWindowStarts
- `usage-window-samples.schema.ts`: usageWindowSamples
- `window-starts.schema.ts`: engineWindowStarts
- Tests: engine-default-effort-migration.test.ts, postgres-day-usage.test.ts, postgres-engine-settings.test.ts, postgres-model-lists.test.ts, postgres-usage-window-samples.test.ts, postgres-window-starts.test.ts

### adapters/prompt-templates/

- `engine-prompt-templates.fixtures.ts`: defaultEnginePromptTemplates
- `engine-prompt-templates.ts`: EnginePromptTemplates
- Tests: engine-prompt-templates.test.ts

### adapters/scripted/

- `no-language-servers.ts`: NoLanguageServers
- `recording-engine.ts`: RecordingEngine
- `scripted-engine.ts`: DEFAULT_WINDOW_START, CarriedSession, ScriptMismatch, ScriptedEngineProcess, ScriptedEngine, ScriptedSession
- `session-script.ts`: ScriptStep, RecordedImage, RecordedMessage, recordedMessage, EventStep, WaitStep, CallerStep, CallerRequest, ReadStep, SessionScript, RecordedPlaces, PLACEHOLDERS, readRecording, writeRecording, withBriefIds, inPlaces
- `stand-in-claude-code-accounts.ts`: STAND_IN_SIGN_IN_PAGE, STAND_IN_ACCOUNT, STAND_IN_PASTED_TOKEN_ACCOUNT, StandInClaudeCodeAccounts
- `stand-in-codex-accounts.ts`: STAND_IN_CODEX_SIGN_IN_PAGE, STAND_IN_CODEX_USER_CODE, STAND_IN_CODEX_ACCOUNT, StandInCodexAccounts
- `stand-in-copilot-cli-accounts.ts`: STAND_IN_COPILOT_CLI_SIGN_IN_PAGE, STAND_IN_COPILOT_CLI_USER_CODE, STAND_IN_COPILOT_CLI_ACCOUNT, StandInCopilotCliAccounts
- Tests: scripted-engine.test.ts

### adapters/searxng/

- `fake-searxng-server.fixtures.ts`: FakeSearxngServer
- `searxng-client.ts`: SEARXNG_TIMEOUT_MS, SearxngClient, searchUrl

### adapters/shared/

- `engine-process.ts`: EngineCommand, EngineProcess
- `engine-read.ts`: READ_EXIT_GRACE_MS, serviceVariables, EngineReadLimits, engineRead
- `office-tools.ts`: OFFICE_TOOL_PICTURE_LIMIT, officeToolAnswer, textAnswer
- `png.fixtures.ts`: aPlainPng, aNoisyPng
- `unseen-image-line.ts`: unseenImageLine
- `usage-window-start.ts`: WINDOW_START_PROMPT, windowStartWhat, requireUsageWindows
- Tests: office-tools.test.ts

### adapters/skills/

- `file-problems.ts`: fileProblem, isMissing, isBinary
- `json-text.ts`: parsedJson
- `listed-skills.ts`: ListedSkill, listedSkills, modelListing
- `markdown-file.ts`: MarkdownFile, markdownFile, frontmatterText, frontmatterFlag, isUserOnly, markdownFilesIn, textOrNone
- `skill-loading.ts`: SkillLoading, SKILL_TOOL_INPUT, skillCalled, skillCommandText, skillToolDescription

### adapters/structured-output/

- `structured-output.ts`: STRUCTURED_OUTPUT_TOOL, STRUCTURED_OUTPUT_DESCRIPTION, STRUCTURED_OUTPUT_TAKEN, OUTPUT_REMINDERS, missingOutputError, OutputCheck, outputCheck

### adapters/websocket/

- `engine-web-events.ts`: EngineWebEvents

### application/

- `agent-engines.ts`: EngineAdapter, AgentEngines
- `changed-account-usage.ts`: ChangedAccountUsage
- `day-usage.ts`: DayUsage
- `engine-accounts.ts`: NotAClaudeCodeEngine, NotAnEngineTakingAToken, NotAnEngineWithAnApiKey, NotAnEngineWithASignIn, NotAnEngineWithAnAccount, StartedSignIn, EngineAccounts
- `engine-call-spans.ts`: SessionTelemetry, SessionCosts, promptFeatures, EndedCall, CallCost, engineCallRecord, EngineCallSpans
- `engine-model-lists.ts`: MODEL_REFUSAL_REFRESH_GAP_MS, ModelListRefresh, EngineModelLists
- `engine-models.ts`: EngineModels, StandInEngineSettings
- `engine-reference-lock.ts`: EngineReferenceLock
- `engine-reference-moves.ts`: EngineReferences, EngineReferenceMoves
- `engine-sessions.ts`: SessionSettings, SessionStart, EngineSessions, StandInOptions
- `engine-settings-checks.ts`: EngineCascadeSettings, engineCascadeSettingsOf, EngineSettingsSave, EngineSettingsCheck, EngineSettingsChecks
- `engine-settings-service.ts`: EngineSettingsService, EngineRemovalPreview, EngineWindowStartEdit, EngineSettingsChange, EngineModelChoices, EngineWindowStart, EngineWindowStarts
- `model-prices.ts`: ModelPrices
- `next-window-starts.ts`: NextWindowStarts
- `office-tool-pair.ts`: LIST_OFFICE_TOOLS, CALL_OFFICE_TOOL, officeToolPair
- `office-tool-registry.ts`: DraftedOfficeCall, OfficeToolRegistry
- `office-tool-split.ts`: HomeAreas, SplitOfficeTools, splitByArea
- `removed-engine-usage.ts`: RemovedEngineUsage
- `running-engine-sessions.ts`: RunningEngineSessions
- `stale-model-lists.ts`: StaleModelLists
- `usage-window-checks.ts`: USAGE_WINDOW_CHECK_EVERY, USAGE_WINDOW_CHECK, UsageWindowChecks
- `usage-window-readings.ts`: UsageWindowReadings
- `usage-window-samples.ts`: UsageWindowSamples
- `usage-window-state.ts`: UsageWindowReading, UsedUpUsageWindow, UsageWindowState
- `usage-window-telemetry.ts`: UsageWindowTelemetry
- `usage-windows-now.ts`: EngineWindowsNow, EngineUsageWindowsNow, UsageWindowsNow
- `window-starts.ts`: WINDOW_START, WindowStarts
- Tests: agent-engines.test.ts, changed-account-usage.full.test.ts, engine-model-lists.test.ts, engine-models.full.test.ts, engine-sessions.full.test.ts, engine-sessions.test.ts, model-prices.full.test.ts, office-tool-pair.test.ts, office-tool-registry.full.test.ts, removed-engine-usage.full.test.ts, stand-in-sessions.full.test.ts, usage-window-checks.test.ts, usage-window-samples.full.test.ts, usage-window-state.full.test.ts, usage-window-telemetry.full.test.ts, usage-window-used-up.test.ts, usage-windows-now.full.test.ts, window-starts.test.ts

### domain/

- `agent-action.ts`: AgentAction
- `anthropic-api-key.ts`: NotAnAnthropicApiKey, AnthropicApiKey
- `api-endpoints.ts`: ApiEndpointModel
- `canonical-json.ts`: canonicalJson, fingerprintOf
- `codex-api-key.ts`: NotACodexApiKey, CodexApiKey
- `container-runtime-commands.ts`: CONTAINER_RUNTIME_PROGRAMS, RUN_PROJECT_COMMAND_TOOL, CONTAINER_RUNTIME_VARIABLES, withoutContainerRuntimeVariables, containerRuntimeReach
- `copilot-cli-token.ts`: NotACopilotCliToken, CopilotCliToken
- `day-usage.ts`: dayOf
- `directory-change.ts`: DirectoryChange, directoryChange
- `engine-account.ts`: EngineAccount, SIGNED_OUT_ACCOUNT, API_KEY_ACCOUNT, PASTED_TOKEN_ACCOUNT, EngineAccountUnreadable, engineAccountOf, CodexAccountRead, codexEngineAccountOf
- `engine-events.ts`: UsageWindowsChanged, UsageWindowUsedUp, UsageWindowReset, UsageWindowsRead, EngineAdded, EngineRemoved, EngineAccountChanged, EngineModelsListed, WindowStartSettingsChanged, WindowStartRecorded, SkillCalled, EngineDown
- `engine-prompt-templates.ts`: DECLINED_CALLS, FILE_CHANGES, API_SYSTEM_PROMPT, API_OUTPUT_REMINDER, GEMINI_OUTPUT_REMINDER, CODEX_INSTRUCTIONS, ENGINE_PROMPT_TEMPLATES
- `engine-refused.ts`: EngineRefused
- `engine-removal.ts`: EngineRemoval, MovedEngineReference, MovedWork, MovedTaskState, MovedInitiativeState, movedEngineOverride, movedEngineId, movedStandInList, engineRemovalAmong
- `engine-settings-refused.ts`: EngineSettingsRefused, ENGINES_CHANGED_MEANWHILE
- `engine-settings.fixtures.ts`: strata, codex, codexEdit, stored, claudeCodeEdit, strataEdit, editOf, refusal
- `engine-settings.ts`: SearchEndpoint, EngineSettings, DEFAULT_ASK_BEFORE_SWITCH_ABOVE, ASK_BEFORE_SWITCH_ABOVE_MOST, FIRST_OFFICE_DEFAULT, DEFAULT_ENGINE_SETTINGS, ClaudeCodeEngineEdit, ApiEngineEdit, CodexEngineEdit, CopilotCliEngineEdit, GeminiCliEngineEdit, EngineEdit, EngineSettingsEdit, ENGINE_NAME_LENGTH, offeredModelPrices, changedEngineSettings, officeDefaultEngineModel, settingsWithoutEngine
- `engine-type-offers.ts`: EngineTypeOffers, ModelAndEffortSetting, engineTypeOffersOf, modelEffortProblems
- `engines.ts`: EngineId, EngineKind, ENGINE_TYPE_NAMES, Effort, effortsTakenBy, ClaudeCodeEngine, ApiEngine, CodexEngine, CopilotCliEngine, GeminiCliEngine, Engine, CLAUDE_CODE_MODELS, CODEX_MODELS, COPILOT_CLI_AUTO_MODEL, COPILOT_CLI_MODELS, GEMINI_CLI_MODELS, FIRST_CLAUDE_CODE_ENGINE, engineIdFor, offeredModels, listsItsModels, hasUsageWindows, pricedPerEngine, EngineModel, OfficeDefault
- `gemini-api-key.ts`: NotAGeminiApiKey, GeminiApiKey
- `git-commands.ts`: READ_ONLY_GIT_COMMANDS, isGit, gitChange
- `language-servers.ts`: LanguageServer, LANGUAGE_SERVERS, withLeftOutLanguageServers
- `model-lists.ts`: EngineModelList, MODEL_LIST_REFRESH_AGE_MS, MODEL_LIST_ASK_GAP_MS, modelListIsStale
- `model-prices.ts`: ModelPrice, PricedModel, OfferedModel, OfferedOn, pricedModels, keptModelPrices, priceOf
- `office-reach-commands.ts`: OfficeReach, officeReach
- `office-rules.ts`: ToolDecision, WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL, READ_ONLY_SHELL_RULE, OfficeRules
- `pasted-token.ts`: NotAPastedToken, PastedToken
- `permission-profile.ts`: CommandPermission, PermissionProfile, McpToolSetting, ApprovalSetting
- `secret-paths.ts`: SecretPaths
- `session-rules.ts`: PathSemantics, ReadableInSecret, SessionRules
- `shell-commands.ts`: ShellDialect, Redirect, SimpleCommand, UnreadableCommand, simpleCommands, programWords, programName
- `skill-calls.ts`: SKILL_TOOL, skillNameOf, calledSkill
- `skill-listing.ts`: listingProblems
- `stand-in-engines.ts`: EngineStandInChoice, StandInNeeds, engineThroughStandIns, engineToRunOn, standInListProblems, standInListWithout
- `usage-window-samples.ts`: POOLED_SAMPLES, PairedReading, UsageWindowSample, UsageWindowRatios, NO_USAGE_WINDOW_RATIOS, sampleBetween, pooledRatios
- `usage-window-words.ts`: usageWindowWords
- `usage-windows.ts`: UsageWindow, ReadingSource, UsageWindows, showsFree, sameUsageWindows, USAGE_WINDOW_NAMES, KnownUsageWindowName, UsageWindowName
- `window-starts.ts`: WINDOW_START_WEEKLY_LIMIT_PERCENT, WINDOW_START_AFTER_RESET_DELAY, MAX_WINDOW_START_TIMES, WindowStartSettings, NO_WINDOW_START, WindowStartTrigger, WindowStartSkipReason, WindowStartRecord, NextWindowStart, WindowStartJudgement, windowStartSkipReason, nextWindowStart, windowStartTimeProblems, sortedWindowStartTimes
- `written-paths.ts`: writtenPaths
- Tests: anthropic-api-key.test.ts, canonical-json.test.ts, copilot-cli-token.test.ts, directory-change.test.ts, engine-account.full.test.ts, engine-removal.full.test.ts, engine-settings.full.test.ts, engine-settings.test.ts, engines.full.test.ts, gemini-api-key.test.ts, office-reach-commands.test.ts, office-rules.test.ts, pasted-token.test.ts, shell-commands.test.ts, skill-calls.full.test.ts, stand-in-engines.test.ts, usage-window-samples.full.test.ts, usage-windows.test.ts, window-starts.test.ts

### ports/

- `agent-engine.contract.ts`: CONTRACT_SCENARIOS, ContractScenario, SESSIONLESS_SCENARIOS, EngineUnderContract, ContractMcpServer, describeAgentEngineContract
- `agent-engine.ts`: EngineCapabilities, OfficeToolLoading, EngineCapability, missingCapabilities, CapabilityMissing, SessionSkillsDiffer, ModelNotOffered, EngineNotListed, NoEngineListed, SessionNotCarried, ENGINE_READ_TIMEOUT_MS, EngineReadTimedOut, UsageWindowStart, NewSession, AgentEngine
- `claude-code-accounts.ts`: SignIn, SignInNotRunning, SignInFailed, ClaudeCodeAccounts
- `codex-accounts.ts`: CodexSignIn, CodexLoginFailed, CodexAccounts
- `copilot-cli-accounts.ts`: CopilotCliSignIn, CopilotCliLoginFailed, CopilotCliAccounts
- `day-usage-repository.fixtures.ts`: DayUsageForTests
- `day-usage-repository.ts`: ModelDayUsage, DayUsageRepository
- `engine-session.ts`: UserMessage, MessageImageContent, SkillCommand, MessagePriority, ContextUsage, EngineSession
- `engine-settings-repository.fixtures.ts`: EngineSettingsForTests
- `engine-settings-repository.ts`: EngineSettingsRepository
- `gemini-cli-homes.ts`: GeminiCliHomes
- `model-list-repository.fixtures.ts`: ModelListsForTests
- `model-list-repository.ts`: ModelListRepository
- `office-tool-ruling.fixtures.ts`: RUN_EVERY_CALL
- `office-tool-ruling.ts`: OfficeToolRuled, OfficeToolRuling
- `office-tool.fixtures.ts`: anOfficeToolCall
- `office-tool.ts`: CommandJudgement, OfficeToolCall, OfficeToolUser, OfficeToolPicture, OfficeToolResult, OfficeToolAuthority, OfficeToolRedactedInput, OfficeToolSubject, OfficeToolChangedField, OfficeToolDraft, OfficeToolApplication, ToolArea, CORE_AREA, OfficeTool
- `search-endpoint-client.ts`: SearchResult, SearchFailed, SearchEndpointClient
- `session-events.ts`: TokenUsage, NO_TOKENS, addedTokens, countedTokens, TextEvent, ToolCallEvent, ToolResultEvent, BackgroundEnding, SubAgentStartedEvent, SubAgentChangedEvent, SubAgentProgressEvent, SubAgentEndedEvent, ProcessStartedEvent, ProcessOutputEvent, ProcessEndedEvent, RefusedBy, ToolRefusedEvent, TurnTokensEvent, ContextReadEvent, TurnOutcome, UNKNOWN_RESET_RETRY_MS, UsedUpWindow, TurnEndedEvent, RateLimitStatus, RateLimitEvent, McpServerNotStartedEvent, BackgroundEvent, SessionEvent, KnownUsageWindowName, UsageWindowName
- `session-language-servers.ts`: PreparedLanguageServers, SessionLanguageServers
- `session-options.ts`: SessionSkills, SessionMcpServer, SessionMcpServerLaunch, SessionMcpServerTool, ToolHold, ApprovalCall, ApprovalHold, JsonSchema, SessionOptions, hasOfficeTools, Effort
- `usage-window-sample-repository.fixtures.ts`: UsageWindowSamplesForTests
- `usage-window-sample-repository.ts`: UsageWindowSampleRepository
- `window-start-repository.fixtures.ts`: WindowStartsForTests
- `window-start-repository.ts`: KeptWindowStart, WindowStartRepository
