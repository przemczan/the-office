# Engine check

What The Office relies on in the engine, checked against live sessions on the pinned versions: the skills mechanism of [spec §5.6](spec/5.6-skills-per-session.md), the permission build rules of [§6](spec/6-permissions-and-safety.md) and the engine behaviours of [§5.4](spec/5.4-the-engine.md), on the Claude Code, Codex, Copilot CLI and Gemini CLI engines. The check lives in [tools/engine-check](../tools/engine-check); each entry below names the check id it shares with `tools/engine-check/expectations.json`, where the observed facts are recorded per platform.

## When to run

- **On every SDK bump, before the bump is merged,** on Windows and on Linux: `npm run engine-check`. It exits non-zero when any check differs from what is recorded for that platform, has nothing recorded, or fails. A difference is read, its entry here updated (and the spec amended with the user when it contradicts it), then recorded with `npm run engine-check -- --record`.
- **Once per bump, also the slow checks:** `npm run engine-check -- --only engine.decision-wait --include-slow`, which waits an hour on purpose, and `npm run engine-check -- --only engine.long-office-tool --only fallback.long-office-tool --include-slow`, which each wait 11 minutes in an Office tool.
- **On every Codex bump, before the bump is merged,** on Windows and on Linux: `npm run engine-check -- --only codex. --codex-home <folder>`, with a Codex folder signed in for the check (`ENGINE_CHECK_CODEX_HOME` when the option is left out). Without a signed-in folder the `codex.*` checks are skipped with the reason, so a plain `npm run engine-check` still passes. Regenerate the protocol with `codex app-server generate-ts --out <folder>` from the pinned binary and compare it with `tools/engine-check/src/codex/protocol.ts`.
- **On every Copilot bump, before the bump is merged,** on Windows and on Linux: `COPILOT_GITHUB_TOKEN=<token> npm run engine-check -- --only copilot.`, the token a fine-grained personal access token with the "Copilot Requests" permission, on an account with Copilot. Without it the `copilot.*` checks are skipped with the reason, so a plain `npm run engine-check` still passes. The checks sign in with the token in a folder of their own; the user's `~/.copilot` is never read or written, and the token is never recorded.
- **On every Gemini CLI bump, before the bump is merged,** on Windows and on Linux: `ENGINE_CHECK_GEMINI_API_KEY_FILE=<file holding the key> npm run engine-check -- --only gemini.`, the key a Gemini API key from Google AI Studio, kept in a git-ignored place such as `tools/engine-check/out/`. Without it the `gemini.*` checks are skipped with the reason. On the free tier (15 requests a minute) run them one at a time, a minute apart. The key is never printed or recorded. Then the AgentEngine contract live on a Gemini CLI engine ([The AgentEngine contract, live](#the-agentengine-contract-live)).
- **With an Anthropic API key, once per bump:** `ENGINE_CHECK_API_KEY_FILE=<file holding the key> npm run engine-check -- --only engine.api-key-sign-in` ([engine.api-key-sign-in](#engineapi-key-sign-in)). Without the variable the check is skipped with the reason, so a plain `npm run engine-check` still passes.
- **With a second Claude Code folder, once per bump:** `npm run engine-check -- --only engine.session-carry-over --only fallback.session-carry-over --second-claude-config <folder>`, the folder signed in with `CLAUDE_CONFIG_DIR=<folder> claude auth login` (`ENGINE_CHECK_SECOND_CLAUDE_CONFIG` when the option is left out); it may be signed in to the same account as the default one ([engine.session-carry-over](#enginesession-carry-over-fallbacksession-carry-over)). Without a signed-in folder the two checks are skipped with the reason, so a plain `npm run engine-check` still passes.
- **On a machine with no Claude Code sign-in in `~/.claude`:** set `ENGINE_CHECK_CLAUDE_CODE_OAUTH_TOKEN` to a token from `claude setup-token` (for an Agent, a Secret variable of the Project). The Agent SDK and `-p` sessions then run signed in with it, as `CLAUDE_CODE_OAUTH_TOKEN`; without the variable nothing changes and they use `~/.claude`. The check's own `CLAUDE*`/`ANTHROPIC*` strip leaves this variable alone, and the token is never logged or written to the report. Checks that run on a folder of their own (`engine.api-key-sign-in`, `engine.session-carry-over`) don't use it.
- **To re-check one area:** `--only <id prefix>`, for example `--only permissions.`; `npm run engine-check -- --help` lists the options.

Every run writes `tools/engine-check/out/report-<platform>.json` with each session's messages and hook calls, and prints its tokens. A full run costs a few minutes and, on `claude-haiku-5-5`, about 15k output tokens and 2.7M cache-read tokens.

## Pinned versions

| What | Version |
|---|---|
| `@anthropic-ai/claude-agent-sdk` | 0.3.310 (exact pin in `tools/engine-check/package.json`) |
| Claude Code, bundled by the SDK | 2.1.310 |
| Node | 22 (`.nvmrc`; `>=22.18` for built-in type stripping) |
| `zod` (the SDK's peer) | 4.6.7 |
| `@modelcontextprotocol/sdk` (the SDK's own, for the fallback's Office tool server) | 1.32.2 |
| Model for the checks | `claude-haiku-5-5` |
| `@openai/codex` | 0.169.0 (exact pin in `tools/engine-check/package.json`; the native binary of `@openai/codex-<platform>-<arch>` runs directly) |
| Model for the Codex checks | `gpt-6-luna` at `low` effort (`CODEX_CHECK_MODEL` in `tools/engine-check/src/codex/options.ts`), the cheapest `model/list` shows: no `-mini` model is listed |
| `@microsoft/copilot-sdk` | 2.0.1 (exact pin in `tools/engine-check/package.json`) |
| The Copilot CLI runtime, bundled by the SDK | 1.0.114 (in `@microsoft/copilot-sdk-<platform>`; `copilotCliVersion` in the SDK's `package.json`) |
| Model for the Copilot checks | `gpt-5-mini` (`COPILOT_CHECK_MODEL` in `tools/engine-check/src/copilot-cli/options.ts`), a 0× premium-request model on Copilot's paid plans; the 2026-11-19 run named none, and Auto ran `mai-code-2-flash` ([Runs](#runs)) |
| `@google/gemini-cli` | 0.70.0 (exact pin in `tools/engine-check/package.json`; its JS entry, `bundle/gemini.js`, runs with `process.execPath`, so no `.cmd` shim on Windows) |
| Model for the Gemini checks | `gemini-3.5-flash-lite` (`GEMINI_CHECK_MODEL` in `tools/engine-check/src/gemini/options.ts`), the cheapest Flash-Lite a new API key gets (the Gemini API refuses `gemini-2.5-flash-lite` to new users), named by id since the CLI's `flash-lite` alias resolves by the account's access |

## Runs

`expectations.json` holds what each check observed, per platform: Windows 11 (`win32`, the workstation) and Ubuntu 24.04 x64 (`linux`, the Office's own machine, signed in to Claude Code as root).

- **Recorded on both:** every `skills.*`, `permissions.*`, `engine.*` and `fallback.*` check but those below. Results differ between the platforms only where an entry says so: `skills.user-scope`, `engine.priority-now` and `engine.lean-options`.
- **Recorded on one:** `permissions.powershell-twin` runs on Windows only. `skills.overrides-library`, `office-tools.deferred` and `office-tools.deferred-p` are recorded on Linux only. The `codex.*` checks are recorded on Linux only too, on `gpt-6-luna` with a ChatGPT sign-in (Free plan) in a folder made for the check; a full Codex run takes about 3 minutes and about 80k input, 1k output and 390k cache-read tokens.
- **Not recorded on either:** `skills.skill-command`, `permissions.devcontainer`, `engine.long-office-tool`, `engine.usage-window-refusal`, `engine.session-carry-over`, `engine.usage-read-alone`, `engine.window-start`, `engine.lsp-tool`, `engine.background-tasks`, `engine.foreground-sub-agents`, `engine.api-key-sign-in`, `fallback.long-office-tool`, `fallback.usage-window-refusal`, `fallback.session-carry-over`, `fallback.window-start`, `fallback.background-tasks`, `fallback.foreground-sub-agents`, `codex.usage-read-alone` and `codex.window-start`. Each needs a signed-in machine, and some more (their entries say what); a run reports them `unrecorded`.
- **Not checked live yet: listing an engine's models** ([spec §5.4.5](spec/5.4.5-engines-and-cascade.md#models-an-engine-lists), the port's `listModels`, Task c07a5a43). Its adapters are tested against stand-ins only; a check should confirm that the Agent SDK's `supportedModels()` and the `-p` binary's `initialize` answer (`models`, with `resolvedModel`) give the full `claude-…` ids a session takes, that the `model` (not the `id`) of Codex's `model/list` is what `thread/start` takes, and what the Copilot SDK's `listModels()` returns for a token-signed account. SDK 0.3.310 has `supportedModels()`, so no bump was needed.
- **The `copilot.*` checks were run on Linux only, on 2026-11-19, and not recorded in `expectations.json`:** the check's code as it stands can't run them, so the run patched two things for itself alone. The client ran in `mode: "coding-agent"`, since the SDK refuses a session in `mode: "empty"` that names no `tools.availableTools`; and no model was named, since the account (a fine-grained token with "Copilot Requests") lists no models and the runtime refuses any model named, so Auto ran `mai-code-2-flash`. Each **Observed** below is from that run, about 1.1M input and 3k output tokens in 5.5 minutes, every check answering. Fixing the check's options and recording it, on Windows too, is the Copilot CLI adapter's Task.
- **The `gemini.*` checks are recorded on Linux,** 2026-11-20, on the adapter's own wiring (Task c5691eeb), on `gemini-3.5-flash-lite` with a free-tier Gemini API key. Each check ran alone, a minute apart, for the free tier's 15 requests a minute; `gemini.quota-refusal` was skipped, as no quota was used up. **On Windows they are pending** until the user's run; the capability table's Windows column says "(pending)".
- **The Copilot CLI engine on the Test Project, Linux (the Task's run environment), 2026-11-19, Auto** (`conversations/application/copilot-cli-test-project-check`, a fine-grained token with "Copilot Requests"): the engine added, signed in by the pasted token and removed with its folder, all through the API. **Chat passed:** one Read and the reply `3` in one message, in 9 s and 21.8k tokens (6 input, 46 output, 17.8k cache read, 3.9k cache write), 25 s for the whole test. **Stage failed, in the adapter:** Implement ended in 10 s with no tokens counted, as Copilot refused each turn's `responseSchema` (the Stage result schema) with `400 Invalid schema for response_format 'response': In context=(), 'if' is not permitted`. The Office reported this as a result that didn't match its schema. Premium requests aren't reported: The Office doesn't keep them. See [On the Test Project](#on-the-test-project).

## How a check runs

Each check runs in a throwaway git repository in a temp folder, with an Office data directory beside it holding the session plugin folder (`office-data/sessions/<session-id>/skills/`) and Task worktrees. Sessions start with the options The Office ships, so a result holds for The Office:

- `settingSources: ['project']`, the session plugin folder in `plugins`, `skills` listing `office:<name>` for each session skill;
- settings: `syncClaudeAiSkills` and `syncClaudeAiPlugins` false, `disableBundledSkills` and `disableSkillShellExecution` true, `disableClaudeAiConnectors` true, `autoMemoryEnabled` and `autoDreamEnabled` false, the three built-in plugins false in `enabledPlugins`, `permissions.blockReadsOutsideWorkingDirectories` false (see `permissions.read-fence-off`), `claudeMdExcludes` naming the instruction files above the session's folder;
- `tools` naming the built-in tools explicitly, the same list on both platforms with PowerShell on Windows only (see `engine.lean-options`);
- `permissionPrompts: 'none'`, the `claude_code` system prompt preset with `excludeDynamicSections`, an environment without inherited `CLAUDE*`, `ANTHROPIC*`, `MCP_*` and `OTEL_*` variables;
- the hooks The Office registers (`PreToolUse`, `PostToolUse`, `PermissionDenied`), recorded on every call and allowing by default; a check decides calls where it needs to.

The `fallback.*` checks start the same options on the `-p` route (spec §5.4 Defaults): the pinned binary the SDK bundles, found as the SDK finds it (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude[.exe]`, on Linux the glibc build first), spawned with the flags `tools/engine-check/src/claude-code-p/arguments.ts` builds from them:

- `--print --input-format=stream-json --output-format=stream-json --verbose`, `--model`, `--tools`, `--setting-sources=project`, `--plugin-dir=<session plugin folder>` (the public flag; the SDK passes the hidden `--plugin-dir-no-mcp` for a plugin with `skipMcpDiscovery`, which gives the same `fallback.start` result, as the session folder holds no MCP servers), `--allowedTools=Skill(office:<name>),…`, `--permission-prompts=none`, `--exclude-dynamic-system-prompt-sections`, `--session-id` or `--resume`, and `--json-schema` where a check holds the output to one;
- `--settings` with the settings above plus the hooks: each event an `http` hook to the session's `localhost` endpoint with `onFailure: 'block'`, a 600 s timeout and `Authorization: Bearer ${OFFICE_SESSION_TOKEN}` (`allowedEnvVars`), and `mcp__office` in `permissions.allow` when the session has Office tools;
- `--mcp-config` naming an `office` server `{type: 'sdk', name: 'office'}` when the session has Office tools: the binary sends that server's MCP messages to the host as `mcp_message` control requests, and the check answers each from an MCP server in its own process (`claude-code-p/office-tool-server.ts`, each tool with `_meta['anthropic/alwaysLoad']` as the SDK's `alwaysLoad` sets it), as the SDK answers a `createSdkMcpServer()` server;
- the environment above plus `OFFICE_SESSION_TOKEN`, a token made per session, so it is on no command line; the hook stand-in (`claude-code-p/local-endpoints.ts`, `node:http` on `127.0.0.1`) refuses a request without it;
- no `initialize` request (the binary sends the `sdk` server's messages without one naming it in `sdkMcpServers`): messages and the control requests (`interrupt`, `get_context_usage`, `reload_plugins`, `get_usage`, `stop_task`) are written to its input as the SDK writes them, and any other control request from the engine to the host is answered with an error and recorded.

A check records facts that hold run to run (booleans, outcomes, sorted names, token counts rounded to 10k), never model text. Where a check varies an option on purpose, its entry says so.

## What the spec takes from the checks

Results the spec rests on, and what it says because of them.

| Check | Spec | What holds |
|---|---|---|
| `permissions.read-fence-off` | §5.6, §6 | `blockReadsOutsideWorkingDirectories` is off: under it the engine refused commands the hook allowed. The hook alone fences Read, Grep and Glob, and lets a session read its skills folder; shell reads outside run wherever the profile allows the command; `claudeMdExcludes` names the instruction files above the session's folder, which load without the fence |
| `permissions.hook-sees-every-call` | §6 | The `PreToolUse` hook sees every call the engine's input validation lets through, before any rule; no path-scoped deny rules; path decisions are the hook's |
| `permissions.hook-sees-every-call` | §6 | Refusals are logged from the hook's decisions, `permission_denied` messages and `result.permission_denials`; the `PermissionDenied` hook is not relied on |
| `permissions.protected-paths` | §6 | The hook refuses Agents' writes to the protected paths first, with a clear reason; the engine stays a backstop |
| `engine.office-tool` | §6 | The Office allows its own tools by rule: `permissionPrompts: 'none'` refuses whatever would prompt |
| `engine.priority-now` | §5.4 | `now` is not used; `interrupt()` is the only way to stop a running command |
| `engine.auto-memory`, `engine.lean-options`, `skills.start-check` | §5.4 | claude.ai connectors, built-in plugins and auto-memory are off |
| `engine.lean-options` | §5.4 | An explicit `tools` list, the same on both platforms: the Linux default has no Grep or Glob |
| `permissions.powershell-twin` | §6 | Twins stay, because a Bash rule does not reach PowerShell; a Bash deny rule alone turns PowerShell off only with the default tool set |
| `engine.lsp-tool` | §5.4, §6 | `LSP` is in the explicit tool list; every session on a Claude Code engine has language servers, through a plugin of their own; an LSP call is a read of its file, and a server may run Project code outside the hook, in read-only sessions too |
| `skills.resume`, `skills.overrides-off` | §5.6 | Never a changed set on resume; overrides keyed by the bare name |
| `skills.start-before-brief` | §5.6 | `init` comes only with the first message; the start check reads `reloadPlugins` and the listing before it, and an `init` that disagrees ends the session |
| `skills.project-names` | §5.6 | Project skills keyed by a skill's folder or a command's path under `commands/`; expected at start by their listed names, at the repository's top only |
| `skills.frontmatter-yaml` | §2.6 Defaults | A plain frontmatter value holding `: ` is read as the engine reads it |
| `skills.shell-execution` | §5.6 | `disableSkillShellExecution` true: a skill's commands would bypass the hook when they run |
| `codex.interrupt` | §5.4 | On the Codex engine `turn/interrupt` ends the turn but not its command; Stop also ends the session's app-server process |
| `codex.start` | §5.4 | A Codex thread marks its repository trusted and loads the Project's `.codex/config.toml` unless `thread/start` names it untrusted, which the Codex engine does |
| `codex.approvals`, `codex.sandbox`, `codex.office-tool` | §5.4, §6 | The Office rules reach the Codex engine as approval requests under `untrusted`; a request with a `reason` asks to leave the sandbox; MCP tool calls come as elicitations |

## Skills

### skills.start-check

- **Run:** a session with skills `alpha` and `beta`, started without a model call (a `shouldQuery: false` message still yields `init` and the turn-start attachments).
- **Observed:** `init.plugins` lists `office` at the session folder with no errors, and no other plugin; the listing the model gets holds exactly `office:alpha`, `office:beta`. `init.skills` also names `design` and `doctor`, outside the allowlist, though the listing stays clean.
- **Meaning:** compare the plugins and the listing, not `init.skills`. `init` comes only with the first message, so the start check of §5.6 reads the plugins from a held `reloadPlugins` and the listing from `getContextUsage()` before it (`skills.start-before-brief`). A release that adds a built-in plugin shows here as another plugin, and its id joins the `enabledPlugins` list.

### skills.frontmatter-yaml

- **Run:** a session skill whose frontmatter reads `description: Test first: red, green, refactor.`, unquoted, which no YAML parser reads; its listing read from the transcript after a message that doesn't query. No model call.
- **Observed:** the skill is listed with that description as written, not with its body's first line.
- **Meaning:** the engine reads such a value as the text after the first `: `, so the library reads it the same way (§2.6 Defaults) instead of refusing what the engine takes.

### skills.start-before-brief

- **Run:** a session with skill `alpha`; before any message, a plugin reload held on any cache impact and the context usage; then one turn, reading the transcript.
- **Observed:** no `init` arrives before the first message. The reload lists `office` at the session folder with no errors and is not held; the listing is exactly `office:alpha`. The turn's transcript has one user message and one skill listing, and the turn reads the shared prefix from the cache. A `shouldQuery: false` message with no text also yields `init` without a model call, but stays in the conversation as a `(no content)` user message.
- **Meaning:** the start check runs before the brief (§5.6): the reload for the plugin and its errors, the listing for the skill names. It leaves nothing in the conversation and costs no model call.

### skills.project-names

- **Run:** a Project with a skill whose folder `deploy-folder` holds a frontmatter `name: deploy-named`, a skill `lint`, a nested skill under `apps/web`, a command `ship.md` and a command `frontend/notes.md`; the listing before any message under `skills: 'all'`, under allowlists of listed and of folder names, and with `skillOverrides` keyed each way. No model call.
- **Observed:** the renamed skill is listed as `deploy-named`, but the allowlist and `skillOverrides` match it by its folder, `deploy-folder`. The command in a subfolder is listed as `frontend:notes`, allowed by the bare `notes` (the suffix rule) and turned off only by `frontend:notes`. Root commands are listed at start like skills; the nested skill is not (as `skills.overrides-off` found).
- **Meaning:** The Office keys a Project skill by its folder and a command by its path under `commands/` with `:` between folders, for the allowlist and the overrides alike, and expects at start the names the listing gives the ones at the repository's top: a skill's frontmatter name, a command's key.

### skills.shell-execution

- **Run:** a session skill whose text holds ``!`git --version` ``, invoked through the Skill tool, once with the Office's options and once with `disableSkillShellExecution` false.
- **Observed:** with the Office's options the skill loads with `[shell command execution disabled by policy]` in place of the command, which never runs. With the setting off, the engine checks the command against the permission rules itself: under `permissionPrompts: 'none'` it is refused ("This command requires approval") and the Skill call fails. The `PreToolUse` hook sees neither.
- **Meaning:** a skill's load-time commands bypass the Office rules hook, which §6 relies on for every command, so §5.6 turns them off; the Agent runs what a skill asks for through its tools.

### skills.skill-command

- **Run:** a session with `echo` and `manual` (`disable-model-invocation: true`), each telling the model to reply with a marker followed by `$ARGUMENTS`. Before any model call, the listing (`getContextUsage().skills`) and `supportedCommands()`. Then, in the streaming input as The Office sends a user's skill command (plain text `/<listed name> <input>`): a plain message with `/office:echo fig-29` queued right behind it with priority `next`, before the first answer; into the idle session `/office:echo kiwi-17` and `/echo plum-23`; and `/office:manual pear-31`. For each command: whether a turn ended, whether the reply holds the marker (the skill ran) and the input, and whether the skill's text reached the turn with `$ARGUMENTS` replaced; for the queued one, whether the first turn's `user_message_uuids` name it and in which turn it ran.
- **Observed:** not recorded (`expectations.json` holds an empty entry, so a run reports it `unrecorded`); it needs a signed-in machine.
- **Expected, to confirm:** the full name `/office:echo` runs the skill with the input as `$ARGUMENTS`; the bare `/echo` is not the name the session knows it by; `manual` is in `supportedCommands()` but not in the listing, and runs as a command. Whether the queued command runs in the first turn or the next is what The Office's queueing of a skill command rests on.
- **Meaning:** The Office sends a skill command as `/office:<name> <input>`, the name the listing and `supportedCommands()` give, and offers a user-only skill as a command though the model never sees it.

### skills.allowlist-suffix

- **Run:** the session plugin with `alpha`, `beta`, `gamma` and `review`, a Project skill `review` and a second plugin `vendor` with `review`; allowlist `alpha`, `pha`, `office:beta`, `review`.
- **Observed:** `alpha` matches `office:alpha`, `pha` matches nothing, `gamma` is not listed, and a bare `review` enables `office:review`, the Project's `review` and `vendor:review` alike.
- **Meaning:** the allowlist matches the exact name or the `:<name>` suffix. The Office lists its own skills by full name (`office:<name>`) and checks allowed Project skill names against the session's other skill names (§5.6).

### skills.plugin-detection

- **Run:** three plugin folders: one without a manifest, one with a `SKILL.md` at its top, one folder of plugins.
- **Observed:** a folder without a manifest is one plugin named after the folder; a `SKILL.md` at the top makes the folder one plugin; a folder of plugins loads only the children with a manifest. No plugin errors.
- **Meaning:** the session folder always carries `.claude-plugin/plugin.json` with `{"name":"office"}`, so its name never depends on the folder's.

### skills.overrides-off

- **Run:** Project skills at the root (`deploy` off, `lint` on), nested under `apps/web` (`release` off by the key `apps/web:release`, `migrate` off by its bare name, `audit` on) and two `.claude/commands` files (`ship` off, `notes` on), all in the allowlist; then a Read of a file under `apps/web`.
- **Observed:** at start the session sees `lint` and `notes`; after the Read, also `audit` and `release`. Nested Project skills are listed by their bare name (`release`, not `apps/web:release`) and appear only once a file below them is read. The key `apps/web:release` hides nothing; the bare key hides `migrate`. `"off"` also hides a command file, from the listing and from `/name`.
- **Meaning:** when a Project turns its skills off, The Office writes one bare-name key per skill it finds anywhere in the repository, and per command file.

### skills.overrides-library

- **Run:** a Project with skills `review` and `lint` and the command `tools:review`, and a session with the library's `review`; the allowlist `office:review`, `lint` and `tools:review` and `skillOverrides` with `review` off, as The Office starts a session with the Project's copy turned off. No model call.
- **Observed:** the session lists `lint`, `office:review` and `tools:review`, and `/name` runs the same three. The bare key hides the Project's `review` and leaves on both the library's and the command ending in that name.
- **Meaning:** turning a Project skill off by its key is safe beside a library skill of that name or a command ending in it: the session keeps them, and its start check, which expects them, passes.

### skills.user-scope

- **Run:** a session under the Office's options on a workstation with user-scope installed plugins, user skills, synced skills and synced plugins.
- **Observed:** none of them loads. `~/.claude/commands` is absent on the Windows workstation, so that part proves nothing there. On the Linux container none of them is present, so the Linux run proves nothing here; the Windows run is the evidence. No variant with sync on was run, since it could write into `~/.claude`.
- **Meaning:** `settingSources: ['project']` with the sync settings off keeps the user's own Claude Code setup out of Office sessions; no per-session `CLAUDE_CONFIG_DIR` is needed. Each Claude Code engine runs with its own folder as `CLAUDE_CONFIG_DIR` ([5.4](spec/5.4-the-engine.md#defaults)); the engine check strips `CLAUDE_CONFIG_DIR` from its sessions and reads only `~/.claude`, so this check doesn't cover an engine's own folder.

### skills.resume

- **Run:** a session with `alpha` and `beta`, resumed with `beta` and `gamma`.
- **Observed:** the engine re-reads the folder (it lists `office:beta`, `office:gamma`) but attaches only the added skill for the model, so `alpha` stays named in the conversation's earlier listing.
- **Meaning:** §5.6 rebuilds the same recorded set on resume, because a changed set would leave the model believing in a removed skill. A Role's changed skills apply at the next fresh session.

### skills.deny-rule

- **Run:** a `Skill(office:beta)` deny rule.
- **Observed:** the skill stays in the listing and in `/name`; only its invocation is refused.
- **Meaning:** a deny rule cannot shape the listing; the session folder and the allowlist decide what a session sees.

## Permissions

### permissions.hook-sees-every-call

- **Run:** one session asked to Read a file in the worktree, Read a file refused by a path-scoped deny rule, Read a file outside the worktree and Write a file without an approval; a second session asked to start a subagent that reads a file. The engine may run the subagent in the background past its turn's result (seen on Linux), so the check waits for every started task to end.
- **Observed:** the `PreToolUse` hook is called before the engine answers for the allowed call, the Read outside the worktree, which the hook leaves undecided and the engine refuses for want of an approval surface (`asyncAgent`), the Write refused the same way and the subagent's own call (the subagent tool is `Agent` in `tool_use` though `init.tools` lists `Task`). A Read refused by a path-scoped deny rule never reaches the hook: it is refused at input validation ("File is in a directory that is denied by your permission settings."), sends no `permission_denied` message and shows only in `result.permission_denials`. The `PermissionDenied` hook was called for none of these refusals.
- **Meaning:** The Office sets no path-scoped deny rule and makes path decisions in the hook, and logs refusals from `result.permission_denials` and `permission_denied` messages, not from the `PermissionDenied` hook. The engine's own validation refuses some calls before any hook, which no option changes: a standalone `sleep N` in Bash is refused ("Blocked: standalone sleep") without a hook call.

### permissions.hook-refusal

- **Run:** a hook that refuses a Read with a reason naming another file to read instead.
- **Observed:** the model reads `PreToolUse:Read hook error: <reason>`, and reads the named file next. The refusal counts in `result.permission_denials` and sends no `permission_denied` message.
- **Meaning:** "Other refusals are immediate, with a reason the Agent reads" (§6) works through a hook `deny`. The brief tells the Agent to do what a refusal says.

### permissions.powershell-twin

Windows only.

- **Run:** five sets of rules, each read from `init.tools`, once with the Office's explicit tool list and once with the engine's default; then a PowerShell allow rule on `git *` beside a Bash deny rule on `git push`, with and without its PowerShell twin.
- **Observed:** with the engine's default tools, a Bash deny rule alone removes `PowerShell` from the tools; any PowerShell rule beside it (the twin deny, or even an allow) keeps it; a Bash allow rule alone leaves it. With the Office's explicit list, PowerShell stays under every rule set. A Bash deny rule does not reach PowerShell: without the twin, `git push` through PowerShell runs (and fails only for want of a remote); with the twin it is refused by the rule, and `git status` runs.
- **Meaning:** every shell rule The Office writes on Windows has its PowerShell twin, and with the explicit tool list the twin is the only thing that stops the command through PowerShell. §6 gives that reason.

### permissions.read-fence-off

- **Run:** with a `CLAUDE.md` in the folder above the worktree; under a hook that allows them, four commands the engine refuses under the fence (`true | cat; echo "status=${PIPESTATUS[0]}"`, `node -v`, `git -C <another repository> log -1 --oneline`, `cat <a file outside>`), each in a session of its own with `blockReadsOutsideWorkingDirectories` on, then all four in one session with it off, followed there by Read, Grep and Glob on a file and folder outside the worktree, which the hook also allows; the instruction files that session loaded, and those of a session without `claudeMdExcludes`.
- **Observed:** with the fence on, `node -v` runs and the other three are refused past the hook's `allow`: under the fence the engine judges every shell command and asks when its parser can't show the command reads only inside (a variable in braces, a folder named outside, a file read outside), and with no approval surface it refuses, naming the setting at the end of a long message that also tells the model not to retry. After one such refusal it refuses every later call that would ask (`circuitBreaker: outsideReadsBlocked` in the transcript), so a single session stops early. With the fence off all four commands run, and Read, Grep and Glob read outside: nothing but the hook fences the file tools then. Without the fence the engine also loads a `CLAUDE.md` in a folder above the worktree, typed `Project` in the context usage (on the workstation the user's own `~/.claude/CLAUDE.md` reached `fallback.start` that way); with the Office's `claudeMdExcludes` naming those files, none loads. The same on Windows and Linux.
- **Meaning:** the fence refuses commands the Office rules allow, so §6 turns it off, and the hook alone fences Read, Grep and Glob, letting a session read its own skills folder.

### permissions.protected-paths

- **Run:** writes to `.git/`, `.claude/` and `.mcp.json` and a control write, under three grants that approve other writes: `acceptEdits`, an `Edit(//<repo>/**)` allow rule, a hook `allow`.
- **Observed:** the control write goes through under each; the three protected writes are refused under each, typed `asyncAgent` with the decision reason "no approval surface in this session", the same as any other refusal for want of approval.
- **Meaning:** the engine never auto-approves the protected paths, even past a hook `allow`, but its refusal cannot be told apart from any other. §6 has the hook refuse Agents' writes there first with a clear reason, the engine's protection staying as a backstop.

### permissions.devcontainer

- **Run:** under a hook that allows every Write, a Write to `.devcontainer/devcontainer.json`, and in another session and repository an in-process Office tool, allowed by rule, that writes the same file from the host.
- **Expected:** the Write is refused by the engine past the hook's `allow`, as `.devcontainer/` is one of its sensitive paths and `permissionPrompts: 'none'` refuses what would prompt, and the file is not on disk; the Office tool's call is allowed and the file is on disk.
- **Meaning:** Agents write the run environment definition through `write_run_environment_definition`, which checks it first (§6); no allow rule lifts the engine's protection, which stays the backstop. Not recorded: it needs a signed-in machine.

### permissions.hook-after-resume

- **Run:** a hook allows a Write; the session is closed and resumed with a hook that refuses every Write, and asked for another.
- **Observed:** the hook is asked afresh after the resume and its refusal applies (the reason reaches the model, the file is not written); the allow from before the resume is not kept.
- **Meaning:** hook decisions survive a resume because The Office registers the hook on every start; nothing granted in a session carries over. Permissions granted in a session don't survive a resume.

## Engine behaviour

### engine.priority-next, engine.priority-later, engine.priority-now

- **Run:** while a 30 s command allowed by the hook runs, a message is sent with priority `next`, `later` or `now` (`now` twice: without an origin, and with `origin: {kind: 'human'}`, which the SDK asks a host relaying typed input to stamp). The turn that took it is read from the result's `user_message_uuids`.
- **Observed:** `next` lands in the running turn after the tool call ends. `later` waits for the turn to end and starts the next turn by itself. `now` does not stop the command. Without an origin, the command runs to its end, then the turn ends early (`aborted_tools`) and the message starts the next. With a human origin, the command moves to the background and keeps running; on Windows the turn then ends early and the message lands in the next, while on Linux (every run alike) the message lands in the running turn, which goes on.
- **Meaning:** barge-in is `next` (§2.4, §5.4). `now` is not used, and Stop is `interrupt()` (§5.4).

### engine.interrupt

- **Run:** `interrupt()` while a 30 s command runs, then a next message in the same `query()`, then a resume by id after closing.
- **Observed:** the running Bash call is rejected at once (`aborted_tools`, result `error_during_execution`) and the command itself ends, on both platforms (its end marker never appears). `interrupt()` returns a receipt listing what is `still_queued` (`interrupt_receipt_v1` in `init.capabilities`). The same `query()` takes the next turn, and a resume by id afterwards works.
- **Meaning:** Stop as §2.4 and §5.4 describe it; the Stage's uncommitted edits are then discarded by The Office (§5.5).

### engine.office-tool

- **Run:** an in-process `office` server from `createSdkMcpServer()` with one tool, called with and without an `mcp__office` allow rule.
- **Observed:** the tool is in `init.tools` as `mcp__office__handover_note` and its server is `connected`. With the allow rule the hook sees the call first and the handler runs with the arguments asked for. Without it, `permissionPrompts: 'none'` refuses the call (`asyncAgent`) and the handler never runs.
- **Meaning:** Office tools work in-process (§5.4), and The Office allows its own tools by rule (§6 build rules).

### office-tools.deferred, office-tools.deferred-p

The check behind `CLAUDE_CODE_DEFERS_OFFICE_TOOLS` (spec 5.4.1 › Loading by area), which is on since both items passed. On `claude-haiku-5-5`, on the SDK and on `-p`.

- **Run:** one Office server with two tools, one always loaded (`_meta['anthropic/alwaysLoad']`) and one with no mark: on the SDK from `createSdkMcpServer()`, on `-p` served through the binary's stream. Turn 1 calls the loaded tool. Turn 2 loads the deferred tool with `ToolSearch` (`select:mcp__office__deferred_note`) and calls it.
- **Observed** on Linux, 2026-11-27, the same on both routes: the deferred tool is out of the session's tool list at the start (`deferredToolListedAtStart` is `false`), its call reaches its handler with the input the model gave after a `ToolSearch` call (`deferredCallReachedHandler`, `toolSearchBeforeDeferredCall`), and turn 2 reads turn 1's prompt from the cache (`secondTurnReadsFirstTurnsPromptFromCache`), so loading the tool left the cached prefix as it was. About 10 s and 110k cache-read tokens an item.
- **How "at the start" is read:** the `init` message's `tools` names deferred tools too, so a tool counts as listed at the start only when the transcript's first `deferred_tools_delta` attachment, the deferred tools the engine announced to the model, doesn't name it.
- **Re-check** on the machine that holds the engine's sign-in: `npm run engine-check -- --only office-tools. --record`.
- **Meaning:** Claude Code can defer the Office tools of the areas a session isn't started with without breaking the prompt cache, so Core and the home's areas load from the start and the Agent loads the rest by name.

### engine.decision-wait

Slow: about an hour; runs only with `--include-slow`, once per SDK bump. The same on Windows and Linux.

- **Run:** an Office tool opens a Decision and its result tells the Agent to end its turn and wait; the answer is sent as the next message into the still-open `query()` 62 minutes later (`ENGINE_CHECK_DECISION_WAIT_MINUTES`).
- **Observed:** the Agent made no further tool call and ended its turn; the answer continued the work in the same session (it read the chosen file). That turn read nothing from the cache: the hour had passed and the Office tool in the tool list gives the session a prefix no other session kept warm.
- **Meaning:** Agents wait on Decisions as §2.4 describes, with no session kept busy; the first turn after a long wait pays the full prompt again, which the Context policy (§2.5) weighs.

### engine.long-office-tool, fallback.long-office-tool

Slow: 11 minutes each (`ENGINE_CHECK_LONG_TOOL_MINUTES`); run only with `--include-slow`. It covers `run_project_command` (spec §6, "Agents run checks through an Office tool"), which answers only once the Project's command ends.

- **Run:** one turn calling an Office tool whose handler answers after the wait: on the SDK from `createSdkMcpServer()`, on `-p` served through the binary's stream.
- **Observed:** not recorded; it needs a signed-in machine. Read from the pinned versions instead, not from a session: the binary (2.1.310) limits an MCP tool call to `MCP_TOOL_TIMEOUT`, else 1e8 ms (about 28 hours), capped at 2^31−1 ms; a server of type `sdk` has no idle timeout (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` applies to stdio and remote servers only); an `mcp_message` control request that is a request (it has an `id`, as `tools/call` does) is sent with no timeout, only notifications get one; the SDK (0.3.310) keeps the request pending until the server answers, with no timeout of its own. The Office's sessions carry no `MCP_*` variable (`sessionEnvironment`), so the default applies on both routes.
- **Meaning:** a Project's test run of 10 minutes or more through an Office tool isn't cut short on either Claude Code route, so The Office sets no `MCP_TOOL_TIMEOUT`; the command's own 30-minute limit ends it first.

### engine.resume-cache

- **Run:** a turn with a tool call, close, resume by id within the hour, another turn.
- **Observed:** the resumed turn reads the whole earlier conversation from the cache; every cache write uses the 1-hour lifetime. After a session's only request (a turn without tool calls), the next request reads just the system prompt part, so the first message is written again once.
- **Meaning:** Resume while the cache is warm (§2.5) is cheap, as assumed.

### engine.rate-limit-event

- **Run:** one turn, collecting `rate_limit_event` messages, then the experimental usage query.
- **Observed:** the event carries `resetsAt` but no top-level `utilization`, and names one `rateLimitType` (`five_hour`). Both windows, each with `utilization` (a 0–1 fraction) and `resetsAt`, are only in `rate_limit_info.unifiedWindows`, which the typings do not declare. The usage query has `five_hour` and `seven_day` with `utilization` (0–100) and `resets_at`.
- **Meaning:** §5.4 names both sources; the adapter treats the event as the signal and reads the windows from the usage query, never from the undeclared field.

### engine.usage-window-refusal

**Not recorded:** it needs a signed-in machine whose account has a used-up window.

- **Run:** the usage query first, which makes no model call. While no window it reports (`five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `seven_day_oauth_apps`, each `model_scoped` window) is at 100%, the check is **skipped** with that reason and spends no turn. Otherwise one turn, recording which message kinds arrive, the `rate_limit_event`'s statuses and fields, the assistant messages' `error` and whether their text is a usage limit, whether a tool call was made, and the result's `subtype`, `is_error`, `terminal_reason`, `api_error_status` and whether its text is a usage limit. The texts and reset times stay in the report, as they vary by account and hour.
- **Read from the pinned SDK's typings and the pinned binary's code** (0.3.310), not from a session:
  - A used-up window comes back from the API as HTTP 429 with the `anthropic-ratelimit-unified-*` headers. The binary reads them into the rate-limit info with `status: "rejected"`, `rateLimitType` from the header (`five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `seven_day_overage_included` or `overage`, the typings' list), `resetsAt` in epoch seconds when the header has one, and the overage fields.
  - It ends the turn with a synthetic assistant message, not a model reply: `error: "rate_limit"`, one text block that starts with one of the SDK's `USAGE_LIMIT_ERROR_PREFIXES` (such as "You've hit your limit · resets 2pm"), `apiError: "usage_limit_reached"` internally. The same `error` value, `rate_limit`, is used for other 429s (a usage limit without the unified headers), so it alone doesn't name a window.
  - The result has no rate-limit subtype: the typings' error subtypes are about turns, budgets and schema retries, so a refused turn is expected as `subtype: "success"` with `is_error: true`, the text as `result` and `api_error_status: 429`. Unconfirmed live, as is `terminal_reason`.
  - Overloaded (529) and server errors (5xx) end with `error: "overloaded"` or `"server_error"` after the engine's own retries (`system:api_retry` messages); no rejected `rate_limit_event` is made for them, as the info is read only from a 429's headers.
- **Meaning:** a turn is refused for a used-up window when it ends with an error after a `rate_limit_event` with `status: "rejected"` in the same turn; the window and the reset come from that event. `error: "rate_limit"` without a rejected event, and any error after an `allowed` event, stay ordinary failures (§5.4).

### engine.session-carry-over, fallback.session-carry-over

**Not recorded:** it needs a signed-in machine with two Claude Code folders.

- **Run:** what The Office does when a Stage's engine refuses a turn for a used-up usage window and a Stand-in Engine goes on with it (spec §5.4): the session is carried from one engine's config folder to the other's and resumed there. On the SDK (`engine.`) and on `-p` (`fallback.`): a first turn in the account the other checks run on (`~/.claude`, as their environment drops `CLAUDE_CONFIG_DIR`), on `claude-haiku-5-5`, given a code word, running `node long-output.mjs` with Bash (about 120 KB, past what the engine gives the model whole, its last line holding a second word) and a foreground Sub-agent (`general-purpose`, `model: "haiku"`) answering a third word. The session is closed, then carried to the folder `--second-claude-config` names by the tool's copy of the service's carry-over (`tools/engine-check/src/session-carry-over.ts`, kept as `apps/service/src/modules/engine/adapters/claude-code/session-carry-over.ts`): `projects/<name>/<id>.jsonl` found by its file name, the `<id>/` folder beside it (`subagents/`, `tool-results/`), the first folder's path rewritten to the second's in every `.jsonl` (as a POSIX path and as a Windows path inside JSON), `todos/<id>-*.json`, not `file-history/`. Then the session is resumed in the second folder (`CLAUDE_CONFIG_DIR`) and asked for the code word, the Sub-agent's word and the saved output's last line, read from the file its result named. What it carried is removed from the second folder afterwards. Skipped, with the reason, without a second folder or when `claude auth status` says it isn't signed in.
- **Records:** how each turn ended; whether the first folder held the transcript, a Sub-agent transcript and a saved tool result (`written`), and the second after the carry (`carriedFiles`); whether a carried `.jsonl` still names the first folder; whether the resumed session kept its id; whether the answer holds each of the three words; where the resumed session's Read of the saved result went (`the second folder`, `the first folder`, `elsewhere` or `not read`).
- **Expected, to confirm:** the files are where the carry-over looks for them (`written` all true), the resume in the second folder finds the carried transcript and keeps the id, and the answer holds all three words, the saved result read from the second folder. A Claude Code update that moves a session's files or changes how a resume finds them shows here first.
- **Observed:** not recorded.
- **Not covered:** whether the binary drops, on resume, the synthetic "You've hit your limit" assistant message a refused turn leaves at the end of the transcript (`error: "rate_limit"`, see `engine.usage-window-refusal`), or sends it to the model as part of the conversation. This check can't make a refused turn; it is read from a real one, a Stage carried over after its engine's window ran out, in the resumed session's first request.
- **Meaning:** a Stand-in Engine goes on with a Stage in the same session, its earlier turns, Sub-agents and saved tool results intact, rather than starting fresh (spec §5.4).

### engine.usage-read-alone

**Not recorded:** it needs a signed-in machine.

- **Run:** what the Agent SDK adapter's `readUsageWindows` does every 5 minutes while nothing runs on the engine (spec §5.4): a `query()` opened for the read alone, on the account's config folder as its working folder, with no tools (`tools: []`), no settings (`settingSources: []`), `strictMcpConfig`, `persistSession: false` (the SDK passes `--no-session-persistence`) and a prompt that never sends a message; the usage query with `skipBehaviors: true`; then the prompt and the query closed. The files under the config folder's `projects/` are listed before and after, and the engine's process is started by the check's own `spawnClaudeCodeProcess`, so its end is seen.
- **Expected:** the usage query answers both windows (`utilization` and `resets_at`) as in `engine.rate-limit-event`; no `assistant` or `result` message comes (`modelCalled` false), so no model call; no new file under `projects/` (`newTranscriptFiles` 0); the process ends once the query is closed (`processEnded` true).
- **Meaning:** the usage windows are read with no session, no transcript and no quota spent, so a used-up window found free again is known while every Task on the engine is paused (§5.4). The `-p` adapter reads the same way on the pinned binary (`--no-session-persistence`, `--tools=`, `--setting-sources=`, `--strict-mcp-config`, the `get_usage` control request before any message); not checked separately, as the binary is the one the SDK runs.

### engine.window-start, fallback.window-start

**Not recorded** (`expectations.json` holds an empty entry for each): it needs a signed-in machine whose 5-hour window isn't running.

- **Run:** what The Office does to start a Claude Code engine's 5-hour window by itself (spec §5.4.6, `AgentEngine.startUsageWindow`). First the 5-hour window's `resets_at` is read by the usage query on a query opened for it alone, as in `engine.usage-read-alone`; while it is ahead the window already runs, and the check is **skipped** with that reason, spending no turn. Otherwise one turn as the adapter runs it, on the account's config folder (`~/.claude`) as its working folder: on the SDK (`engine.`) a `query()` with the prompt "Reply with OK." as a string, `model: "claude-haiku-5-5"`, `maxTurns: 1`, `tools: []`, `settingSources: []`, `strictMcpConfig`, `persistSession: false`, its process started by the check's own `spawnClaudeCodeProcess`; on `-p` (`fallback.`) the pinned binary with stream-json each way, `--tools=`, `--setting-sources=`, `--strict-mcp-config`, `--no-session-persistence`, `--model=claude-haiku-5-5` and `--max-turns=1`, the prompt sent as one message and the input closed once the result came. The files under `projects/` are listed before and after; then the window is read again. The model and prompt are kept as the service's `WINDOW_START_MODEL` (`apps/service/src/modules/engine/adapters/claude-code/usage-window-start.ts`) and `WINDOW_START_PROMPT` (`apps/service/src/modules/engine/adapters/shared/usage-window-start.ts`).
- **Records:** how the turn ended (`turnEnded`); whether the 5-hour window then resets about 5 hours after the start, within 15 minutes (`windowOpened`); how many files appeared under `projects/` (`newTranscriptFiles`); whether the process ended within 10 s of the turn (`processEnded`); whether the result counted input and output tokens (`tokensCounted`). The start runs outside the runner's sessions, so its tokens aren't in the run's total.
- **Expected, to confirm:** `completed`, `windowOpened` true, `newTranscriptFiles` 0, `processEnded` true, both token counts.
- **Meaning:** one small turn on the cheapest model starts the account's 5-hour window, keeping no session, transcript or process (§5.4.6).

### engine.parallel-sessions

- **Run:** three sessions in three worktrees of one repository, each held inside a tool call by a hook barrier until all three arrive.
- **Observed:** all three were inside a tool call at once and ended normally, as distinct sessions.
- **Meaning:** the Office-wide limit of 3 running Tasks (§2.2 Defaults) is within what the engine runs on one login.

### engine.lean-options

- **Run:** a first call in each of two worktrees of one repository under the Office's options; a session started without a model call with a short `tools` list (Bash, Edit, Glob, Grep, PowerShell on Windows, Read, Skill, Write) and `strictMcpConfig`.
- **Observed:** the first call under the Office's options is about 28k tokens on Windows (the system prompt and 27 built-in tools, 24.6k, cached and shared, plus the first message) and about 23k on Linux (26 tools, no PowerShell). The engine's default set on Linux has no Grep or Glob; naming them in `tools` brings them back. The second worktree's first call reads the same prefix from the cache as the first's, so the cached prefix is identical across Tasks. No claude.ai connector loads. The short list brings the start to about 10k.
- **Meaning:** §5.1's stable cached prefix holds across worktrees. §5.4 names the tools explicitly so both platforms get the same set. A first call close to §2.5's 30k resume-or-brief threshold is the cost of that set.

### engine.turn-usage

- **Run:** one turn that starts a subagent with the Task tool and then reads a file, then a second turn interrupted while its command runs; each assistant frame's `message.usage` is compared with the turn's `result.usage`.
- **Observed** (the same on both platforms): every assistant frame carries `message.usage`, a subagent's frames (`parent_tool_use_id` set) and an interrupted turn's too. The frames of one message (one per content block, sharing its id) repeat the same usage; it does not grow. A frame's `output_tokens` is what was known as the message began (single digits), so the turn's result reports far more output (about 350 against 30 here). `result.usage`'s input, cache reads and cache writes are exactly the sum of the main loop's messages: a subagent's messages are left out (they show only in `modelUsage`, which adds up over the session). An interrupted turn (`aborted_tools`) reports its main-loop messages the same way, its output included, not zero. Not checked here, as the moment can't be timed, but seen in a check on the Test Project (in the session's transcript): a turn Stopped while a message still streamed, after its Edit call had run, reported usage without that message, whose frames had shown about 39k tokens, mostly cache reads.
- **Meaning:** live tokens (§2.4) count each message id once from its frames, main loop only, so the count The Office shows during a turn rises with each message's input and cache tokens and the turn's own usage replaces it at the end with a jump of the output alone. The Office takes a turn's usage, part by part, as at least what its messages streamed (`TurnTokens.settled`), so a message cut off mid-stream still counts. Budgets count that usage, so a subagent's tokens are in no budget; an interrupted turn's tokens are counted as spent.

### engine.auto-memory

- **Run:** a session asked to save a fact to its auto-memory, under the Office's options and with `autoMemoryEnabled: true` (the engine's default).
- **Observed:** under the Office's options `init` names no memory folder, the model has none to write to, and no folder is created. With the engine's default, `init.memory_paths` (not in the typings) names `~/.claude/projects/<repository>/memory/`, and the model writes there with no prompt despite `permissionPrompts: 'none'`; the hook sees those writes first.
- **Meaning:** §5.4 turns auto-memory off: its folder is outside the worktree, shared by every worktree of a repository and every Role, and outside the Brief. Memory stays The Office's own (Memory). The engine auto-allows writes to some of its own paths outside the worktree, so `permissionPrompts: 'none'` does not keep writes in the worktree: the hook fences writes itself.

### engine.lsp-tool

- **Run:** on the SDK and on `-p`, a plugin beside the session plugin (`.claude-plugin/plugin.json` with `lspServers`) naming a stand-in language server that logs what it gets (`checks/engine/stand-in-language-server.mjs`, so the check needs nothing installed). Five sessions on each: a Read then a goToDefinition with the hook allowing it; a Read then an Edit; a goToDefinition the hook refuses; a server whose command doesn't exist; no plugin at all.
- **Observed** (on Linux, with a stand-in model on a local Messages API; not recorded in `expectations.json`, which needs a run on `claude-haiku-5-5` on a signed-in machine): `LSP` in `tools` is enough, with no setting or `ENABLE_LSP_TOOL`. The tool is deferred, so the model loads it with ToolSearch. The plugin's manifest and a `.lsp.json` both load under `settingSources: ['project']`; two `--plugin-dir` flags work on `-p`. `reloadPlugins` isn't held and reports no error. The input is `operation`, `filePath`, `line` and `character` (1-based), and `query`. The hook sees each call; `permissionPrompts: 'none'` needs its allow. A server starts at the first LSP call or Edit of a file of its language, never with the session or on a Read; it gets the session's folder as its working folder and `rootUri`, and the binary's environment. A server whose command doesn't exist is no plugin error: its call answers `ENOENT`, and the session runs on. With no server the engine drops `LSP` from `init.tools` ("LSP is disabled for this session"), whatever `tools` names. After an LSP call the server's diagnostics join the conversation unasked, as a `<new-diagnostics>` system message; a server's `diagnostics: false` would turn that off. The tool filters out locations in files git ignores.
- **Meaning:** The Office names `LSP` for every session and hands the found servers over as a plugin of their own (spec §5.4), and judges each call as a read (§6). A JVM per session is no cost until a session works in Kotlin. Real servers' behaviour is in [language-servers.md](language-servers.md).

### engine.background-tasks

- **Run:** two sessions (spec §2.9). The first runs `node count.mjs` with Bash in the background (three lines a second apart, then exit 3), watches `node watch.mjs` with Monitor, starts a foreground and a background Sub-agent with the Task tool (`general-purpose`, `model: "haiku"`), waits up to 90 s for each end, and reads the command's output file. The second starts a 60 s command in the background, then a background and a foreground Sub-agent that each run it, and interrupts the turn 4 s after the third start; 10 s later it looks at what the engine ended. Whatever still runs is stopped with `stopTask` before the session closes.
- **Records:** for each kind, whether `task_started` came, its `task_type` and `is_backgrounded`, the `task_notification` status and reason, and the call's structured result status (`completed`, `async_launched`); whether a Sub-agent's messages stream with `parent_tool_use_id` (the background one's too); the `task_type` of the Monitor call; whether the exit code shows in the notification's `summary` or in the output file; whether the Bash result names the output file, whether the notification names the same one, where it is (`repository`, `temp folder`, `home folder`), and whether the check could read every line from it; the task types `background_tasks_changed` listed; and, for the interrupt, what became of each of the three.
- **Observed:** not recorded. The service's `BackgroundTasks` (`apps/service/src/modules/engine/adapters/claude-code/background-tasks.ts`) assumes what spec 2.9 expects: a foreground Sub-agent starts from its call whether or not `task_started` comes; a background one ends with its notification and its `summary`; a Process's output file is named in its Bash result ("Output is being written to: …") and in the notification's `output_file`; no exit code (unless a `summary` names one); `local_bash` alone is a Process, as Monitor's `task_type` isn't recorded; an interrupt stops a foreground Sub-agent and leaves background work running.

### engine.foreground-sub-agents

- **Run:** one session whose `PreToolUse` hook allows a Sub-agent call (`Agent` or `Task`) with `updatedInput` setting `run_in_background: false`, every other field as the model gave it, as the Office rules hook does in a Stage session (spec 2.9, "In a Stage"). One turn asks for a background Sub-agent (`general-purpose`, `model: "haiku"`) that replies with a word, then for the Agent to repeat what it answered.
- **Note:** a Sub-agent's text streams with `parent_tool_use_id` only when the query option `forwardSubagentText` is true (the SDK's `sdk.d.ts`); by default the SDK forwards just its `tool_use` and `tool_result` blocks. The service sets it (`sdk-options.ts`), and the same holds for `engine.background-tasks`' Sub-agents.
- **Records:** how the turn ended; whether the model's call still asked for the background; the call's structured result status (`completed` in the foreground, `async_launched` in the background); `task_started`'s `is_backgrounded`, if it came; whether the word is in the call's result and in the turn's result.
- **Observed:** not recorded. The service's hook and `BackgroundTasks` assume the engine takes the hook's `updatedInput` in place of the call's input: the call answers `completed` with the Sub-agent's word, within the turn.

### engine.api-key-sign-in

**Not recorded** (`expectations.json` holds an empty entry): it needs an Anthropic API key.

- **Run:** `ENGINE_CHECK_API_KEY_FILE=<file> npm run engine-check -- --only engine.api-key-sign-in`, the file holding an Anthropic API key (a relative path is taken from where npm runs). Without the variable the check is skipped, saying so. The check signs in a config folder of its own, in its sandbox, as The Office signs in a Claude Code engine by an API key (spec §5.4, §6): the folder holds no login, the key goes in its owner-only `.anthropic-api-key`, and the session settings carry `apiKeyHelper`, a command printing that file with the Node the check runs on (`'<node>' '-e' 'process.stdout.write(fs.readFileSync(process.argv[1]))' '<file>'` on Linux, each word in double quotes on Windows; the tool's copy of the service's `printFileCommand`). The session runs with `CLAUDE_CONFIG_DIR` on the folder and the Office's environment, which holds no `ANTHROPIC*` or `CLAUDE*` variable of its own; the model is the cheapest, `claude-haiku-5-5`. First `claude auth status --json` on the folder, with the same environment and no settings, as the service runs it; then one short turn in which the Agent runs `env` with Bash (the hook allows that command alone) and replies OK.
- **Records:** whether the turn answered (`result` `success`, not `is_error`); `init`'s `apiKeySource` (the typings name `apiKeyHelper` for the helper); `auth status`'s exit code and its plain fields by name; whether the `env` call ran, whether its output holds the key or any 8 characters of it past the `sk-ant-api03-` every key shares, whether it names `ANTHROPIC_API_KEY`, and the names (never the values) of its `ANTHROPIC*` and `CLAUDE*` variables; the `rate_limit_event`s' statuses, `rateLimitType`s and field names. The key is never printed or recorded: every string in the session's messages and hook calls that holds part of it is replaced before the report keeps it.
- **Expected, to confirm:** read from the pinned binary's code (2.1.310, SDK 0.3.310), not from a session: a configured `apiKeyHelper` makes the binary use the key rather than a claude.ai login, so the turn answers and `apiKeySource` is `apiKeyHelper`; `auth status` without the settings says signed out (why the service reads an engine with a key file as signed in by an API key without asking it); the key reaches no command's environment, and `ANTHROPIC_API_KEY` is not set. What the `rate_limit_event`s carry on an API key, which has no 5-hour or 7-day window, is unknown.
- **Meaning:** an engine signed in by an API key runs its sessions on the key through `apiKeyHelper`, and an Agent can't read the key from its commands' environment (spec §5.4, §6).

## The `-p` fallback

Each capability of `EngineCapabilities` on the pinned binary in `-p`, started as [How a check runs](#how-a-check-runs) describes (spec §5.4 Defaults). Every check gave the same result on Windows and Linux.

### fallback.start

- **Run:** a session with two session skills in the folder given by `--plugin-dir`, a Project skill the Role has (`lint`) and one turned off by `skillOverrides` (`deploy`), and one Office tool served through the stream; the SDK adapter's start check (`reload_plugins` holding on cache impact, then `get_context_usage`) before any message, then a message that does not query, then `get_usage`. No model call.
- **Observed:** the binary is 2.1.310 and keeps the session id given. The start check works as on the SDK: nothing held, no plugin errors, the `office` plugin at its folder, and the listing is exactly `lint`, `office:alpha`, `office:beta`. `init` lists exactly the Office's tools plus `mcp__office__handover_note`, one MCP server, `office`, `connected`, no other plugin, no claude.ai connector, no auto-memory folder; no memory files load (none listed, 0 tokens in the `memory_files` category; a session started without the Office's settings showed about 2.4k there, with auto-memory on). `get_usage` answers with `five_hour` and `seven_day`, each with `utilization` and `resets_at`. Before any turn the binary sends the Office tool server `initialize`, `notifications/initialized` and `tools/list` as `mcp_message` requests; it asked the host nothing else. Before any turn `get_usage` follows the account's state: at times it answers without `resets_at`, without `resets_at` and `utilization`, or with no window at all. So the check records only that the query answers; the live contract's `usage-windows` scenario, which reads them after a turn, finds `percentUsed` in both windows on both platforms.
- **Meaning:** the skills of §5.6 hold on `-p` without the SDK's allowlist: the setting sources, the overrides and the session folder leave exactly the session's skills. The lean options of §5.4 hold as flags and settings. `contextUsage` and `usageWindows` hold through control requests, `officeTools` through the stream, with no `initialize` request from the host.

### fallback.tools-and-rules

- **Run:** one turn that calls the Office tool (served through the stream), runs a command the hook endpoint allows (a script writing whether the session's token is in its environment, not the token), runs one it refuses with a reason, and runs a session skill with the Skill tool.
- **Observed:** the Office tool's call reaches the handler with the note asked for (a `tools/call` `mcp_message`), after the hook saw it. The allowed command runs; the refused one is `denied` and the model reads the hook's reason. The skill runs under the `Skill(office:alpha)` rule. The hook endpoint gets `PreToolUse` and `PostToolUse` calls, each with the token. **The token is in the environment of the Agent's commands.**
- **Meaning:** the Office rules reach the service on `localhost` and the Office tools through the binary's stream (§5.4 Defaults, §6), and skills run as on the SDK. An Agent can read its own session's token and call that session's hook endpoint directly. Wherever the token goes (environment, command line or a file), a process of the same user can read it, so it ties a call to a session but does not keep an Agent out.

### fallback.hook-unreachable

- **Run:** the hook points at a `localhost` port nothing listens on; one turn reading `README.md`.
- **Observed:** the Read call is `denied` (in `permission_denials`) and its result is `PreToolUse:Read hook error: […] failed; blocking because onFailure is "block"`; the file's content never reaches the model.
- **Meaning:** with `onFailure: 'block'` the Office rules refuse when the service can't be reached (§6). The engine's default for a failing hook is `continue`, which would let the call go ahead (the SDK's `Settings` typings), so the flag is required.

### fallback.output-schema

- **Run:** a turn under `--json-schema` asking for `{answer: "OK"}`.
- **Observed:** the turn completes with `structured_output` exactly `{answer: "OK"}`. The turn streams `rate_limit_event`, with `resetsAt` and a `rateLimitType`; which window it names follows the account's use (`seven_day` on these runs, `five_hour` in `engine.rate-limit-event`), so only that it names one is recorded.
- **Meaning:** `outputSchema` holds. `usageWindows` reads the windows from `get_usage`, with the event as the signal, as on the SDK (`engine.rate-limit-event`).

### fallback.usage-window-refusal

Not recorded, as `engine.usage-window-refusal`.

- **Run:** as `engine.usage-window-refusal`, on the pinned binary in `-p`, with `get_usage` deciding whether to skip.
- **Expected:** the same messages as on the SDK, since `-p` streams the binary's own messages, which the SDK passes on unchanged.

### fallback.interrupt

- **Run:** as `engine.interrupt`, with an `interrupt` control request while the 30 s command runs, a next turn in the same process, then a new process with `--resume`.
- **Observed:** the same as on the SDK: the receipt lists `still_queued` (`interrupt_receipt_v1` in `init.capabilities`), the turn ends `aborted_tools`, the Bash call fails and the command itself ends, the next turn completes, and the resumed session continues under the same id.
- **Meaning:** `interrupt` and `resume` hold.

### fallback.priority-next, fallback.priority-later

- **Run:** as `engine.priority-next` and `-later`, the message written to the binary's input with its `priority`.
- **Observed:** the same as on the SDK: `next` lands in the running turn after the tool call ends; `later` waits for the turn to end and starts the next.
- **Meaning:** `bargeIn` holds.
- **Why the Office tools go through the stream:** served over HTTP, an Office tool's answer races the message written to the binary's input, so `bargeIn` doesn't hold at an Office tool's end on Windows: with the `AgentEngine` contract's `barge-in` scenario (a `next` message while the Office tool runs, the tool answering at once) the turn ends consuming the brief only, and the message lands in the next turn; with 1.5 s between the message and the answer it lands in the running turn. On Linux the scenario passes. On the SDK the tool's answer comes back through the binary's input after the message, so the order holds. The binary acknowledges each message it reads with a `command_lifecycle` line (`state: "queued"`, `command_uuid` the message's uuid; then `started`, `completed`), about 3 ms after the write, with or without `--replay-user-messages` (which echoes the message only once a turn takes it); `command_lifecycle` is not in the SDK's typings and the SDK doesn't read it. So the Office tools are served through the binary's stream (spec §5.4 Defaults); see `fallback.priority-next-office-tool`.

### fallback.priority-next-office-tool

- **Run:** one turn calling an Office tool served through the stream whose handler sends a `next` message before it answers, as the contract's `barge-in` sends one while a held Office tool waits.
- **Observed:** on Windows and on Linux the message lands in the running turn: its result lists the brief and the message. The service's `ClaudeCodePEngine` passes the contract's `barge-in`, and the whole contract (10 of 10), on both.
- **Meaning:** through the stream the tool's answer goes down the binary's input after every message sent before it, as on the SDK, so `bargeIn` holds at an Office tool's end too.

### fallback.background-tasks

- **Run:** as `engine.background-tasks`, on the `-p` route, with an `interrupt` control request.
- **Observed:** not recorded. The service maps the `-p` stream with the same `BackgroundTasks`, so a difference from `engine.background-tasks` (such as no `tool_use_result` on the `-p` stream, which the mapping then reads from the result's text) is read here.

### fallback.foreground-sub-agents

- **Run:** as `engine.foreground-sub-agents`, on the `-p` route, the hook answering over `localhost`.
- **Observed:** not recorded. The service's `-p` hook endpoint returns the same `updatedInput` as the SDK's hook, so a difference from `engine.foreground-sub-agents` is the binary's reading of an HTTP hook's output.

## The Codex app-server

The Codex engine's capabilities on the pinned `codex app-server` (spec §5.4 Defaults, the Codex engine). A `codex.*` check starts one app-server process per session, the native binary of the pinned `@openai/codex` (`codex/pinned-codex.ts`, found as the package's launcher finds it), speaking JSON-RPC over stdio, one message per line without a `"jsonrpc"` member (`codex/json-rpc.ts`):

- the environment above without `OPENAI*` and `CODEX*` variables, then `CODEX_HOME` the folder `--codex-home` names, and `OFFICE_TOOL_TOKEN` when the session has Office tools;
- `app-server` with `-c` overrides only, never a change to the folder's `config.toml`: `sandbox_workspace_write.exclude_slash_tmp` and `.exclude_tmpdir_env_var` true (the `workspace-write` sandbox otherwise lets commands write in `/tmp` and `$TMPDIR`), `sandbox_workspace_write.network_access` false, `check_for_update_on_startup` false, `web_search` `disabled`, `history.persistence` `none`; `config/read` lists them as the `sessionFlags` layer;
- `initialize` (with `experimentalApi`), `initialized`, then `account/read`: a check is skipped when the run has no folder or the folder has no sign-in (`account` null);
- `thread/start` or `thread/resume` with `cwd` the repository, `model` the check model, `approvalPolicy` the check's (`untrusted` unless it says otherwise), `sandbox: workspace-write`, and `config` with `model_reasoning_effort`, the repository's main checkout named `untrusted` under `projects` (see `codex.start`) and, when the session has Office tools, `mcp_servers.office` `{url, bearer_token_env_var: "OFFICE_TOOL_TOKEN"}`: an MCP server over Streamable HTTP on `127.0.0.1` in the check's process (`codex/office-tool-http-server.ts`), refusing a request without the session's token, serving the same handover-note tool as the `-p` route;
- `turn/start` with the text and `effort`, and `outputSchema` where a check holds the answer to one; `turn/interrupt`, `turn/steer`, `account/rateLimits/read`, `model/list` and `config/read` where a check asks;
- every notification and server request is recorded; `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval` and `mcpServer/elicitation/request` are answered by the check's decide function (accept unless it says otherwise) and recorded as approval calls in the report; any other server request is answered with an error;
- tokens come from `thread/tokenUsage/updated`: each thread's last `total` less what it held before the process's first call, cached input counted as a cache read (`codex/token-usage.ts`);
- after the check the runner deletes the threads it started (`thread/delete`, `thread/archive` if that fails) through a session of its own: no rollout is left under `sessions/`.

Codex writes its own state into `CODEX_HOME` whenever it runs, without a model call: `state_5.sqlite`, `logs_2.sqlite`, `memories_1.sqlite`, `goals_1.sqlite`, `queue_1.sqlite`, `thread_history_1.sqlite`, `installation_id`, `models_cache.json`, `cache/`, `shell_snapshots/`, `skills/.system/`, `plugins/`, `tmp/arg0-<os>/`, and each thread's rollout under `sessions/`; signing in writes `auth.json`. Any `codex` command run without `CODEX_HOME`, `codex --version` included, makes `~/.codex/tmp/`. So the check reads the version from `initialize`'s user agent, and runs on a folder made for it (`/root/.codex-engine-check` on the Office's machine, signed in with `codex login --device-auth`), never someone's everyday Codex folder.

Each check records facts that hold run to run, and gives each step a turn of its own: a model skips a step after a declined call, or one that needs a write beside the worktree.

### codex.start

- **Run:** a session and `thread/start` with the Office's options, in a repository holding its own `.codex/config.toml` (`model_verbosity = "high"`); `model/list`, and `config/read` with its layers before and after the thread starts. No model call.
- **Observed:** the user agent names 0.169.0, `initialize`'s `codexHome` is the folder, the sign-in is `chatgpt` (Free plan), `gpt-6-luna` is listed with `low` effort. The layers are `sessionFlags` (the overrides), `user` (the folder's `config.toml`), `system` (`/etc/codex/config.toml`) and `project`, the repository's; nothing is read from `~/.codex`. The thread answers model `gpt-6-luna`, policy `untrusted`, sandbox `workspaceWrite`, effort `low`. With the repository named `untrusted` the `project` layer stays disabled and its setting never applies, and the folder's `config.toml` is left as it was. Without that, a persisted thread writes `[projects."<repository>"] trust_level = "trusted"` into the folder's `config.toml`, one entry per repository, keyed by a worktree's main checkout, and from then the repository's own settings apply; a `-c projects…` override doesn't stop it, `thread/start`'s `config` does.
- **Meaning:** an engine's folder is its own: `CODEX_HOME` keeps everything of the account there. The adapter names each worktree's repository untrusted in `thread/start`, so a Project can't change its sessions' settings through `.codex/config.toml`, and the folder doesn't grow an entry per worktree.

### codex.approvals

- **Run:** under `untrusted` and under `on-request`, five turns on one thread, one call each: a command writing a file (accepted), a command writing another (declined), `cat README.md`, a file created with `apply_patch` (declined), another (accepted).
- **Observed:** under `untrusted` every one came for approval, the read-only `cat` included, commands as `item/commandExecution/requestApproval` and file changes as `item/fileChange/requestApproval`, each after its item started and before it ran. A declined command or file change ends `declined`, its file isn't written, and it isn't retried; an accepted one ends `completed` and writes. Under `on-request` none came for approval: all five ran in the sandbox, the "declined" ones too. A command's first request carries no reason; the answers carry none back (`{decision: "accept" | "acceptForSession" | "decline" | "cancel"}`, with `availableDecisions` in the request). With all five in one turn, the model stops after the declined command.
- **Meaning:** `untrusted` is the policy under which the Office rules judge every command and file change, as the hook does on Claude Code. A refusal reaches the model only as `declined`, so the brief has to tell the Agent what a declined call means.

### codex.sandbox

- **Run:** a probe script, `node sandbox-probe.mjs`, that writes in the repository, writes beside it in the check's temp folder, fetches `https://example.com` and, on Linux, reads whether it runs under `no_new_privs`; once under `never` (the sandbox alone), once under `untrusted` accepted, once under `untrusted` with the model asked to run it outside the sandbox, accepted.
- **Observed (Linux):** under `never` and accepted under `untrusted` alike: the write in the repository lands, the one beside it fails with `EROFS`, the fetch fails with `EAI_AGAIN`, and it runs under `no_new_privs` (the bundled bubblewrap; Codex warns once that `bwrap` isn't on `PATH`). The escalated request carries a `reason` ("May I run … outside the sandbox"); accepted, the command runs unconfined: both writes land, the fetch reaches the network, no `no_new_privs`. Under `on-request`, the prompt allowing escalation, the model skips the write beside the worktree altogether. `command/exec` on the same policy agreed: without the two exclusions a command writes in `/tmp`.
- **Meaning:** `workspace-write` with the exclusions keeps a command's writes to the worktree and cuts its network. The Office rules see an escalation as a request with a `reason`, and decline it unless the Role's profile allows commands beyond the worktree.

### codex.office-tool

- **Run:** a session with the Office tool server; one turn calling `handover_note` with a note (accepted), one with another note (declined).
- **Observed:** the app-server's requests carry the token; none is refused. It sends `initialize`, `notifications/initialized`, `tools/list` and `tools/call`. Each call comes first as `mcpServer/elicitation/request` (`mode: "form"`, `_meta.codex_approval_kind: "mcp_tool_call"`, the tool's name and its arguments in `_meta.tool_params`), before the handler runs, even under `untrusted`. The accepted call reaches the handler with its note and completes; the declined one ends `failed` and never reaches the server.
- **Meaning:** `officeTools` holds over MCP on `localhost`, and every MCP tool call comes to the Office rules with its arguments, so the adapter answers the elicitation from them: the Office's own tools are allowed by rule, a Role's MCP servers' tools judged as on Claude Code.

### codex.output-schema

- **Run:** a turn under `outputSchema` asking for `{answer: "OK"}`.
- **Observed:** the turn completes, and its last agent message parses to exactly `{answer: "OK"}`.
- **Meaning:** `outputSchema` holds: a Stage's answer is the turn's last agent message.

### codex.usage-reading

- **Run:** `account/rateLimits/read`, one turn, `account/rateLimits/read` again.
- **Observed (ChatGPT Free):** one window, limit id `codex`, `primary` 43,200 minutes (30 days) with `usedPercent` and a `resetsAt` ahead, no `secondary`; the plan is given. `account/rateLimits/updated` comes during the turn with the same shape. `thread/tokenUsage/updated` gives `inputTokens` (cached included), `cachedInputTokens`, `cacheWriteInputTokens`, `outputTokens` (reasoning included), `reasoningOutputTokens`, `totalTokens` and `modelContextWindow`. No window was used up, so no refused turn was seen; the protocol marks one `codexErrorInfo: "usageLimitExceeded"`.
- **Meaning:** `usageWindows` and `contextUsage` hold on a ChatGPT sign-in. Which windows there are follows the plan, so the record holds for the Free plan; a paid plan's windows aren't recorded.

### codex.usage-read-alone

**Not recorded:** it needs a signed-in Codex folder (`--codex-home`).

- **Run:** what the Codex adapter's `readUsageWindows` does every 5 minutes while nothing runs on the engine (spec §5.4): an app-server started for the read alone on the account folder, `initialize` (the check's session also sends `account/read`, which the adapter doesn't), `account/rateLimits/read`, no `thread/start`, then the app-server closed. The files under the folder's `sessions/` and `archived_sessions/` are listed after its start and after its end.
- **Expected:** the snapshot as in `codex.usage-reading`; no `thread/tokenUsage/updated` notification (`modelCalled` false) and no thread started; no new thread file (`newThreadFiles` 0); the process ended with the close (`processEnded` true).
- **Meaning:** the usage windows of a ChatGPT sign-in are read with no thread, no model call and nothing left in the account folder (§5.4). On ChatGPT Free the one 30-day window is left unread by the adapter, as by a session.

### codex.window-start

**Not recorded** (`expectations.json` holds an empty entry): it needs a signed-in Codex folder (`--codex-home`) on a plan with a 5-hour window that isn't running.

- **Run:** what the Codex adapter's `startUsageWindow` does (spec §5.4.6): an app-server started for it alone on the account folder, an empty folder of the sandbox as its working folder; `account/rateLimits/read` first, and the check is **skipped** with the reason when the account has no 5-hour window (ChatGPT Free) or its `resetsAt` is ahead (the window already runs). Otherwise `thread/start` with `ephemeral: true`, `gpt-6-luna`, `approvalPolicy: "never"`, the `read-only` sandbox, the empty folder as `cwd` and no MCP server; one `turn/start` of "Reply with OK." at effort `low`; `turn/completed`; then the app-server closed. The files under the folder's `sessions/` and `archived_sessions/` are listed before the thread and after the close; then the windows are read again on a new app-server.
- **Records:** how the turn ended (`turnEnded`); whether the 5-hour window then resets about 5 hours after the start, within 15 minutes (`windowOpened`); how many thread files appeared (`newThreadFiles`); whether the process ended with the close (`processEnded`); whether `thread/tokenUsage/updated` counted input and output tokens (`tokensCounted`).
- **Expected, to confirm:** `completed`, `windowOpened` true, `newThreadFiles` 0 (an ephemeral thread is never written), `processEnded` true, both token counts.
- **Meaning:** one small turn on an ephemeral thread starts a ChatGPT account's 5-hour window, leaving no thread in the account folder (§5.4.6).

### codex.interrupt

- **Run:** a turn running the 30-second script of `engine.interrupt`, accepted; `turn/interrupt` 4 s after its command starts; then a turn on the same thread. Then the same command in a new session whose app-server is closed (its input ended) 4 s after the command starts.
- **Observed:** the interrupted turn ends `interrupted` within seconds, and the next turn completes. **The command runs on to its end** and its item completes after the turn has ended. Closing the app-server ends it by itself within the grace period, and its command doesn't reach its end.
- **Meaning:** `interrupt` holds for the turn but not for its command: on Stop the adapter also ends the session's app-server, which ends the command, and the next message resumes the thread (`codex.resume`).

### codex.resume

- **Run:** a turn asked to remember a word; the process closed; a new process, `thread/resume`, a turn asking for the word.
- **Observed:** the same thread, both turns complete, the word is remembered, and the resumed turn's input comes from the cache.
- **Meaning:** `resume` holds across processes on the same folder.

### codex.barge-in

- **Run:** the 30-second script's turn; `turn/steer` with `expectedTurnId` 4 s after its command starts, asking for another final word.
- **Observed:** the steer is accepted, joins the same turn as a user message (no second turn starts), the command runs once and completes, and the final message reads the steer.
- **Meaning:** `bargeIn` holds: `turn/steer` is priority `next`. `later` has no counterpart; the adapter holds it until the turn ends and starts a turn on it.

## GitHub Copilot CLI

What the Copilot CLI engine ([spec §5.4](spec/5.4-the-engine.md#defaults), "The Copilot CLI engine") rests on, on the pinned `@microsoft/copilot-sdk` and the Copilot CLI runtime it bundles; the [spec amendments](#spec-amendments) below are what the spec took from it. A `copilot.*` check starts one runtime process per session (`copilot-cli/copilot-session.ts`), the SDK speaking JSON-RPC over the runtime's stdio (`RuntimeConnection.forSpawnedStdio`):

- the client in `mode: "empty"`, `COPILOT_HOME` (the connection's `baseDirectory`) a folder inside the check's sandbox shared by the check's sessions, so a resume finds its session; signed in with `github.token` from `COPILOT_GITHUB_TOKEN` and `useLoggedInUser: false`, so no keychain or `gh` sign-in is read; a check is skipped when the run has no token;
- the environment above without `COPILOT*`, `GH_*` and `GITHUB_*` variables, plus `COPILOT_TELEMETRY_DISABLED=true`;
- the session's options (`copilot-cli/session-options.ts`): `model` the check model, `workingDirectory` the repository, `enableConfigDiscovery` false, `instructions.skipCustomInstructions` true, `skills.enabled` false unless a check names `skills.directories`, no tool definitions but the check's own, `availableTools` where a check limits them, `git.coauthorEnabled`, `state.enableCrossSessionStore` and `github.telemetryEnabled` false, streamed events; a check turns discovery or instructions on only to compare;
- the hooks: `onPreToolUse` answers `permissionDecision: "allow"` or `"deny"` with a `permissionDecisionReason`, from the check's decide function (allow unless it says otherwise); `onPostToolUse` and `onPostToolUseFailure`; and `permissions.onRequest`, answering `approve-once` unless a check says otherwise. Every hook call, permission request and event is recorded in order, in the report;
- a Project's MCP server is a stand-in run per session over stdio (`copilot-cli/stdio-mcp-server.ts`, one tool answering a code word and logging each call), named in the session's `mcp.servers`; the runtime names its tool `<server>-<tool>`;
- the Office tools are SDK tools (`defineTool`), answered in the check's own process, with no server between;
- tokens come from `assistant.usage`: its `inputTokens`, `outputTokens`, `cacheReadTokens` and `cacheWriteTokens`, summed over the session (`copilot-cli/events.ts`).

**Why this route:** the SDK drives the CLI's own server mode, with a long-lived session, streamed typed events, `send` with `mode: "immediate"` or `"enqueue"` while a turn runs, `abort()`, `resumeSession`, hooks in the host's process that can refuse a call before it runs, custom tools answered in the host's process, MCP servers per session, skill folders and `responseSchema`. `copilot -p` takes one prompt per process. ACP (`copilot --acp`) gives the host no pre-tool hook of its own.

Each check records facts that hold run to run, never model text. Each **Observed** below is from the run on Linux on 2026-11-19 ([Runs](#runs)), and **Documented** is what the pinned SDK's README says, not an observation.

### copilot.start

- **Run:** a session on the Office's options; the runtime's status, the sign-in and the model list; one turn asking for `READY`. No tool.
- **Observed:** on Linux, 2026-11-19: the runtime and `session.start` name the pinned 1.0.114; signed in by `token`; deltas stream and the turn answers `READY`. The account lists no models (`listModels` empty, so `gpt-5-mini` isn't listed), and a session naming any model, `gpt-5-mini` or the one Auto picked, fails its turn with `Model "…" is not available`; with no model named the runtime's auto mode (`session.auto_mode_resolved`) ran `mai-code-2-flash`, which `assistant.usage` names. Events include `assistant.usage`, `session.usage_info`, `session.usage_checkpoint`, `session.skills_loaded`, `session.mcp_servers_loaded`, `session.tools_updated` and the `hook.start`/`hook.end` pairs.

### copilot.hook-refusal

- **Run:** one turn asking for a file `refused.txt`; `onPreToolUse` refuses any call naming it, with a reason; the model is told not to try another way.
- **Observed:** on Linux, 2026-11-19: **a refusal stops the call before it runs.** The hook saw the write as a `bash` call (`command`, `description`), refused it, and `refused.txt` was not written. The runtime emitted `tool.execution_start` for it before the hook was called; the call then ended with `Denied by preToolUse hook: <reason>` (`code: "denied"`), the reason reached the tool's result and the model's answer, no permission request and no post hook came for it, and the model didn't retry another way.
- **Documented:** `onPreToolUse` is "called before each tool execution" and answers `allow`, `deny` or `ask`, with arguments it may change.

### copilot.hook-sees-every-call

- **Run:** seven turns, one call each: a shell command, a file read, a file created, a file edited, a search, the stand-in MCP server's tool and an Office tool.
- **Observed:** on Linux, 2026-11-19: the hook saw every call that ran, by its tool-call id: `bash`, `view`, `apply_patch` (the file created and the one edited), `rg`, the MCP tool as `project-tools-read_code_word` and the Office tool `office_status`; the MCP server's process ran its call. Each `tool.execution_start` comes just before its `preToolUse` call, so the check's "hooked first" reads false although no call ran unhooked. Input fields: `bash` `command`, `description`; `view` `path`; `rg` `pattern`, `paths`, `output_mode`, `-n`; `apply_patch`, the MCP and the Office tool none the hook sees as fields. No permission request came; `postToolUse` came after each.
- **Documented:** `onPostToolUse` does not fire for a failed call; `onPostToolUseFailure` does.

### copilot.hook-after-resume

- **Run:** a turn, the session closed with its process; a new process resumes it by id, and the hook refuses a write of `after-resume.txt`.
- **Observed:** on Linux, 2026-11-19: the session id is kept, the hook registered on the resume saw the write and refused it, and the file was not written.

### copilot.tools

- **Run:** a repository holding `AGENTS.md`, `.github/copilot-instructions.md`, an agent under `.github/agents/`, `.github/mcp.json` and `.vscode/mcp.json`, and a config folder holding `mcp-config.json` and an agent; one session on the lean options, one with discovery and instructions on, each listing agents, MCP servers and skills and asked for the code words; then a session whose `availableTools` holds only the read tool and the shell, asked to create a file.
- **Observed:** on Linux, 2026-11-19: `tools.list` for the check model gives `bash`, `create`, `edit`, `glob`, `grep`, `list_agents`, `list_bash`, `read_agent`, `read_bash`, `skill`, `stop_bash`, `task`, `view`, `web_fetch`, `write_agent`; no LSP tool. The lean session loaded no agents, skills, `AGENTS.md` or `.github/copilot-instructions.md`, but did load the config folder's MCP server (`home-config`); with discovery and instructions on it loaded both instruction files and the agents of the repository and of the config folder (`reviewer`, `home-reviewer`), and still only `home-config` of the MCP servers. Under `availableTools: [bash, view]` the session was offered and hooked only those, and wrote the file through `bash`.

### copilot.mcp-servers

- **Run:** a session with the stand-in MCP server and two Office tools; one turn calling the MCP tool, one calling `office_status`; then a turn calling a slow Office tool, with a message sent `mode: "immediate"` while its handler runs, answered 2 s later.
- **Observed:** on Linux, 2026-11-19: the server connected, its process ran the call, the hook saw it by its runtime name, and both answers were read. The barge-in sent during the slow Office tool landed after the tool's result, not before it, and was read in the same turn (one idle).

### copilot.resume

- **Run:** a turn asked to remember a word; the session closed with its process; a new process, `resumeSession`, a turn asking for the word.
- **Observed:** on Linux, 2026-11-19: the word is remembered, the session id is kept, its files are under the config folder (`session-state/`), and the client lists the session.

### copilot.priority-next, copilot.priority-later

- **Run:** a turn running `sleep 4` twice, as separate shell calls; while the first runs, a message sent with `mode: "immediate"` (`next`) or `"enqueue"` (`later`).
- **Observed:** on Linux, 2026-11-19: `immediate` (`next`) landed before the turn's second call; `enqueue` (`later`) after it, at the turn's end. In both one idle came, the second call ran, and the answer holds the word.
- **Documented:** `send` takes `mode?: "enqueue" | "immediate"`; with a `responseSchema`, `immediate` is refused, and ordinary immediate steering joins the running turn's schema.

### copilot.interrupt

- **Run (Linux):** a turn running `sh -c 'echo $$ > pid.txt; exec sleep 120'` in the foreground, so the id written is the sleep's own and not the shell tool's; `abort()` once it is written; 2 s later, whether that process still runs; then a turn on the same session.
- **Observed:** on Linux, 2026-11-19: the session went idle within 30 s, an `abort` event came, the command no longer ran 2 s later, and the next turn answered.
- **Documented:** `abort()` aborts "the currently processing message"; the README says nothing of a running command.

### copilot.images

- **Run:** a 64×64 red PNG, sent as a blob (its bytes in the message) in one session and as a file attachment in another, asking for its colour.
- **Observed:** on Linux, 2026-11-19: both answers name red.
- **Documented:** images attach by a file path, which the runtime reads, or as base64 in a blob.

### copilot.skills

- **Run:** a skill in a folder the Office names, one under the repository's `.github/skills/`, one under `.claude/skills/` and one under the config folder's `skills/`; a session on the lean options with the named folder, one with discovery on, and one with skills off.
- **Observed:** on Linux, 2026-11-19: the lean session lists the named folder's skill (`custom`) and the runtime's bundled `customize-cloud-agent`, `github-pr-media` and `pr-stack` (`builtin`); with discovery on, the repository's (`.github/skills/` and `.claude/skills/`, `project`) and the config folder's (`personal-copilot`) too; with skills off, none.

### copilot.skill-command

- **Run:** a skill `code-word` in the named folder, its body asking for a word; one turn sending `/code-word`.
- **Observed:** on Linux, 2026-11-19: the skill is listed and user-invocable as `code-word`; `/code-word` invoked it and the answer holds its word.

### copilot.sub-agents

- **Run:** a turn asking for a search delegated to a Sub-agent; a session with `includedBuiltinAgents: []`; a session whose hook refuses the tool that starts a Sub-agent.
- **Observed:** on Linux, 2026-11-19: the built-in agents are `code-review`, `explore`, `general-purpose`, `research`, `rubber-duck`, `security-review` and `task`, none with `includedBuiltinAgents: []`. The model started `explore` and `task` through the `task` tool, whose call the hook saw; **both Sub-agents failed at once with `400 The requested model is not supported`**, so none made a call, and whether a Sub-agent's own calls reach the hook is still unknown. Refusing the `task` call kept the Sub-agent from starting.
- **Documented:** `onSubagentStart` and `onSubagentStop` hooks observe a Sub-agent. The check tells a Sub-agent's calls apart by the hook input's `agentId`.

### copilot.background-tasks

- **Run (Linux):** a turn asking for `sleep 30` in the background; then a session whose hook refuses a shell call whose input asks for the background.
- **Observed:** on Linux, 2026-11-19: the shell call's input has `command`, `description`, `detach` and `mode`, the background chosen by `detach: true` and `mode: "async"`; `session.background_tasks_changed` came and the task list held one. The hook refused such a call: no event, no task.

### copilot.output-schema

- **Run:** a turn under `responseSchema` (`{answer: integer}`, asking 19 + 23); then, as a stand-in, a turn answering through an Office tool marked `isTerminal` whose parameters are the schema.
- **Observed:** on Linux, 2026-11-19: `responseSchema` is taken natively, the answer parses to exactly `{answer: 42}`; the terminal submit tool was called with matching arguments and the turn ended after it.
- **Documented:** structured output is a preview that "requires a runtime build with `responseFormat`"; the schema holds for the whole run, tool calls included, and is not kept on resume.

### copilot.sign-in

- **Run:** a session signed in with the token; the files the config folder gained; whether any file there holds the token (the token itself never recorded); `~/.copilot` before and after.
- **Observed:** on Linux, 2026-11-19: signed in by `token`; the config folder gained `installed-plugins`, `logs` and `session-state`, none holding the token; `~/.copilot` didn't exist before and wasn't made.
- **Documented:** `baseDirectory` sets `COPILOT_HOME`, `~/.copilot` when unset; `useLoggedInUser` is false when `github.token` is given.

### copilot.usage

- **Run:** one turn running `git status --short`; then the session's quota, the account's quota and the session's usage metrics.
- **Observed:** on Linux, 2026-11-19: `assistant.usage` gives `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`, `cost`, `copilotUsage` (`tokenDetails`, `totalNanoAiu`), `quotaSnapshots` and the model, among others; `session.usage_info` gives `currentTokens`, `tokenLimit`, `systemTokens`, `toolDefinitionsTokens` and `conversationTokens`. No `session.quota_observation` came. The session's quota has a `chat` snapshot, the account's `chat`, `completions` and `premium_interactions`, each with `entitlementRequests`, `usedRequests`, `remainingPercentage`, `resetDateEpochMs`, overage fields and `isUnlimitedEntitlement`; the metrics add `totalPremiumRequestCost` and per-model metrics. The turn counted about 40k input tokens.

### On the Test Project

A check of the engine through The Office (apps/service/docs/testing.md, live checks), on Linux in the Task's run environment on 2026-11-19, on Auto, signed in by a fine-grained token with "Copilot Requests" pasted through `PUT /settings/engines/:engineId/token`.

- **Chat:** the Developer, asked how many workspaces the Test Project's `package.json` lists, ran one Read and replied `3` in one message, in 9 s and 21.8k tokens, most of them cache reads and writes.
- **A Stage:** a Task the user planned (the Planner never ran), on Quick fix with a Gate before Publish. The install passed, then Implement failed before any tool call. Copilot refused the turn's `responseSchema`, the Stage result schema, with `400 Invalid schema for response_format 'response': In context=(), 'if' is not permitted`. That schema's `if`/`then` makes `definitionOfDoneMet` required when the status is `done` (`pipelines/domain/stage-result.ts`), and the backend takes only a schema without conditionals. The correction turn failed the same way, and the Task waited on the user's Decision. The Office worded both failures as a result that didn't match the Stage result schema. The edit, the shell command and the refused Write into `.claude/` were therefore not reached. `copilot.output-schema` passed only because its schema is flat. The fix belongs to the Copilot CLI adapter: give the runtime a schema without conditionals and hold the answer to the full schema in the service, or answer through a terminal Office tool.
- **Sign-in:** a token without "Copilot Requests" signs in (`pastedToken`, signed in), but every turn fails with `Authorization error. Your credentials may be expired or invalid.`, and the Stage words even that as a result not matching its schema.
- **Removal:** an open chat's session keeps the removed engine's folder until it ends. The folder went when The Office restarted, as its start removes the folders of engines no longer listed.

### Spec amendments

What the spec took from these checks, each with the date the user agreed it.

| Agreed | Spec | Amendment | From |
|---|---|---|---|
| 2026-11-19 | §5.4 Engine kinds, Versions are pinned | A new engine kind, **Copilot CLI**, one GitHub account with Copilot, on the Copilot CLI runtime that the pinned `@microsoft/copilot-sdk` bundles, through the SDK, one runtime process per session; not `copilot -p` (one prompt per process) nor ACP (no hook before a tool runs) | `copilot.start`, the route above |
| 2026-11-19 | §5.4 Engines are a list | The Copilot CLI engine's folder, `<office-data>/engines/<engine id>/` as `COPILOT_HOME`; Sign in by GitHub's device flow; Paste a token instead, a fine-grained token with "Copilot Requests", kept in the database and given only as the SDK's `github.token`; Sign out; what it shows | `copilot.sign-in`, `copilot.start` |
| 2026-11-19 | §5.4 Engines are a list | Its models are what the runtime lists and **Auto**, its default model | `copilot.start`: the account listed none and the runtime refused any model named |
| 2026-11-19 | §5.4 The Copilot CLI engine | The Office rules judge every tool call in `onPreToolUse` before it runs; a refusal is `deny` with the reason; how the runtime's tools map onto the tools the rules judge; an unmapped tool is refused | `copilot.hook-refusal`, `copilot.hook-sees-every-call`, `copilot.hook-after-resume`, `copilot.background-tasks`, `copilot.tools` |
| 2026-11-19 | §5.4 The Copilot CLI engine, MCP servers for Agents | Office tools as SDK tools in the service's process; the Role's MCP servers in the session's `mcp.servers` | `copilot.mcp-servers`, `copilot.tools` |
| 2026-11-19 | §5.4 The Copilot CLI engine | Config discovery, custom instructions, the cross-session store, telemetry and the co-author trailer off; the runtime's own folder and bundled skills kept out | `copilot.tools`, `copilot.skills` |
| 2026-11-19 | §5.4 The Copilot CLI engine, A Stage's Sub-agents | No Sub-agents until the check sees their own calls reach the hook | `copilot.sub-agents` |
| 2026-11-19 | §5.4 The Copilot CLI engine | Capabilities: `bargeIn`, `interrupt`, `resume`, `contextUsage`, `officeTools`, `outputSchema` yes; `languageServers` no; images yes; any Role | `copilot.priority-next`, `copilot.priority-later`, `copilot.mcp-servers`, `copilot.interrupt`, `copilot.resume`, `copilot.usage`, `copilot.output-schema`, `copilot.tools`, `copilot.images` |
| 2026-11-19 | §5.4, §2.11, §5.2, GLOSSARY Usage window | `usageWindows` no, by decision: no Window caps and no readings of the usage windows; the premium-request quota left for later | the user's decision; `copilot.usage` shows the quota reads there are |
| 2026-11-19 | §5.4 Native features used, §2.11, §5.2, GLOSSARY Model price | Cost priced by Model prices, one per engine and model, as on the OpenAI-compatible API engines; the runtime's own cost unused; "no cost" with no price | the user's decision |
| 2026-11-19 | §5.4 Stand-in Engines, The Copilot CLI engine | `carrySession` no: a session resumes only on the engine whose folder holds it | the user's decision; `copilot.resume` |
| 2026-11-19 | §2.4, §5.1, §5.6, §6, §8, the spec's README | The Copilot CLI engine named where they list the engine kinds | the amendments above |

## Gemini CLI

What the Gemini CLI engine ([spec §5.4.7](spec/5.4.7-gemini-cli-engine.md)) rests on, on the pinned `@google/gemini-cli`. A `gemini.*` check drives the CLI as the adapter (`apps/service/src/modules/engine/adapters/gemini-cli/`) wires a session, headless with stream-json, so a result holds for The Office:

- **The process:** one `gemini --model <model> --output-format stream-json --approval-mode yolo` per turn, the first with `--session-id`, each later one with `--resume`, the prompt on its standard input. The pinned JS entry, `bundle/gemini.js`, runs with `process.execPath` and `GEMINI_CLI_NO_RELAUNCH=true`, so the process started is the one that runs the session; on Linux it leads a process group of its own.
- **The home:** `GEMINI_CLI_HOME` is the session's own folder in the engine folder, `office-data/engines/<engine id>/sessions/<session id>/`, owner-only. The CLI keeps the session's chat under its `.gemini/`, and a resume runs in the same home.
- **The settings:** the home's `.gemini/settings.json`, owner-only, written at each opening (`gemini/gemini-settings.ts`, restating the adapter's `gemini-settings.ts`):
  - signed in by the API key, given only in the CLI's environment as `GEMINI_API_KEY`, and redacted from what its shell commands, hooks and MCP servers inherit;
  - folder trust off, so the hook and the MCP servers load;
  - no telemetry, usage statistics, auto update, checkpointing, auto memory, IDE, chat retention sweep or topic narration (`update_topic`), and the CLI's own skill loading off;
  - `tools.core` naming the core tools (`glob`, `grep_search`, `list_directory`, `read_file`, `replace`, `run_shell_command`, `write_file`) and `mcp_<server>_*` for each MCP server;
  - the Agent's instructions as a file of the session's in the home's `.gemini/` (`context.fileName`);
  - the `BeforeTool` command hook on every tool (`matcher: ".*"`, 60 s timeout).
- **The relay:** the hook and every MCP server the CLI starts are the service's own script, `gemini-office-relay.ts`, run by path (`hook <channel file>`, `mcp <channel file> <server>`), never imported. Both reach the check's stand-in for the service (`gemini/office-channel.ts`) on a Unix socket, or a named pipe on Windows, behind a token made per session. The address and the token are in a channel file, owner-only in `office-data/sessions/<session id>/`, never on a command line or in an environment.
- **The tools served:** the `office` server serves the Office tools, the Skill tool and StructuredOutput (`gemini/office-server.ts`). A Role's MCP server is started by the check, as the service starts it, and relayed under its own name; the CLI never gets its Server values (`gemini/project-mcp-connection.ts`).
- **Stop:** ends the CLI's descendants and their process groups first, then the CLI's own tree (`gemini/process-trees.ts`; `taskkill /t /f` on Windows). After each turn, whatever the turn's process left running is ended.
- **The environment:** without inherited `GEMINI*`, `GOOGLE*`, `NO_BROWSER`, `BROWSER`, `CLOUD_SHELL`, `CLAUDE*`, `ANTHROPIC*`, `OPENAI*`, `CODEX*`, `MCP_*` and `OTEL_*` variables; `NO_BROWSER=true` always.
- **Tokens** come from each turn's `result` event (`stats`).

Each check records facts that hold run to run, never model text. Each **Observed** below is from the Linux run of 2026-11-20 ([Runs](#runs)). **Code** is what the pinned CLI's code shows, read where no check could observe it.

### Capabilities

| Capability | Linux | Windows | Shown by |
|---|---|---|---|
| `interrupt` | yes: the turn ends `cancelled`, its command is stopped, the next turn answers | (pending) | `gemini.interrupt` |
| `resume` | yes, in the session's own home only | (pending) | `gemini.resume` |
| `bargeIn` | no: a message sent during a turn waits for its end, and the messages waiting make the next turn together | (pending) | `gemini.priority-next`, `gemini.priority-later` |
| `contextUsage` | yes: per-turn tokens, and the latest answer's tokens in the chat the CLI keeps | (pending) | `gemini.context-usage` |
| `usageWindows` | no: `stats` holds tokens only | (pending) | `gemini.context-usage` |
| `officeTools` | yes, through the relay | (pending) | `gemini.office-tool` |
| `outputSchema` | yes, through StructuredOutput | (pending) | `gemini.output-schema` |
| `languageServers` | no | (pending) | `gemini.language-servers` |
| `carrySession` | no: another engine folder doesn't hold the session | (pending) | `gemini.resume` |
| The Office rules | every call judged before it runs; refused when the service can't be reached, the token is wrong or the answer is late | (pending) | `gemini.tools-and-rules`, `gemini.hook-unreachable` |
| A Role's MCP servers | yes; the values stay in the service | (pending) | `gemini.mcp-tool` |
| Skills | the session's, through the Skill tool; not the repository's | (pending) | `gemini.skills` |

Every capability `GEMINI_CLI_CAPABILITIES` declares holds on Linux.

**Why headless, and only headless.** Task 2f25ef1c's run of 2026-11-20 drove ACP (`gemini --acp`) beside headless. Over ACP the CLI never calls the `BeforeTool` hook, as its ACP session runs tools without the scheduler that calls hooks. Its stand-in, `session/request_permission`, carries no arguments, names the tool only through the call id, and can give the model no reason for a refusal. ACP also has no barge-in: a second prompt cancels the running turn. So the check drives only headless, as the adapter does. **Revisit when** the CLI calls hooks over ACP, or its permission request carries the call's arguments.

**Sign-in.** The same run found that Google refuses Login with Google for personal accounts (`This client is no longer supported for Gemini Code Assist for individuals…`), while a Gemini API key from Google AI Studio signs in. The check, like the engine, signs in with an API key only, and `--gemini-sign-in` is gone. A Workspace or Code Assist Standard or Enterprise account wasn't tried.

**Found on the adapter's wiring, fixed in the adapter** (2026-11-20, this Task):
- **The system settings file was skipped.** The adapter gave a session's settings to the CLI as `GEMINI_CLI_SYSTEM_SETTINGS_PATH`. The pinned CLI reads that file only when the file and every folder above it are owned by root and writable by no group or other user, or on Windows owned by an administrator or SYSTEM. Otherwise it skips the file with a "Security Warning", folder trust comes back on, and every headless turn is refused. **Code:** `isFileAndDirectorySecureSync` in the CLI's settings loader. By the user's decision, each session now has a home of its own in the engine folder, its settings that home's `.gemini/settings.json`, which has no such rule.
- **A repository's own settings outrank the session's.** With folder trust off the CLI treats the folder as trusted and ranks its `.gemini/settings.json` above the home's (`gemini.repository-settings`). `GEMINI_RESTRICTED_MODE=true` leaves that file unread, but also drops the home's hook and MCP servers. By the user's decision, the adapter refuses a turn in a folder holding `.gemini/settings.json`, and `.gemini/settings.json` is a protected path in the Office rules on every engine.
- **`update_topic` got past the hook.** The CLI's topic narration, on by default, gives the model `update_topic` whatever `tools.core` says, and its calls never reach the hook. It is now off.
- **Stop left the command running.** The CLI starts each shell command in a process group of its own, so ending the CLI's group didn't end it. Stop now ends the CLI's descendants first.
- **A tool answering a bare JSON value failed.** The CLI wraps every MCP server's transport in its own `McpComplianceTransport`, which parses an answer's first text as JSON into `structuredContent`; when that isn't an object (`880448`, `[1,2]`), its MCP client refuses the result. The relay now gives such an answer a `structuredContent` of its own (`{ value }`); the model still reads the text (the AgentEngine contract's MCP scenario).

### gemini.start

- **Run:** one turn in a repository with a `GEMINI.md` and another `GEMINI.md` in the folder above it, the Agent's instructions in the session's instructions file, asking for every code word the session was given; a shell command that prints whether `GEMINI_API_KEY` is set. Then a turn without a key.
- **Observed:**
  - the pinned 0.70.0 answers on `gemini-3.5-flash-lite`, and the session id is a UUID;
  - the instructions file and the repository's `GEMINI.md` load, the one above it doesn't;
  - the model's shell doesn't see `GEMINI_API_KEY`, and no file left in the engine folder, the session's folder or the repository holds it;
  - without a key, the turn is refused with exit 41.
- **Meaning:** the key reaches only the CLI, and a Project's `GEMINI.md` is its instructions, as `CLAUDE.md` is on Claude Code.

### gemini.tools-and-rules

- **Run:** one turn uses each core tool, an allowed shell command, a command the hook refuses with a reason carrying a code word, and an Office tool. Each judgement looks whether the command's file exists yet.
- **Observed:** the hook saw every call (`glob`, `grep_search`, `list_directory`, `mcp_office_note_progress`, `read_file`, `replace`, `run_shell_command`, `write_file`), each before it ran; the allowed command ran, the refused one didn't, and the refusal's reason reached the model.
- **Meaning:** the Office rules judge every Gemini CLI tool call ([spec §6](spec/6-permissions-and-safety.md)).

### gemini.repository-settings

- **Run:** the repository holds `.gemini/settings.json` with `{"hooksConfig":{"enabled":false}}`; one turn runs a command the hook would refuse. The check's session runs regardless, to see it.
- **Observed:** the hook saw nothing, and the command ran.
- **Meaning:** why the adapter refuses a turn in such a folder.

### gemini.hook-unreachable

- **Run:** a command the hook would allow, three times: with the channel file pointing at a socket nothing serves; with a wrong token; and with the service answering after 55 s, past the relay's own 50 s deadline and under the CLI's 60 s timeout.
- **Observed:** each time the command didn't run and the call failed.
- **Code:** the CLI lets a call run when a hook exits 1, times out or can't start, and refuses it on exit 2 or a `deny` answer; the relay exits 2 on every failure it sees, its deadline included.
- **Meaning:** the Office rules refuse when they can't be asked, as [spec §6](spec/6-permissions-and-safety.md) says.

### gemini.office-tool

- **Run:** an Office tool answering a code word; the relays' processes are looked for by the channel file on their command lines while it answers and after the turn.
- **Observed:** the model called it once, its answer reached the model, a relay ran during the call, and none was left after the turn.

### gemini.mcp-tool

- **Run:** a Role's stdio MCP server with a secret value in its environment, started by the check as the service starts it, called once through the relay.
- **Observed:** the call was judged first (`mcp_project-tools_check_secret`) and ran; the value arrived; it was in no environment of the CLI's, on no command line and in no file left; the server's process ended with the session.

### gemini.skills

- **Run:** a session skill served by the Skill tool, and a skill in the repository's `.gemini/skills/`; one turn each.
- **Observed:** the session's skill loaded through `mcp_office_Skill` and its body reached the model; the repository's skill was not offered (`activate_skill` isn't there). The model may still read the repository's `SKILL.md` as a file.
- **Meaning:** a session's skills are exactly what The Office lists ([spec §5.6](spec/5.6-skills-per-session.md)).

### gemini.interrupt

- **Run:** a shell command that writes a file after 30 s, in the foreground; a stop 2 s after the call starts; a wait past the 30 s and one more turn. Then a turn that starts a command in the background (writing a file after 15 s) and ends.
- **Observed:** the turn ends `cancelled` well before 30 s, the command never writes its file, and the next turn answers; the background command didn't outlive its turn.
- **Before the fix:** the turn ended but the command wrote its file, as it ran in a process group of its own.

### gemini.resume

- **Run:** a turn gives a code word; a new process resumes the session by id in the same home and asks for it. Then the same id in another engine folder.
- **Observed:** the history is kept in the same home; in another engine folder the turn fails.
- **Meaning:** a session resumes only in its own home; `carrySession` is false.

### gemini.priority-next, gemini.priority-later

- **Run:** `priority-next`, a message sent while an Office tool answers; `priority-later`, two messages sent while a 10 s foreground command runs. Each sent as the adapter sends any message: it waits for the turn's end.
- **Observed:** the running turn ends as it would have, its command running to its end and its Office tool answering; nothing lands in it; the messages make the next turn together, and each is answered (two turns in all).
- **Meaning:** no barge-in: a headless turn takes no input; `next` and `later` both wait.

### gemini.output-schema

- **Run:** whether `--help` lists a schema flag; then a StructuredOutput Office tool whose input schema is the answer's (an `enum` and an integer, `additionalProperties: false`), with the adapter's reminder turn if the answer doesn't come.
- **Observed:** no schema flag; the model answered through StructuredOutput once, matching the schema, with no reminder needed.

### gemini.context-usage

- **Observed:** each turn's `result` gives its tokens (`stats`: `cached`, `duration_ms`, `input`, `input_tokens`, `models`, `output_tokens`, `tool_calls`, `total_tokens`), nothing about quota; the chat the CLI keeps records the latest answer's tokens.
- **Meaning:** the context's size is read from the chat; there are no usage windows.

### gemini.quota-refusal

- **Run:** one turn; recorded only when it is refused for a used-up quota, skipped otherwise.
- **Observed:** skipped on both tries, once right after a turn of another check was refused with `429 … Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15 … retry in 34.9s`. The CLI retries a per-minute 429 by itself, with backoff, so a turn is refused only once its retries run out; on the `flash` alias the CLI retried for over 3 minutes without answering.

### gemini.language-servers

- **Observed:** the pinned CLI's tool reference names no language-server tool.

### The AgentEngine contract, live

`OFFICE_ENGINE_TESTS=live GEMINI_API_KEY=<key> npx vitest run src/modules/engine/adapters/gemini-cli/gemini-cli-engine.test.ts -t "pinned CLI"` in `apps/service`, on the `flash-lite` alias (the cheapest the engine offers):
- **Linux, 2026-11-20:** 11 of 12 scenarios pass (reply, Office tool, refusal, MCP server, `later`, interrupt, resume, output schema, context usage, and both usage-window refusals). `skill-command` failed twice the same way: on the brief's turn ("Reply with the single word: ready") the model called the Office tool `note` with `ready` unasked; the skill command's own turn then ran and noted `tangerine` as it should. The `flash` alias didn't answer within 180 s on this free-tier key.
- **Windows:** (pending).

## The OpenAI-compatible API

The Office's own loop (spec §5.4 Defaults) has no binary to check: it is checked by the `AgentEngine` contract on a live server and by a check on the Test Project (apps/service/docs/testing.md, live checks). Seen on Windows, on a Strata server at `http://127.0.0.1:8080/v1` serving `qwen3.8-flash-next-coder-iq1_m` (`n_ctx` 100000), which reads a prompt at about 14 tokens/s and writes about 11 tokens/s, so each scenario ran alone.

- **Contract:** `reply` (streaming; 140 s), `refusal` (a Write judged by the Office rules, refused in their words; 364 s), `interrupt` (an Office tool held, the turn interrupted, the next message taken; 212 s), `resume` (the conversation kept and an Office tool called with the word remembered; 244 s), `output-schema` (StructuredOutput checked; 240 s) pass. `office-tool`, `barge-in`, `later` and `context-usage` were left out as the fake server covers them; `usage-windows` is refused by design.
- **Chat on the Test Project:** the Developer on the endpoint's model, asked how many workspaces the Test Project's `package.json` lists, ran Glob then Read and replied `3` in one message, in 475 s and 14.9k tokens.
- **A Stage on the Test Project:** a Task the user planned (the Planner never ran) on Quick fix with a Gate before Publish, the Developer on the endpoint's model. Implement (145 s, 94k tokens, 78k of them read from the server's cache) ran Read, Edit, `git status --short` through Bash, a Write to `.claude/` refused by the Office rules in their words (the model read the refusal and did not retry), and StructuredOutput; Tests passed and the Task waited at the Gate, then was dropped. Each answer's text shows as one message. `.github/` is not a protected path in the Office rules (only `.git`, `.claude` and `.mcp.json`), so a Write there is allowed.
- **Observed:** Strata streams the model's reasoning as `reasoning_content`, which the loop leaves out; only `content` is the answer. Two consecutive user messages in one request were accepted (200), so joining them per request is a precaution, not a need, on this server. Skills were not loaded live.
- **From the pinned binary (2.1.310), not from a session:** `AGENTS.md` and `.claude/AGENTS.md` load only through the built-in `cc-plugin-agents-md` plugin (by default where the project has no `CLAUDE.md`), which the Office's settings turn off, so the SDK adapter's sessions load neither and the loop's list matches. A background command's notice is queued as a `task-notification` command at priority `next`; whether that starts a turn in an idle SDK session was not seen.

## Other observations

Seen while running the checks, recorded so a bump can be compared against them.

- With connectors on (§5.4 turns them off), claude.ai connectors connect while the session runs and arrive as `tool_addition` and `mcp_instructions_delta` messages between turns; a resumed session that starts before they connect sends their removal.
- The transcript holds a `session_context` attachment with the signed-in user's e-mail address, under `settingSources: ['project']`.
- The engine leaves an empty `memory/` folder in the transcript folder of each working directory when auto-memory is on.
- `apiKeySource` is `none`; no memory files and no user hooks reach a session.
- `engine.priority-now` once differed on Windows (the running command was interrupted instead of finishing, in about half the usual time) and matched on the runs after it. The Office does not use `now`.
- On Linux, after a command moved to the background, the model read its output file under `/tmp/claude-0/…/tasks/`, outside the worktree: the engine allows reads of its own task output. The hook lets each session read that folder of its own, by its session id; it is under `%TEMP%\claude\` on Windows.
- MCP servers on the Agent SDK engine, seen live on the Test Project on Windows (`mcp-servers/application/mcp-tools-test-project-check`, Haiku): with the fake stdio server and its secret Server value overridden on the Test Project, an Allowed tool runs under `permissionPrompts: 'none'` with no prompt; one at Consult Devops is held, waits on Devops in a Consultation, and runs after the user's Allow once in the resumed session. The binary lists the MCP tools as deferred, so the model loads them with ToolSearch first. The private MCP config file is written at the start and at the resume and none is left; no command line holds the value; the server's process tree ends.

## Not checked

- On the Gemini CLI: Login with Google on a Workspace or Code Assist Standard or Enterprise account; the shape of a daily-quota refusal; sub-agents (`invoke_agent`, `codebase_investigator`), which `tools.core` leaves out; models other than `flash-lite` on a paid key.
- On the `-p` fallback: priority `now` (not used), a hook that answers too late or with an error status rather than not at all, and whether the Skill tool asks for permission without the `Skill(…)` rule.
- Which engine-owned paths outside the worktree, other than the auto-memory folder, the engine auto-allows writes to. The hook fences writes regardless.
- Whether `forkSession` resumes read the parent's cache, a non-child process posting into a session's inbox on Windows, concurrency limits beyond three sessions and how cache reads count against plan quota, `projectConfigRoot` and `CLAUDE_SECURESTORAGE_CONFIG_DIR`. The Office uses none of them.
- On the Copilot CLI: a recorded run of the `copilot.*` checks on the check's own options (see [Runs](#runs)); whether a Sub-agent's own calls reach the hook, as the account couldn't run the Sub-agents' model; GitHub's device-flow sign-in and where the runtime keeps it; a named model on an account that lists models; Windows at all (`copilot.interrupt` and `copilot.background-tasks` run on Linux only); BYOK providers, cloud sessions, Autopilot, the in-process (FFI) runtime connection, managed settings and `copilot --acp`.
