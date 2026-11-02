# Engine: module map

**Owns:** the engines Settings › Engines lists (`Engine`, rows of `engines`: an id made from the name when added and kept on a rename, a name, a kind, `claude-code` with its `-p` switch or `openai-compatible-api` with an API endpoint's base URL, key and models, and a default model; the upgrade made the first Claude Code engine, `claude-code`, and an engine of each API endpoint), which caps, readings and each day's use are kept by, and which a Role card names by id; the models each offers, by their ids there (`EngineModels`: `offeredOn(engineId)`, which People's card checks ask, and `engines()`, which other modules list the engines through); the Office-wide settings of Settings › Engines in `EngineSettingsModule`, which both `EngineModule` and `ScriptedEngineModule` hold (`GET`/`PUT /api/settings/engines`: the engines in order, one left out removed, a new one given an id from its name (`engineIdFor`) apart from every listed engine's, each default model one it offers, the first Claude Code engine, `claude-code`, kept until step 3a of task 47 (`claudeCodeEngineProblems`), each engine added or removed announced as `EngineAdded` or `EngineRemoved` (its id and kind only, never an API key); each key never sent back, only `keySet`; the Office default (an engine listed and a model it offers) and the search endpoint in `engine_settings`, the Office default read as the first Claude Code engine on Sonnet while no row is kept; the Model prices in `model_prices`, one per Claude model shared by every Claude Code engine (engine id null) and one per API engine and model, only for models offered now, `GET` listing every offered model with its price or none; `ModelPrices.costOf` prices an engine's model by them, kind by kind, undefined with no price); the `AgentEngine` port and its adapters in `AgentEngines`, keyed by the way they run a session (`EngineAdapter`) and picked by the engine's kind, or `-p` when its switch is on: the Agent SDK adapter, the fallback's (`adapters/claude-code-p/`: the pinned binary in `-p`, stream-json in and out through `StreamJson`), and the scripted engine every other test runs on (`adapters/scripted/`). The OpenAI-compatible API adapter (`adapters/openai-compatible-api/`) is The Office's own agent loop: `OpenAiCompatibleApiEngine` runs on the API endpoint its options name (`SessionOptions.engine`) and one of its models (`ModelNotOffered` when the endpoint doesn't list it or the engine is no API endpoint, a refusal, not the engine down), and each `ApiSession` turn sends the conversation through `ChatCompletionsClient` (streamed chat completions over `node:http`/`node:https`, the text as it comes and then the whole answer, tool calls assembled by index, aborted by a signal), runs the tool calls and sends again until an answer makes none. Its tools (`SessionTools.of`: Read, Grep, Glob, Edit, Write, the system's shells, TaskStop, WebFetch, WebSearch, the Office tools as `mcp__office__<name>`, the tools of the session's MCP servers as `mcp__<server>__<tool>` with the description and input schema recorded at their review (`mcpBuiltInTool`), and `StructuredOutput` when the session has an output schema) carry Claude Code's names and inputs, each a zod schema that also gives the model its JSON Schema (StructuredOutput's is the output schema, checked by Ajv); a call is refused by the engine when the tool is unknown, its arguments aren't JSON or don't fit, then judged by `toolDecision`, and only then run; an Office tool is judged again as it runs. Bash and PowerShell run one command line to its end through the platform's `agentShells` (`runShellCommand`), its tree ended by `ProcessTrees` on interrupt or timeout; with `run_in_background` the session's `BackgroundCommands` starts it instead and answers at once, as Claude Code does, with its id and its output file in the session's own folder (`backgroundCommandFolder`, `<temp>/office-sessions/<session id>/`, a readable folder of its rules, read with Read); TaskStop ends one with its tree, `interrupt` ends them all, and `end` ends them and removes the folder; one that ends by itself leaves Claude Code's `<task-notification>`, which lands as a user message where a `next` message would, or at the next turn's start, never starting a turn. WebFetch fetches the page itself (`fetchWebPage`: http or https, 60 s, 10 MB, redirects on the same host followed and one to another host reported to the model, HTML turned into Markdown by turndown, cut to 40 000 characters) and answers with it under the call's prompt, as there is no small model to answer the prompt. WebSearch goes through the search endpoint's port, `SearchEndpointClient`, whose one adapter is `SearxngClient` (`adapters/searxng/`, `<base URL>/search?format=json`, tested on `FakeSearxngServer`); the domain filters are applied to its results. With no search endpoint set WebSearch is still offered, and a call is refused by the engine once the Office rules allow it (`engineRefusal`). Each turn has its own abort controller: `interrupt` aborts the request and the commands and waits for the turn's end (`interrupted`); a `next` message lands after a batch of tool results, a `later` one waits for the turn's end. A session lists its skills as the SDK adapter's do (`listedSkills`: the plugin folder's as `office:<folder>`, the Project's skills and commands at the folder's top that the allowlist names), checked with `listingProblems` at start and on resume (`SessionSkillsDiffer` before any request), and the `Skill` tool, whose description is the listing, loads one by name (`Base directory for this skill:`, then its body with `$ARGUMENTS` filled in). The system prompt holds the Project's instruction files the SDK adapter's sessions load (`projectInstructions`: `CLAUDE.md`, `.claude/CLAUDE.md`, the rules in `.claude/rules/` without `paths`). After each turn the conversation, system prompt aside, is kept in `ConversationFile` (`<office-data>/sessions/<session id>/conversation.json`, written beside and moved into place), which `resume` reads back (`ConversationMissing` when there is none); Skills' `forget` removes it with the session's folder. `readContextUsage` gives the last request's prompt and answer tokens against the model's context window from Settings › Engines, estimated from the conversation's length when the server counts none; nothing is compacted. A request joins user messages that follow one another into one, as a strict chat template refuses two in a row; the kept conversation holds them apart. Its tests run on `FakeChatCompletionsServer`, which streams scripted answers and records each request. Each test has its own fake server, so a slow test's late requests never take the next test's answers. What every adapter judging Claude Code's tool names shares (`agentAction`, `toolDecision`, `sessionOfficeRules` with each engine's readable folders, the Office tools' names) is in `adapters/office-rules/`; what both Claude Code adapters share (the event mapping, tool refusals, the Office rules hook, `claudeCodeOfficeRules`) is in `adapters/claude-code/`. The fallback's hook reaches the service on `localhost` (`adapters/http/`, under `/api/engine/claude-code-p/`), behind a token per session (`SessionEndpoints`); its Office tools are served in-process through the binary's own stream (`OfficeToolServer` answering `mcp_message` control requests, which `StreamJson` routes to it), judging every call by the session's rules again as it runs. `ClaudeCodePEngine` opens both before it spawns the binary and closes them when the session ends. `EngineSessions` starts and resumes a session on the engine id and model its settings name (`SessionSettings` is an `EngineModel`), on that engine's adapter, and reads capabilities per engine id; an engine Settings › Engines no longer lists is refused (`EngineNotListed`), not the engine down. Each adapter is handed the engine as Settings › Engines lists it as the session opens (`SessionOptions.engine`) and the model by its id there. Both Claude Code adapters run each session, started or resumed, with `CLAUDE_CONFIG_DIR` set to the engine's config folder (`engineConfigFolder`, `<office-data>/engines/<engine id>/`, made at a session's start when missing), which holds its account and its sessions' transcripts, so a session resumes only on the engine that started it; `EngineAccounts` makes it when a Claude Code engine is added and, ending any Sign in under way there, removes it when the engine is removed (`removeEngineConfigFolder`, which refuses an id leading anywhere but a folder directly in `<office-data>/engines/`); `sessionEnvironment` drops any given one first, and the Office rules expand the variable in commands to that folder, refused as the rest of the data directory. Each Claude Code engine's account (`EngineAccountsModule`, beside `EngineModule`): `EngineAccounts` reads it (`GET /api/settings/engines/:engineId/account`, from `auth status --json`, `engineAccountOf`: signed in, by a pasted token or not, email, plan) and signs in (`POST …/sign-in` runs `auth login --claudeai` on the engine's folder and gives the page that signs in by a pasted code; `POST …/sign-in/code` writes the code to the login's input), takes a pasted token (`PUT …/token`, "Paste a token instead": a `claude setup-token` token, `PastedToken`, written as the folder's `.credentials.json` with no refresh token by `engine-credentials.ts`, never answered back) and signs out (`DELETE …/sign-in`, removing that file), through the port `ClaudeCodeAccounts` (`ClaudeCodeCliAccounts` on the pinned binary: one login per engine, ended by another Sign in, a pasted token, Sign out, after 15 minutes or at shutdown); a login's end, a pasted token and Sign out are announced as `EngineAccountChanged`, forwarded to the web as `engine.account-changed`. It reads the usage windows on each rate-limit signal (`readUsageWindows`, no model call), keeping each reading in `UsageWindowState` (`of(engineId)`, which Work's Start weighs; `UsageWindowsRead` on every reading, `UsageWindowsChanged` only when the windows differ) with when it was read and the Office's tokens so far (`readAt`, `officeTokensSoFar`: every turn's four kinds on the reading's engine id, in memory since the service started); each reading is paired with the last of its Reading source on its engine id (`UsageWindowSamples`, in memory, so no pair spans a restart), and a pair that counts (`sampleBetween`: the Office's tokens went up; a window's part when it neither reset nor went down, 0 included) is kept in `usage_window_samples`, the latest 500 per engine id, whose pooled changes over tokens (`ratios(engineId)`) Work's estimates take as window % per counted token, a failure to keep one logged; every turn's tokens also go to each day's use (`DayUsage`, `engine_day_usage` by local day, engine id and model; `today(engineId)`), awaited before the turn is reported and logged, not fatal, when the write fails; each window is judged on its own: the Claude Code adapters read a window the query gives without its `utilization` or `resets_at` as not begun, so unused (0%, `resetsAt` undefined), and the reading still stands. The Office rules in the `PreToolUse` hook (profiles, the git deny, secrets, protected paths, a command's output written outside the worktree refused in words naming the rule before the engine's own wordless refusal, PowerShell twins; the read-only git refusal names pipes and Read and Grep, as `READ_ONLY_SHELL_RULE` does in the chat, planning and shaping instructions that quote it), and before them a session's `ToolHold` (`SessionOptions.toolHold`, asked at every call: while it gives words, every call is refused in them, as the fire alarm does; the scripted engine honours it too, running no Office tool), Office tools (`OfficeToolRegistry`), and the 5-hour and 7-day windows (`UsageWindowsChanged`, `UsageWindowsRead`, `EngineDown`, which names the engine's id and its name as the session opened). Both Claude Code adapters run the session's MCP servers (`SessionOptions.mcpServers`) through the binary's MCP config (`mcpServerConfigs` in `adapters/claude-code/session-mcp-servers.ts`, in a file: `McpConfigFile`), beside the Office tool server, under strict MCP config, each server allowed by rule (`mcp__<server>`) so the hook judges its calls. The scripted engine judges an MCP call by `toolDecision` and runs it on the session's server through `McpServerConnections` (`adapters/mcp-servers/`, The Office's own `McpClient`, a server started at its first call and ended with the session), so the contract's `mcp-tool` scenario runs on the fake stdio server. The API engine's loop uses the same `McpServerConnections`, opening every server before the first turn (`open`, which gives an `mcp-server-not-started` event for each that failed, Server values replaced; a call's retry tells nothing) and ending them with the session (and when its opening fails). The Claude Code engines tell it once per session from the init message's `mcp_servers` (`McpServerStarts`, status `failed` with no reason, or `needs-auth`, which a 401 or 403 gives, the Office's own server left out); the scripted engine replays it as recorded. Its contract runs the `mcp-tool` scenario on the fake chat-completions server.

**Talks to:** no module. A session's owner hands it the skills folder, the options and the environment; modules give it their Office tools through `OfficeToolRegistry`. It never reads Skills.

**Traps:** `EngineAccountsModule` is held by `AppModule` only, as its web event needs the event stream that other modules' tests on `ScriptedEngineModule` lack; the end-to-end service binds `StandInClaudeCodeAccounts`, so no test runs the binary's login or opens a browser. With no TTY the login prints its page at once, opens the browser where there is a display (`BROWSER` names another opener) with a `localhost` callback, takes a code piped on its input, and never ends by itself; `auth status` exits 1 when signed out, so only its output counts. A pasted token is told from a Sign in by the folder's `.credentials.json` alone (`refreshToken: null`, which only The Office writes), so its account drops any email an earlier Sign in left in `.claude.json`; the binary reads a login with `accessToken` alone as signed out, so the expiry and scopes are written too. `PastedToken` reads as redacted wherever it is printed or serialised: keep it so until the adapter writes it (`reveal`). The data directory's `repositories/` (`SessionRules.cloneFolders`, Projects' clones) is no Office file inside the Office files: a command naming a clone is judged as one naming a path-added Project's folder, and the rest of the data directory stays refused. An MCP tool (`mcp__<server>__<tool>`, the `mcp-tool` action) is judged by its setting in `profile.mcpTools` (keyed `server/tool`, every tool of the session's servers; any other is not available): Allowed runs, Never is refused, Consult and Ask me are put to `approvalHold`, kept apart from `toolHold` so a hold of every call never approves one. `SessionOptions.mcpServers` carries each MCP server's launch with its Server values, secrets among them, from Conversations (the MCP servers module prepares them): never log or keep the options. Strict MCP config is always on: `settingSources: ['project']` loads a Project's `.claude/settings.json`, whose `enableAllProjectMcpServers` would otherwise start its `.mcp.json` servers (the live-gated, model-free test in `agent-sdk-engine.test.ts`). The binary starts a local server in its own folder (the session's; the config has no working folder), with its own environment under the server's variables, finding the command as cross-spawn does (`npx.cmd` on Windows); on `-p` that environment holds `OFFICE_SESSION_TOKEN`, blanked in each server's. Server values never go on the binary's command line, which every process of the user can read, nor in its environment, which Agents' commands inherit: each start and resume writes the session's MCP config to its own owner-only file in `<office-data>/sessions/<session id>/` (`McpConfigFile`, beside the readable `skills/`, so the Office rules refuse it), removed as the session ends; `-p` names it in `--mcp-config=<file>` (the flag takes several values), the SDK through `extraArgs`, as its own `mcpServers` option is written inline: only the in-process Office tool server stays there, which reaches the binary on its input. On Windows the file takes the data directory's access list. MCP tools stay deferred behind tool search, the engine's default. In the API engine's loop an MCP call is judged once, before it runs (`toolDecision` waits on `approvalHold`); unlike an Office tool it is not judged again as it runs, which would ask for the approval twice. A server that fails to start keeps its tools listed, as the tool list is fixed for the session and its resume, and each call answers why and tries it again (the binary drops a failed server's tools instead); a failure's words have every Server value of the session replaced (`[a Server value]`), as a server's standard error may print one. What the pinned SDK does is checked by the engine check ([docs/engine-check.md](../../../../../docs/engine-check.md)); re-run it on every SDK bump. The engine's own read fence is off, so the hook is the only fence of Read, Grep and Glob (`agentAction` reads every folder a call names, a Glob's brace alternatives included), and `claudeMdExcludes` keeps the instruction files above a session's folder out (`permissions.read-fence-off`). The engine settings are Office-wide in a database every test file shares: tests keep theirs in `EngineSettingsForTests`, and the Postgres test puts back what it found. An engine's id is made from its name when it is added and kept on a rename, since caps, usage and Role cards name it; contracts' `engineIdFor` mirrors `engineIdFor` so the web prices a drafted engine's models under the id Save gives; the upgrades (`drizzle/0075_engines.sql`, `0078_role_card_engine_id.sql`) split an API model named `<endpoint>/<model>` at its first `/`, as a model's id may hold one. A new engine never takes a listed engine's id. The chat completions client doesn't use `fetch`: Node's has fixed waits of about 300 s, too short for a slow local server reading a long prompt, so it keeps its own (`ChatCompletionsTimeouts`). An abort throws the signal's reason, every other failure a `ChatCompletionsError` in words; the loop ends that turn `failed` and takes the next message. The loop's Glob and Grep list only what the session's rules let it read, skipping `.git` and `node_modules` (no `.gitignore`), and Edit and Write change an existing file only once the session has read it. `reasoning_content` is neither shown nor sent back. The loop streams each request but reports its text once the answer is whole, one text event as the SDK's text block, since a Thread logs each text event as one message. Other modules' tests run this engine's own sessions on a fake server through `index.fixtures.ts` (`apiEngineOnFakeServer`), and `ScriptedEngineModule.register` takes it beside scripted engines. The Role card names what each engine can't do from `EngineSessions.missingCapabilitiesOf(engine)`. An interrupted turn leaves a tool message for every call of its last answer and a note that it was interrupted, as the API needs; an Office tool can't be stopped, so the turn stops waiting for it and drops its late answer. A command's leftovers are ended once it exits by itself, in the background too, since its process id may later be another process's; a background command never goes through `runShellCommand`, which ends the tree on the turn's signal. The API endpoint and the search endpoint are read once, as a session starts: a change in Settings › Engines reaches the sessions started after it. A stock SearXNG answers 403 to `format=json` until its `settings.yml` lists `json` under `search.formats`; the refusal says so. A turn with an output schema that answers without StructuredOutput is reminded twice, then fails, as Claude Code retries it. A session cut short by its end keeps an answer for each call of its last answer and the interrupted note, so its kept conversation resumes. A resumed session's Edit and Write ask for a fresh Read: the files read are not kept. Nested `CLAUDE.md` files and `@` imports are not loaded, nor are path-scoped rules or nested skills, which the SDK loads only once a file below them is read. Live adapter tests run only with `OFFICE_ENGINE_TESTS=live` ([testing](../../../docs/testing.md)), on the engine `claude-code`'s folder in `<temp>/office-engine-data/engines/`, which must be signed in first. The fallback's live test serves the endpoints itself (`serveSessionEndpoints`). Keep the fallback's Office tool answers on the binary's input: over a separate channel (the old `localhost` MCP endpoint) an answer overtook a `next` message on Windows (engine-check.md, `fallback.priority-next-office-tool`).

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

EngineSessions, EngineCapability, OfficeToolRegistry, OfficeTool, OfficeToolResult, UsageWindowState, UsageWindowReading, UsageWindowSamples, UsageWindowRatios, EngineDown, UsageWindowsChanged, UsageWindowsRead, EngineModels, FIRST_CLAUDE_CODE_ENGINE, hasUsageWindows, offeredModels, Engine, EngineId, EngineModel, DayUsage, ModelDayUsage, ModelPrices, READ_ONLY_GIT_COMMANDS, READ_ONLY_SHELL_RULE, EngineModule, EngineAccountsModule, ScriptedEngine, StandInEngine, readRecording, SessionScript, ScriptedEngineModule, ClaudeCodeAccounts, StandInClaudeCodeAccounts, OPENAI_COMPATIBLE_API_CAPABILITIES, NewSession, EngineSession, ApprovalCall, ApprovalHold

## Domain events

- `domain/engine-events.ts`: UsageWindowsChanged, UsageWindowsRead, EngineAdded, EngineRemoved, EngineAccountChanged, EngineDown

## HTTP routes (under `/api`)

- `GET /settings/engines/:engineId/account`: EngineAccountsController.account
- `POST /settings/engines/:engineId/sign-in`: EngineAccountsController.signIn
- `POST /settings/engines/:engineId/sign-in/code`: EngineAccountsController.enterCode
- `PUT /settings/engines/:engineId/token`: EngineAccountsController.setPastedToken
- `DELETE /settings/engines/:engineId/sign-in`: EngineAccountsController.signOut
- `GET /settings/engines`: EngineSettingsController.read
- `PUT /settings/engines`: EngineSettingsController.change

## Tables

- `adapters/postgres/day-usage.schema.ts`: engine_day_usage
- `adapters/postgres/engine-settings.schema.ts`: engines, engine_settings, model_prices
- `adapters/postgres/usage-window-samples.schema.ts`: usage_window_samples

## Files

### ./

- `engine-accounts.module.ts`: EngineAccountsModule
- `engine-settings.module.ts`: EngineSettingsModule
- `engine.module.ts`: EngineModule
- `index.fixtures.ts`: apiEngineOnFakeServer, ApiEngineOnFakeServer, textReply, FakeChatCompletionsServer, EngineSettingsForTests
- `scripted-engine.module.ts`: ScriptedEngineModule

### adapters/agent-sdk/

- `agent-sdk-engine.ts`: AgentSdkEngine
- `sdk-options.ts`: SdkSession, sdkOptions, sdkMcpConfig
- Tests: agent-sdk-engine.test.ts, sdk-options.test.ts, test-project-check.test.ts

### adapters/claude-code/

- `claude-code-cli-accounts.ts`: ClaudeCodeCli, ClaudeCodeCliAccounts
- `engine-config-folder.ts`: engineConfigFolder, preparedEngineConfigFolder, NotAnEngineConfigFolder, ownEngineConfigFolder, removeEngineConfigFolder
- `engine-credentials.ts`: writePastedToken, removeEngineCredentials, holdsPastedToken
- `engine-process.ts`: EngineCommand, EngineProcess
- `engine-task-folder.ts`: engineTaskFolder
- `mcp-config-file.ts`: McpConfig, McpConfigFile
- `mcp-server-starts.ts`: McpServerStarts
- `office-rules-hook.ts`: officeRulesHook
- `office-tools.ts`: officeToolAnswer, textAnswer
- `sdk-events.ts`: sessionEvents, TurnTokens, usageWindows
- `session-mcp-servers.ts`: McpServerConfig, mcpServerConfigs
- `session-office-rules.ts`: ClaudeCodeSessionPlaces, claudeCodeOfficeRules
- `session-settings.ts`: sessionTools, sessionSettings, sessionEnvironment
- `start-check.ts`: StartCheckRequests, startCheckProblems, initProblems
- `stream-events.ts`: StreamEvents, userMessage, isInit, engineStopped
- `tool-refusals.ts`: ToolRefusals
- Tests: claude-code-cli-accounts.test.ts, engine-config-folder.test.ts, engine-task-folder.test.ts, mcp-config-file.test.ts, office-rules-hook.test.ts, sdk-events.test.ts, start-check.test.ts, stream-events.test.ts, tool-refusals.test.ts

### adapters/claude-code-p/

- `claude-code-p-arguments.ts`: TOKEN_VARIABLE, ClaudeCodePSession, claudeCodePArguments, claudeCodePMcpConfig, claudeCodePEnvironment
- `claude-code-p-engine.ts`: CLAUDE_CODE_P_CAPABILITIES, ClaudeCodePEngine
- `office-tool-server.ts`: ToolDecider, OfficeToolServer
- `pinned-binary.ts`: pinnedBinaryPath
- `session-endpoints.ts`: SESSION_ENDPOINTS_ROUTE, HOOK_ROUTE, EndpointSession, OpenEndpoints, SessionEndpoints
- `stream-json.ts`: StreamMcpServer, StreamJson
- Tests: claude-code-p-arguments.test.ts, claude-code-p-engine.test.ts, office-tool-server.test.ts, stream-json.test.ts

### adapters/http/

- `engine-account-refusal.filter.ts`: EngineAccountRefusalFilter
- `engine-accounts.controller.ts`: EngineAccountsController
- `engine-settings-refusal.filter.ts`: EngineSettingsRefusalFilter
- `engine-settings.controller.ts`: EngineSettingsController
- `session-endpoints.controller.ts`: SessionEndpointsController
- `session-endpoints.fixtures.ts`: ServedEndpoints, serveSessionEndpoints
- Tests: engine-accounts.controller.test.ts, engine-settings.controller.test.ts, session-endpoints.controller.test.ts

### adapters/mcp-servers/

- `contract-mcp-server.fixtures.ts`: CONTRACT_MCP_SERVER
- `mcp-server-connections.ts`: McpToolAnswer, McpServerConnections

### adapters/office-rules/

- `office-tool-names.ts`: OFFICE_TOOL_SERVER, OFFICE_TOOL_PREFIX, mcpToolName, mcpToolOf, portToolName
- `session-office-rules.ts`: EngineRuleParts, sessionOfficeRules
- `tool-actions.ts`: agentAction
- `tool-decision.ts`: SessionHolds, toolDecision
- Tests: tool-actions.test.ts, tool-decision.test.ts

### adapters/openai-compatible-api/

- `api-engine-on-fake-server.fixtures.ts`: ApiEngineOnFakeServer, apiEngineOnFakeServer
- `api-session.ts`: ApiSessionParts, ApiSession
- `background-commands.ts`: BackgroundStart, BackgroundStop, backgroundCommandFolder, BackgroundCommands
- `built-in-tool.ts`: ToolOutput, ToolContext, ReadFiles, PreparedCall, InvalidCall, BuiltInTool, builtInTool, success, failure, engineRefusal, resolvedPath
- `chat-completions-client.ts`: ChatCompletionsTimeouts, DEFAULT_CHAT_COMPLETIONS_TIMEOUTS, CompletionTextEvent, CompletionEndedEvent, CompletionEvent, ChatCompletionsError, ChatCompletionsEndpoint, ChatCompletionsClient, chatCompletionsUrl
- `chat-completions.ts`: ToolCall, SystemMessage, UserMessage, AssistantMessage, ToolMessage, ChatMessage, ToolDefinition, ChatCompletionsRequest, ToolCallDelta, CompletionUsage, completionChunkSchema, CompletionChunk, STREAM_DONE
- `completion-assembly.ts`: Completion, CompletionAssembly
- `conversation-file.ts`: ConversationMissing, ConversationFile
- `edit-tool.ts`: EDIT_TOOL, editedContent
- `fake-chat-completions-server.fixtures.ts`: ScriptedToolCall, ScriptedUsage, ScriptedReply, ScriptedStatus, ScriptedSilence, ScriptedAnswer, AnswerEnd, RecordedRequest, FakeChatCompletionsServer, textReply
- `file-listing.ts`: ListedFile, listedFiles
- `file-problems.ts`: fileProblem, isMissing, isBinary
- `glob-tool.ts`: GLOB_TOOL
- `grep-tool.ts`: GREP_TOOL
- `json-text.ts`: parsedJson
- `listed-skills.ts`: ListedSkill, listedSkills
- `markdown-file.ts`: MarkdownFile, markdownFile, frontmatterText, markdownFilesIn, textOrNone
- `mcp-tool.ts`: mcpBuiltInTool
- `office-tool.ts`: CallJudge, officeBuiltInTool
- `openai-compatible-api-engine.ts`: OPENAI_COMPATIBLE_API_CAPABILITIES, OpenAiCompatibleApiEngine
- `project-instructions.ts`: InstructionFile, projectInstructions
- `read-tool.ts`: READ_TOOL
- `server-sent-events.ts`: ServerSentEvents
- `session-tools.ts`: SessionToolParts, SessionTools
- `shell-command.ts`: CommandLine, ShellSpawn, shellSpawn, ShellCommand, CommandEnding, runShellCommand
- `shell-tool.ts`: shellTool
- `skill-tool.ts`: skillTool
- `structured-output-tool.ts`: STRUCTURED_OUTPUT_TOOL, structuredOutputTool
- `system-prompt.ts`: SystemPromptParts, systemPrompt
- `task-stop-tool.ts`: taskStopTool
- `text-search.ts`: SearchContext, TextSearch, textSearch, splitLines, matchCount, matchingLines
- `web-fetch-tool.ts`: webFetchTool
- `web-page.ts`: WebPageLimits, DEFAULT_WEB_PAGE_LIMITS, WebPage, fetchWebPage, sizeInWords, isWebUrl
- `web-search-tool.ts`: webSearchTool
- `write-tool.ts`: WRITE_TOOL
- Tests: chat-completions-client.test.ts, file-tools.test.ts, openai-compatible-api-engine.test.ts, server-sent-events.test.ts, web-tools.test.ts

### adapters/postgres/

- `day-usage.schema.ts`: engineDayUsage
- `engine-settings.schema.ts`: engines, engineSettings, modelPrices
- `postgres-day-usage.ts`: PostgresDayUsage
- `postgres-engine-settings.ts`: PostgresEngineSettings
- `postgres-usage-window-samples.ts`: PostgresUsageWindowSamples
- `usage-window-samples.schema.ts`: usageWindowSamples
- Tests: postgres-day-usage.test.ts, postgres-engine-settings.test.ts, postgres-usage-window-samples.test.ts

### adapters/scripted/

- `recording-engine.ts`: RecordingEngine
- `scripted-engine.ts`: ScriptMismatch, StandInEngine, ScriptedEngine, ScriptedSession
- `session-script.ts`: ScriptStep, CallerStep, CallerRequest, ReadStep, SessionScript, RecordedPlaces, PLACEHOLDERS, readRecording, writeRecording, inPlaces
- `stand-in-claude-code-accounts.ts`: STAND_IN_SIGN_IN_PAGE, STAND_IN_ACCOUNT, STAND_IN_PASTED_TOKEN_ACCOUNT, StandInClaudeCodeAccounts
- Tests: scripted-engine.test.ts

### adapters/searxng/

- `fake-searxng-server.fixtures.ts`: FakeSearxngServer
- `searxng-client.ts`: SEARXNG_TIMEOUT_MS, SearxngClient, searchUrl

### adapters/websocket/

- `engine-web-events.ts`: EngineWebEvents

### application/

- `agent-engines.ts`: EngineAdapter, AgentEngines
- `day-usage.ts`: DayUsage
- `engine-accounts.ts`: NotAClaudeCodeEngine, EngineAccounts
- `engine-call-spans.ts`: SessionTelemetry, SessionCosts, promptFeatures, EngineCallSpans
- `engine-models.ts`: EngineModels
- `engine-sessions.ts`: SessionSettings, SessionStart, EngineSessions
- `engine-settings-service.ts`: EngineSettingsService
- `model-prices.ts`: ModelPrices
- `office-tool-registry.ts`: OfficeToolRegistry
- `usage-window-samples.ts`: UsageWindowSamples
- `usage-window-state.ts`: UsageWindowReading, UsageWindowState
- Tests: engine-sessions.test.ts, model-prices.test.ts, office-tool-registry.test.ts, usage-window-samples.test.ts, usage-window-state.test.ts

### domain/

- `agent-action.ts`: AgentAction
- `api-endpoints.ts`: ApiEndpointModel
- `day-usage.ts`: dayOf
- `directory-change.ts`: DirectoryChange, directoryChange
- `engine-account.ts`: EngineAccount, EngineAccountUnreadable, engineAccountOf
- `engine-events.ts`: UsageWindowsChanged, UsageWindowsRead, EngineAdded, EngineRemoved, EngineAccountChanged, EngineDown
- `engine-settings-refused.ts`: EngineSettingsRefused
- `engine-settings.ts`: SearchEndpoint, EngineSettings, FIRST_OFFICE_DEFAULT, DEFAULT_ENGINE_SETTINGS, ClaudeCodeEngineEdit, ApiEngineEdit, EngineEdit, EngineSettingsEdit, ENGINE_NAME_LENGTH, apiEngines, offeredModelPrices, changedEngineSettings
- `engines.ts`: EngineId, EngineKind, ClaudeCodeEngine, ApiEngine, Engine, CLAUDE_CODE_MODELS, FIRST_CLAUDE_CODE_ENGINE, engineIdFor, offeredModels, hasUsageWindows, EngineModel
- `git-commands.ts`: READ_ONLY_GIT_COMMANDS, isGit, gitChange
- `model-prices.ts`: ModelPrice, PricedModel, OfferedModel, OfferedOn, pricedModels, priceOf
- `office-rules.ts`: ToolDecision, READ_ONLY_SHELL_RULE, OfficeRules
- `pasted-token.ts`: NotAPastedToken, PastedToken
- `permission-profile.ts`: CommandPermission, PermissionProfile, McpToolSetting, ApprovalSetting
- `secret-paths.ts`: SecretPaths
- `session-rules.ts`: PathSemantics, SessionRules
- `shell-commands.ts`: ShellDialect, Redirect, SimpleCommand, UnreadableCommand, simpleCommands, programWords, programName
- `skill-listing.ts`: listingProblems
- `usage-window-samples.ts`: POOLED_SAMPLES, PairedReading, UsageWindowSample, UsageWindowRatios, NO_USAGE_WINDOW_RATIOS, sampleBetween, pooledRatios
- `usage-windows.ts`: UsageWindow, ReadingSource, UsageWindows, sameUsageWindows
- Tests: directory-change.test.ts, engine-account.test.ts, engine-settings.test.ts, engines.test.ts, office-rules.test.ts, pasted-token.test.ts, shell-commands.test.ts, usage-window-samples.test.ts

### ports/

- `agent-engine.contract.ts`: CONTRACT_SCENARIOS, ContractScenario, EngineUnderContract, ContractMcpServer, describeAgentEngineContract
- `agent-engine.ts`: EngineCapabilities, EngineCapability, missingCapabilities, CapabilityMissing, SessionSkillsDiffer, ModelNotOffered, EngineNotListed, NewSession, AgentEngine
- `claude-code-accounts.ts`: SignIn, SignInNotRunning, SignInFailed, ClaudeCodeAccounts
- `day-usage-repository.fixtures.ts`: DayUsageForTests
- `day-usage-repository.ts`: ModelDayUsage, DayUsageRepository
- `engine-session.ts`: UserMessage, MessagePriority, ContextUsage, EngineSession
- `engine-settings-repository.fixtures.ts`: EngineSettingsForTests
- `engine-settings-repository.ts`: EngineSettingsRepository
- `office-tool.ts`: OfficeToolCall, OfficeToolResult, OfficeTool
- `search-endpoint-client.ts`: SearchResult, SearchFailed, SearchEndpointClient
- `session-events.ts`: TokenUsage, NO_TOKENS, addedTokens, countedTokens, TextEvent, ToolCallEvent, ToolResultEvent, RefusedBy, ToolRefusedEvent, TurnTokensEvent, TurnOutcome, TurnEndedEvent, RateLimitStatus, RateLimitEvent, McpServerNotStartedEvent, SessionEvent
- `session-options.ts`: Effort, SessionSkills, SessionMcpServer, SessionMcpServerLaunch, SessionMcpServerTool, ToolHold, ApprovalCall, ApprovalHold, JsonSchema, SessionOptions
- `usage-window-sample-repository.fixtures.ts`: UsageWindowSamplesForTests
- `usage-window-sample-repository.ts`: UsageWindowSampleRepository
