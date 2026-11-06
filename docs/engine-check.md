# Engine check

What tier 1 takes on trust about the engine, checked against live sessions on the pinned versions: the skills mechanism of [spec §5.6](spec/5.6-skills-per-session.md), the permission build rules of [§6](spec/6-permissions-and-safety.md) and the engine behaviours of [§5.4](spec/5.4-the-engine.md). The check lives in [tools/engine-check](../tools/engine-check); each entry below names the check id it shares with `tools/engine-check/expectations.json`, where the observed facts are recorded per platform.

## When to run

- **On every SDK bump, before the bump is merged,** on Windows and on Linux: `npm run engine-check`. It exits non-zero when any check differs from what is recorded for that platform, has nothing recorded, or fails. A difference is read, its entry here updated (and the spec amended with the user when it contradicts it), then recorded with `npm run engine-check -- --record`.
- **Once per bump, also the slow check:** `npm run engine-check -- --only engine.decision-wait --include-slow`, which waits an hour on purpose.
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

## Runs

| Platform | Date | Result |
|---|---|---|
| Windows 11 (win32), the workstation | 2026-10-25 | 28 checks run and recorded; the slow `engine.decision-wait` recorded 2026-10-24 |
| Ubuntu 24.04 x64 (linux), an LXC container signed in to Claude Code as root | 2026-10-25 | 27 checks run and recorded, and the slow `engine.decision-wait` (62 minutes) |
| Windows 11 (win32), the workstation | 2026-10-30 | the 7 `fallback.*` checks run and recorded (task 29); `skills.start-check`, `engine.office-tool` and `engine.priority-next` re-run after the probe's refactor, matching |
| Ubuntu 24.04 x64 (linux), the same LXC container | 2026-10-30 | the 7 `fallback.*` checks run and recorded, the same as on Windows |
| Windows 11 and Ubuntu 24.04 | 2026-10-30 | after the Office tools moved to the binary's stream (task 29 step 4a): `fallback.start`, `fallback.tools-and-rules`, `fallback.priority-next` re-run and `fallback.priority-next-office-tool` added, on both |
| Windows 11 and Ubuntu 24.04 | 2026-10-31 | `permissions.read-fence-off` added (task 33 step 1), the same on both |
| Windows 11 and Ubuntu 24.04 | 2026-10-31 | every check but the slow one, with the read fence off and `claudeMdExcludes` in the Office's options (task 33 step 2); `permissions.file-tool-fence` and `skills.plugin-folder-reads` retired, `permissions.hook-sees-every-call` re-recorded |
| Ubuntu 24.04 x64 (linux), the Office's own machine | 2026-11-06 | `skills.overrides-library` added and recorded, no model call; not run on Windows yet |

| Windows 11 (win32), the workstation | 2026-10-31 | the OpenAI-compatible API engine live on Strata (task 35 step 9): five contract scenarios, then a chat and a Stage on the Test Project (task 35's check); see [the OpenAI-compatible API](#the-openai-compatible-api) |
| Windows 11 (win32), the workstation | 2026-11-01 | MCP servers live on the Agent SDK engine, Haiku (task 36 step 8, `mcp-servers/application/mcp-tools-test-project-check`): the fake stdio server, its secret Server value overridden on the Test Project. An Allowed tool ran under `permissionPrompts: 'none'` with no prompt; one at Consult Devops was held, waited on Devops in a Consultation, ran after the user's Allow once in the resumed session. The binary listed the MCP tools as deferred, so Haiku loaded them with ToolSearch first. The private MCP config file was written at the start and at the resume, and none was left; no command line held the value; the server's process tree ended. 35 s, 162k tokens (mostly cache reads) |

`permissions.powershell-twin` runs on Windows only. Results differ between platforms only where an entry says so: `skills.user-scope`, `engine.priority-now` and `engine.lean-options`.

## How a check runs

Each check runs in a throwaway git repository in a temp folder, with an Office data directory beside it holding the session plugin folder (`office-data/sessions/<session-id>/skills/`) and Task worktrees. Sessions start with the options The Office ships, so a result holds for The Office:

- `settingSources: ['project']`, the session plugin folder in `plugins`, `skills` listing `office:<name>` for each session skill;
- settings: `syncClaudeAiSkills` and `syncClaudeAiPlugins` false, `disableBundledSkills` and `disableSkillShellExecution` true, `disableClaudeAiConnectors` true, `autoMemoryEnabled` and `autoDreamEnabled` false, the three built-in plugins false in `enabledPlugins`, `permissions.blockReadsOutsideWorkingDirectories` false (true until task 33, which also dropped the session plugin folder from `permissions.additionalDirectories`; see `permissions.read-fence-off`);
- `tools` naming the built-in tools explicitly, the same list on both platforms with PowerShell on Windows only (see `engine.lean-options`);
- `permissionPrompts: 'none'`, the `claude_code` system prompt preset with `excludeDynamicSections`, an environment without inherited `CLAUDE*`, `ANTHROPIC*`, `MCP_*` and `OTEL_*` variables;
- the hooks The Office registers (`PreToolUse`, `PostToolUse`, `PermissionDenied`), recorded on every call and allowing by default; a check decides calls where it needs to.

The `fallback.*` checks start the same options on the `-p` route (spec §5.4 Defaults): the pinned binary the SDK bundles, found as the SDK finds it (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude[.exe]`, on Linux the glibc build first), spawned with the flags `tools/engine-check/src/claude-code-p/arguments.ts` builds from them:

- `--print --input-format=stream-json --output-format=stream-json --verbose`, `--model`, `--tools`, `--setting-sources=project`, `--plugin-dir=<session plugin folder>` (ticket 22's public flag; the SDK passes the hidden `--plugin-dir-no-mcp` for a plugin with `skipMcpDiscovery`, which gave the same `fallback.start` result, as the session folder holds no MCP servers; the user chose the public flag on 2026-10-30), `--allowedTools=Skill(office:<name>),…`, `--permission-prompts=none`, `--exclude-dynamic-system-prompt-sections`, `--session-id` or `--resume`, and `--json-schema` where a check holds the output to one;
- `--settings` with the settings above plus the hooks: each event an `http` hook to the session's `localhost` endpoint with `onFailure: 'block'`, a 600 s timeout and `Authorization: Bearer ${OFFICE_SESSION_TOKEN}` (`allowedEnvVars`), and `mcp__office` in `permissions.allow` when the session has Office tools;
- `--mcp-config` naming an `office` server `{type: 'sdk', name: 'office'}` when the session has Office tools: the binary sends that server's MCP messages to the host as `mcp_message` control requests, and the check answers each from an MCP server in its own process (`claude-code-p/office-tool-server.ts`, each tool with `_meta['anthropic/alwaysLoad']` as the SDK's `alwaysLoad` sets it), as the SDK answers a `createSdkMcpServer()` server;
- the environment above plus `OFFICE_SESSION_TOKEN`, a token made per session, so it is on no command line; the hook stand-in (`claude-code-p/local-endpoints.ts`, `node:http` on `127.0.0.1`) refuses a request without it;
- no `initialize` request (the binary sends the `sdk` server's messages without one naming it in `sdkMcpServers`): messages and the control requests (`interrupt`, `get_context_usage`, `reload_plugins`, `get_usage`, `stop_task`) are written to its input as the SDK writes them, and any other control request from the engine to the host is answered with an error and recorded.

A check records facts that hold run to run (booleans, outcomes, sorted names, token counts rounded to 10k), never model text. Where a check varies an option on purpose, its entry says so.

## Spec amendments

Results that contradicted or went beyond the spec, and how the spec reads now. Each change was agreed with the user on 2026-10-24 or 2026-10-25.

| Check | Spec | Was | Now |
|---|---|---|---|
| `skills.plugin-folder-reads`, `permissions.file-tool-fence` | §5.6, §6 | "Everyone also reads their session's skills folder", with no grant named | The folder is in `permissions.additionalDirectories`; a `Read` allow rule does not lift the fence |
| `permissions.hook-sees-every-call` | §6 | One `PreToolUse` hook sees every call first | It sees every call the engine's input validation lets through, before any rule; no path-scoped deny rules; path decisions are the hook's |
| `permissions.hook-sees-every-call` | §6 | Refusals logged on the Thread | Logged from the hook's decisions, `permission_denied` messages and `result.permission_denials`; the `PermissionDenied` hook is not relied on |
| `permissions.file-tool-fence` | §6 | Shell reads outside are accepted | They work only for profiles that allow commands |
| `permissions.protected-paths` | §6 | The engine never auto-approves the protected paths | The hook refuses Agents' writes there first, with a clear reason; the engine stays a backstop |
| `engine.office-tool` | §6 | Not covered | The Office allows its own tools by rule: `permissionPrompts: 'none'` refuses whatever would prompt |
| `engine.priority-now` | §5.4 | `now` interrupts | `now` is not used; `interrupt()` is the only way to stop a running command |
| `engine.auto-memory`, `engine.lean-options`, `skills.start-check` | §5.4 | Not covered | claude.ai connectors, built-in plugins and auto-memory are off |
| `engine.lean-options`, `permissions.file-tool-fence` (Linux) | §5.4 | The engine's default tool set | An explicit `tools` list, the same on both platforms: the Linux default has no Grep or Glob |
| `permissions.powershell-twin` | §6 | A Bash deny rule alone silently turns PowerShell off | Twins stay, because a Bash rule does not reach PowerShell; turning it off happens only with the default tool set |
| `skills.resume`, `skills.overrides-off` | §5.6 | Rebuilt on resume; `skillOverrides` per Project skill | Never a changed set on resume; overrides keyed by the bare name |
| `skills.start-before-brief` | §5.6 | At start, `init` lists the plugin with no errors | `init` comes only with the first message; the check reads `reloadPlugins` and the listing before it, and an `init` that disagrees ends the session |
| `skills.project-names` | §5.6 | Project skills keyed by the bare name | Keyed by a skill's folder or a command's path under `commands/`; expected at start by their listed names, at the repository's top only |
| `skills.frontmatter-yaml` | §2.6 Defaults | Uploads need YAML frontmatter | A plain value holding `: ` is read as the engine reads it |
| `skills.shell-execution` | §5.6 | Not covered | `disableSkillShellExecution` true: a skill's commands bypass the hook when they run |
| `permissions.read-fence-off` (2026-10-31) | §6 | `blockReadsOutsideWorkingDirectories` on fences the file tools; shell reads outside work only for profiles that allow commands | The setting is off: under it the engine refused commands the hook allowed. The hook alone fences Read, Grep and Glob; shell reads outside run wherever the profile allows the command; `claudeMdExcludes` names the instruction files above the session's folder, which load without the fence |

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
- **Observed:** no `init` arrives before the first message. The reload lists `office` at the session folder with no errors and is not held; the listing is exactly `office:alpha`. The turn's transcript has one user message and one skill listing, and the turn reads the shared prefix from the cache. A `shouldQuery: false` message with no text, tried while writing this check, also yields `init` without a model call, but stays in the conversation as a `(no content)` user message.
- **Meaning:** the start check runs before the brief (§5.6, amended): the reload for the plugin and its errors, the listing for the skill names. It leaves nothing in the conversation and costs no model call.

### skills.project-names

- **Run:** a Project with a skill whose folder `deploy-folder` holds a frontmatter `name: deploy-named`, a skill `lint`, a nested skill under `apps/web`, a command `ship.md` and a command `frontend/notes.md`; the listing before any message under `skills: 'all'`, under allowlists of listed and of folder names, and with `skillOverrides` keyed each way. No model call.
- **Observed:** the renamed skill is listed as `deploy-named`, but the allowlist and `skillOverrides` match it by its folder, `deploy-folder`. The command in a subfolder is listed as `frontend:notes`, allowed by the bare `notes` (the suffix rule) and turned off only by `frontend:notes`. Root commands are listed at start like skills; the nested skill is not (as `skills.overrides-off` found).
- **Meaning:** The Office keys a Project skill by its folder and a command by its path under `commands/` with `:` between folders, for the allowlist and the overrides alike, and expects at start the names the listing gives the ones at the repository's top: a skill's frontmatter name, a command's key.

### skills.shell-execution

- **Run:** a session skill whose text holds ``!`git --version` ``, invoked through the Skill tool, once with the Office's options and once with `disableSkillShellExecution` false.
- **Observed:** with the Office's options the skill loads with `[shell command execution disabled by policy]` in place of the command, which never runs. With the setting off, the engine checks the command against the permission rules itself: under `permissionPrompts: 'none'` it is refused ("This command requires approval") and the Skill call fails. The `PreToolUse` hook sees neither.
- **Meaning:** a skill's load-time commands bypass the Office rules hook, which §6 relies on for every command, so §5.6 turns them off; the Agent runs what a skill asks for through its tools.

### skills.allowlist-suffix

- **Run:** the session plugin with `alpha`, `beta`, `gamma` and `review`, a Project skill `review` and a second plugin `vendor` with `review`; allowlist `alpha`, `pha`, `office:beta`, `review`.
- **Observed:** `alpha` matches `office:alpha`, `pha` matches nothing, `gamma` is not listed, and a bare `review` enables `office:review`, the Project's `review` and `vendor:review` alike. Same as read from 2.1.308.
- **Meaning:** the allowlist matches the exact name or the `:<name>` suffix. The Office lists its own skills by full name (`office:<name>`) and checks allowed Project skill names against the session's other skill names (§5.6).

### skills.plugin-detection

- **Run:** three plugin folders: one without a manifest, one with a `SKILL.md` at its top, one folder of plugins.
- **Observed:** a folder without a manifest is one plugin named after the folder; a `SKILL.md` at the top makes the folder one plugin; a folder of plugins loads only the children with a manifest. No plugin errors. Same as read from 2.1.308.
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
- **Meaning:** `settingSources: ['project']` with the sync settings off keeps the user's own Claude Code setup out of Office sessions; no per-session `CLAUDE_CONFIG_DIR` is needed. From task 47 each Claude Code engine runs with its own folder as `CLAUDE_CONFIG_DIR` ([5.4](spec/5.4-the-engine.md#defaults)); this check has not been re-run under one (the user dropped it from task 47's live check on 2026-11-03, their live run covering it). The engine check strips `CLAUDE_CONFIG_DIR` from its sessions and reads only `~/.claude`, so a re-run needs a `--config-dir` option; it is on the [tasks' after-tier-3 list](tasks/README.md).

### skills.plugin-folder-reads

Retired 2026-10-31 (task 33): it measured grants through the engine's read fence, which The Office no longer sets; the hook lets a session read its skills folder (`permissions.read-fence-off`). Its last result, kept for history:

- **Run:** Read of a supporting file in the session plugin folder and of a file elsewhere in the Office data directory, under four grants: none, a `Read(//…/**)` allow rule, `permissions.additionalDirectories` (the Office's options), the `additionalDirectories` option.
- **Observed:** without a grant, and with the allow rule, both reads are refused (`outside_reads_blocked`). `permissions.additionalDirectories` and the option both let the skill folder be read while the other file stays refused.
- **Meaning:** contradicted §6, now amended: the folder is granted through `permissions.additionalDirectories`, which widens the permission scope only. The option is `--add-dir`, which would also read the folder's `.claude` as a project source.

### skills.resume

- **Run:** a session with `alpha` and `beta`, resumed with `beta` and `gamma`.
- **Observed:** the engine re-reads the folder (it lists `office:beta`, `office:gamma`) but attaches only the added skill for the model, so `alpha` stays named in the conversation's earlier listing.
- **Meaning:** §5.6 rebuilds the same recorded set on resume, and now says why: a changed set would leave the model believing in a removed skill. A Role's changed skills apply at the next fresh session.

### skills.deny-rule

- **Run:** a `Skill(office:beta)` deny rule.
- **Observed:** the skill stays in the listing and in `/name`; only its invocation is refused.
- **Meaning:** a deny rule cannot shape the listing; the session folder and the allowlist decide what a session sees.

## Permissions

### permissions.hook-sees-every-call

- **Run:** one session asked to Read a file in the worktree, Read a file refused by a path-scoped deny rule, Read a file outside the worktree and Write a file without an approval; a second session asked to start a subagent that reads a file. The engine may run the subagent in the background past its turn's result (seen on Linux), so the check waits for every started task to end.
- **Observed:** the `PreToolUse` hook is called before the engine answers for the allowed call, the fence refusal (`permission_denied`, reason type `other`; since task 33 turned the read fence off, a read outside the hook leaves undecided is refused for want of an approval surface, `asyncAgent`), the refusal for want of an approval surface (`asyncAgent`) and the subagent's own call (the subagent tool is `Agent` in `tool_use` though `init.tools` lists `Task`). A Read refused by a path-scoped deny rule never reaches the hook: it is refused at input validation ("File is in a directory that is denied by your permission settings."), sends no `permission_denied` message and shows only in `result.permission_denials`. The `PermissionDenied` hook was called for none of these refusals.
- **Meaning:** contradicted §6, now amended: The Office sets no path-scoped deny rule and makes path decisions in the hook, and logs refusals from `result.permission_denials` and `permission_denied` messages, not from the `PermissionDenied` hook. The engine's own validation refuses some calls before any hook, which no option changes: a standalone `sleep N` in Bash is refused ("Blocked: standalone sleep") without a hook call (seen while writing `engine.priority-*`).

### permissions.hook-refusal

- **Run:** a hook that refuses a Read with a reason naming another file to read instead.
- **Observed:** the model reads `PreToolUse:Read hook error: <reason>`, and reads the named file next. The refusal counts in `result.permission_denials` and sends no `permission_denied` message.
- **Meaning:** "Other refusals are immediate, with a reason the Agent reads" (§6) works through a hook `deny`. The brief tells the Agent to do what a refusal says.

### permissions.powershell-twin

Windows only.

- **Run:** five sets of rules, each read from `init.tools`, once with the Office's explicit tool list and once with the engine's default; then a PowerShell allow rule on `git *` beside a Bash deny rule on `git push`, with and without its PowerShell twin.
- **Observed:** with the engine's default tools, a Bash deny rule alone removes `PowerShell` from the tools; any PowerShell rule beside it (the twin deny, or even an allow) keeps it; a Bash allow rule alone leaves it. With the Office's explicit list, PowerShell stays under every rule set. A Bash deny rule does not reach PowerShell: without the twin, `git push` through PowerShell runs (and fails only for want of a remote); with the twin it is refused by the rule, and `git status` runs.
- **Meaning:** every shell rule The Office writes on Windows has its PowerShell twin, and with the explicit tool list the twin is the only thing that stops the command through PowerShell. §6 now gives that reason.

### permissions.file-tool-fence

Retired 2026-10-31 (task 33): it measured the engine's read fence, which The Office no longer sets; with it off only the hook fences the file tools (`permissions.read-fence-off`). Its last result, kept for history:

- **Run:** Read, Grep and Glob each pointed at the worktree, the session skills folder and elsewhere in the Office data directory, with the Office's options and without the skills-folder grant; a shell `cat` of the Office data file in a session of its own.
- **Observed:** all three tools are fenced alike: the worktree is readable, the rest of the Office data directory is refused, and the skills folder is readable exactly when it is in `permissions.additionalDirectories`. The shell `cat` outside is refused for want of an approval, since no command allow rule covers it.
- **Linux:** the same with the Office's explicit tool list. With the engine's default tool set Linux has no Grep or Glob at all (a call answers "No such tool available: Grep. Grep is not available in this session — search file contents with `grep` via the Bash tool instead."), which led §5.4 to name the tools explicitly.
- **Meaning:** the fence covers every file tool, and the grant opens the skills folder for all three and nothing else. Contradicted §6's "shell reads outside are accepted", now amended: they work only for profiles that allow commands. Not tried: a `cat` inside the worktree. Task 06 settled it without allow rules: the Office rules hook (`OfficeRules` in `apps/service/src/modules/engine/domain/`) allows each command its profile allows, wherever it reads, and refuses the rest.

### permissions.read-fence-off

- **Run:** with a `CLAUDE.md` in the folder above the worktree; under a hook that allows them, four commands the engine refused in task 32's live run (`true | cat; echo "status=${PIPESTATUS[0]}"`, `node -v`, `git -C <another repository> log -1 --oneline`, `cat <a file outside>`), each in a session of its own with `blockReadsOutsideWorkingDirectories` on, then all four in one session with it off, followed there by Read, Grep and Glob on a file and folder outside the worktree, which the hook also allows; the instruction files that session loaded, and those of a session without `claudeMdExcludes`.
- **Observed:** with the fence on, `node -v` runs and the other three are refused past the hook's `allow`: under the fence the engine judges every shell command and asks when its parser can't show the command reads only inside (a variable in braces, a folder named outside, a file read outside), and with no approval surface it refuses, naming the setting at the end of a long message that also tells the model not to retry. After one such refusal it refuses every later call that would ask (`circuitBreaker: outsideReadsBlocked` in the transcript), so a single session stops early. With the fence off all four commands run, and Read, Grep and Glob read outside: nothing but the hook fences the file tools then. Without the fence the engine also loads a `CLAUDE.md` in a folder above the worktree, typed `Project` in the context usage (on the workstation the user's own `~/.claude/CLAUDE.md` reached `fallback.start` that way); with the Office's `claudeMdExcludes` naming those files, none loads. The same on Windows and Linux.
- **Meaning:** the fence contradicted §6's "shell reads outside work for profiles that allow commands", and refused commands the Office rules allow. §6 now turns it off (the user's answer of 2026-10-31) and the hook alone fences Read, Grep and Glob, as it did already in its own words.

### permissions.protected-paths

- **Run:** writes to `.git/`, `.claude/` and `.mcp.json` and a control write, under three grants that approve other writes: `acceptEdits`, an `Edit(//<repo>/**)` allow rule, a hook `allow`.
- **Observed:** the control write goes through under each; the three protected writes are refused under each, typed `asyncAgent` with the decision reason "no approval surface in this session", the same as any other refusal for want of approval.
- **Meaning:** the engine never auto-approves the protected paths, even past a hook `allow`, but its refusal cannot be told apart from any other. §6 now has the hook refuse Agents' writes there first with a clear reason, the engine's protection staying as a backstop.

### permissions.hook-after-resume

- **Run:** a hook allows a Write; the session is closed and resumed with a hook that refuses every Write, and asked for another.
- **Observed:** the hook is asked afresh after the resume and its refusal applies (the reason reaches the model, the file is not written); the allow from before the resume is not kept.
- **Meaning:** hook decisions survive a resume because The Office registers the hook on every start; nothing granted in a session carries over. Answers the research's open "permissions granted in-session survive a resume" for the hook path: no.

## Engine behaviour

### engine.priority-next, engine.priority-later, engine.priority-now

- **Run:** while a 30 s command allowed by the hook runs, a message is sent with priority `next`, `later` or `now` (`now` twice: without an origin, and with `origin: {kind: 'human'}`, which the SDK asks a host relaying typed input to stamp). The turn that took it is read from the result's `user_message_uuids`.
- **Observed:** `next` lands in the running turn after the tool call ends. `later` waits for the turn to end and starts the next turn by itself. `now` does not stop the command. Without an origin, the command runs to its end, then the turn ends early (`aborted_tools`) and the message starts the next. With a human origin, the command moves to the background and keeps running; on Windows the turn then ends early and the message lands in the next, while on Linux (every run alike) the message lands in the running turn, which goes on.
- **Meaning:** barge-in is `next` (§2.4, §5.4). Contradicted §5.4's "`now` interrupts", now amended: `now` is not used, and Stop is `interrupt()`.

### engine.interrupt

- **Run:** `interrupt()` while a 30 s command runs, then a next message in the same `query()`, then a resume by id after closing.
- **Observed:** the running Bash call is rejected at once (`aborted_tools`, result `error_during_execution`) and the command itself ends, on both platforms (its end marker never appears). `interrupt()` returns a receipt listing what is `still_queued` (`interrupt_receipt_v1` in `init.capabilities`). The same `query()` takes the next turn, and a resume by id afterwards works.
- **Meaning:** Stop as §2.4 and §5.4 describe it; the Stage's uncommitted edits are then discarded by The Office (§5.5).

### engine.office-tool

- **Run:** an in-process `office` server from `createSdkMcpServer()` with one tool, called with and without an `mcp__office` allow rule.
- **Observed:** the tool is in `init.tools` as `mcp__office__handover_note` and its server is `connected`. With the allow rule the hook sees the call first and the handler runs with the arguments asked for. Without it, `permissionPrompts: 'none'` refuses the call (`asyncAgent`) and the handler never runs.
- **Meaning:** Office tools work in-process (§5.4), and The Office allows its own tools by rule (§6 build rules).

### engine.decision-wait

Slow: about an hour; runs only with `--include-slow`. Recorded on Windows 2026-10-24 under the options of task 01 step 5 (connectors, built-in plugins and auto-memory on, the default tool set), and on Linux 2026-10-25 under today's options, with the same result; re-run with `--include-slow` before an SDK bump is merged.

- **Run:** an Office tool opens a Decision and its result tells the Agent to end its turn and wait; the answer is sent as the next message into the still-open `query()` 62 minutes later (`ENGINE_CHECK_DECISION_WAIT_MINUTES`).
- **Observed:** the Agent made no further tool call and ended its turn; the answer continued the work in the same session (it read the chosen file). That turn read nothing from the cache: the hour had passed and the Office tool in the tool list gives the session a prefix no other session kept warm.
- **Meaning:** Agents wait on Decisions as §2.4 describes, with no session kept busy; the first turn after a long wait pays the full prompt again, which the Context policy (§2.5) weighs.

### engine.resume-cache

- **Run:** a turn with a tool call, close, resume by id within the hour, another turn.
- **Observed:** the resumed turn reads the whole earlier conversation from the cache; every cache write uses the 1-hour lifetime. After a session's only request (a turn without tool calls), the next request reads just the system prompt part, so the first message is written again once.
- **Meaning:** Resume while the cache is warm (§2.5) is cheap, as assumed.

### engine.rate-limit-event

- **Run:** one turn, collecting `rate_limit_event` messages, then the experimental usage query.
- **Observed:** the event carries `resetsAt` but no top-level `utilization`, and names one `rateLimitType` (`five_hour`). Both windows, each with `utilization` (a 0–1 fraction) and `resetsAt`, are only in `rate_limit_info.unifiedWindows`, which the typings do not declare. The usage query has `five_hour` and `seven_day` with `utilization` (0–100) and `resets_at`.
- **Meaning:** §5.4 names both sources; the adapter treats the event as the signal and reads the windows from the usage query, never from the undeclared field (task 06).

### engine.parallel-sessions

- **Run:** three sessions in three worktrees of one repository, each held inside a tool call by a hook barrier until all three arrive.
- **Observed:** all three were inside a tool call at once and ended normally, as distinct sessions.
- **Meaning:** the Office-wide limit of 3 running Tasks (§2.2 Defaults) is within what the engine runs on one login.

### engine.lean-options

- **Run:** a first call in each of two worktrees of one repository under the Office's options; a session started without a model call with a short `tools` list (Bash, Edit, Glob, Grep, PowerShell on Windows, Read, Skill, Write) and `strictMcpConfig`.
- **Observed:** the first call under the Office's options is about 28k tokens on Windows (the system prompt and 27 built-in tools, 24.6k, cached and shared, plus the first message) and about 23k on Linux (26 tools, no PowerShell). The engine's default set on Linux has no Grep or Glob; naming them in `tools` brings them back. The second worktree's first call reads the same prefix from the cache as the first's, so the cached prefix is identical across Tasks. No claude.ai connector loads. The short list brings the start to about 10k.
- **Meaning:** §5.1's stable cached prefix holds across worktrees. §5.4 names the tools explicitly so both platforms get the same set. A first call close to §2.5's 30k resume-or-brief threshold is the cost of that set; trimming it per Role (which needs Task, WebSearch, ToolSearch) is open in §5.4.

### engine.turn-usage

- **Run:** one turn that starts a subagent with the Task tool and then reads a file, then a second turn interrupted while its command runs; each assistant frame's `message.usage` is compared with the turn's `result.usage`.
- **Observed** (added 2026-10-26, recorded alone on both platforms, the same): every assistant frame carries `message.usage`, a subagent's frames (`parent_tool_use_id` set) and an interrupted turn's too. The frames of one message (one per content block, sharing its id) repeat the same usage; it does not grow. A frame's `output_tokens` is what was known as the message began (single digits), so the turn's result reports far more output (about 350 against 30 here). `result.usage`'s input, cache reads and cache writes are exactly the sum of the main loop's messages: a subagent's messages are left out (they show only in `modelUsage`, which adds up over the session). An interrupted turn (`aborted_tools`) reports its main-loop messages the same way, its output included, not zero. Not checked here, as the moment can't be timed, but seen in task 13's check on the Test Project (in the session's transcript): a turn Stopped while a message still streamed, after its Edit call had run, reported usage without that message, whose frames had shown about 39k tokens, mostly cache reads.
- **Meaning:** live tokens (§2.4, task 13) count each message id once from its frames, main loop only, so the count The Office shows during a turn rises with each message's input and cache tokens and the turn's own usage replaces it at the end with a jump of the output alone. The Office takes a turn's usage, part by part, as at least what its messages streamed (`TurnTokens.settled`), so a message cut off mid-stream still counts. Budgets count that usage, so a subagent's tokens are in no budget; an interrupted turn's tokens are counted as spent.

### engine.auto-memory

- **Run:** a session asked to save a fact to its auto-memory, under the Office's options and with `autoMemoryEnabled: true` (the engine's default).
- **Observed:** under the Office's options `init` names no memory folder, the model has none to write to, and no folder is created. With the engine's default, `init.memory_paths` (not in the typings) names `~/.claude/projects/<repository>/memory/`, and the model writes there with no prompt despite the read fence and `permissionPrompts: 'none'`; the hook sees those writes first.
- **Meaning:** §5.4 now turns auto-memory off: its folder is outside the worktree, shared by every worktree of a repository and every Role, and outside the Brief. Memory stays The Office's own (Shared memory, tier 2). The engine auto-allows writes to some of its own paths outside the worktree, so the read fence and `permissionPrompts: 'none'` do not keep writes in the worktree: the hook fences writes itself (task 06).

## The `-p` fallback

Each capability of `EngineCapabilities` on the pinned binary in `-p`, started as [How a check runs](#how-a-check-runs) describes (task 29, spec §5.4 Defaults). Every check gave the same result on Windows and Linux.

### fallback.start

- **Run:** a session with two session skills in the folder given by `--plugin-dir` (re-run 2026-10-30 after the switch from `--plugin-dir-no-mcp`, matching on Windows), a Project skill the Role has (`lint`) and one turned off by `skillOverrides` (`deploy`), and one Office tool served through the stream (re-run 2026-10-30 after the switch from the MCP endpoint, task 29 step 4a); the SDK adapter's start check (`reload_plugins` holding on cache impact, then `get_context_usage`) before any message, then a message that does not query, then `get_usage`. No model call.
- **Observed:** the binary is 2.1.310 and keeps the session id given. The start check works as on the SDK: nothing held, no plugin errors, the `office` plugin at its folder, and the listing is exactly `lint`, `office:alpha`, `office:beta`. `init` lists exactly the Office's tools plus `mcp__office__handover_note`, one MCP server, `office`, `connected`, no other plugin, no claude.ai connector, no auto-memory folder; no memory files load (none listed, 0 tokens in the `memory_files` category; a session started without the Office's settings showed about 2.4k there, with auto-memory on). `get_usage` answers with `five_hour` and `seven_day`, each with `utilization` and `resets_at`. Before any turn the binary sends the Office tool server `initialize`, `notifications/initialized` and `tools/list` as `mcp_message` requests; it asked the host nothing else. Before any turn `get_usage` follows the account's state: on the step 4a runs it answered at times without `resets_at` (Windows, matching again on a re-run) or without `resets_at` and `utilization` (Linux, on the old `localhost` route too, the same hour). A re-run on Linux on 2026-10-30 named no window at all. So the check records only that the query answers (since 2026-10-30, task 29 step 6); the live contract's `usage-windows` scenario, which reads them after a turn, found `percentUsed` in both windows on both platforms the same day.
- **Meaning:** the skills of §5.6 hold on `-p` without the SDK's allowlist: the setting sources, the overrides and the session folder leave exactly the session's skills, as ticket 22 expected. The lean options of §5.4 hold as flags and settings. `contextUsage` and `usageWindows` hold through control requests, `officeTools` through the stream, with no `initialize` request from the host.

### fallback.tools-and-rules

- **Run:** one turn that calls the Office tool (served through the stream since task 29 step 4a), runs a command the hook endpoint allows (a script writing whether the session's token is in its environment, not the token), runs one it refuses with a reason, and runs a session skill with the Skill tool.
- **Observed:** the Office tool's call reaches the handler with the note asked for (a `tools/call` `mcp_message`), after the hook saw it. The allowed command runs; the refused one is `denied` and the model reads the hook's reason. The skill runs under the `Skill(office:alpha)` rule. The hook endpoint gets `PreToolUse` and `PostToolUse` calls, each with the token. **The token is in the environment of the Agent's commands.**
- **Meaning:** the Office rules reach the service on `localhost` and the Office tools through the binary's stream (§5.4 Defaults, §6), and skills run as on the SDK. An Agent can read its own session's token and call that session's hook endpoint directly. Wherever the token goes (environment, command line or a file), a process of the same user can read it, so it ties a call to a session but does not keep an Agent out (task 29 step 3).

### fallback.hook-unreachable

- **Run:** the hook points at a `localhost` port nothing listens on; one turn reading `README.md`.
- **Observed:** the Read call is `denied` (in `permission_denials`) and its result is `PreToolUse:Read hook error: […] failed; blocking because onFailure is "block"`; the file's content never reaches the model.
- **Meaning:** with `onFailure: 'block'` the Office rules refuse when the service can't be reached (§6). The engine's default for a failing hook is `continue`, which would let the call go ahead (the SDK's `Settings` typings), so the flag is required.

### fallback.output-schema

- **Run:** a turn under `--json-schema` asking for `{answer: "OK"}`.
- **Observed:** the turn completes with `structured_output` exactly `{answer: "OK"}`. The turn streams `rate_limit_event`, with `resetsAt` and a `rateLimitType`; which window it names follows the account's use (`seven_day` on these runs, `five_hour` in `engine.rate-limit-event`), so only that it names one is recorded.
- **Meaning:** `outputSchema` holds. `usageWindows` reads the windows from `get_usage`, with the event as the signal, as on the SDK (`engine.rate-limit-event`).

### fallback.interrupt

- **Run:** as `engine.interrupt`, with an `interrupt` control request while the 30 s command runs, a next turn in the same process, then a new process with `--resume`.
- **Observed:** the same as on the SDK: the receipt lists `still_queued` (`interrupt_receipt_v1` in `init.capabilities`), the turn ends `aborted_tools`, the Bash call fails and the command itself ends, the next turn completes, and the resumed session continues under the same id.
- **Meaning:** `interrupt` and `resume` hold.

### fallback.priority-next, fallback.priority-later

- **Run:** as `engine.priority-next` and `-later`, the message written to the binary's input with its `priority`.
- **Observed:** the same as on the SDK: `next` lands in the running turn after the tool call ends; `later` waits for the turn to end and starts the next.
- **Meaning:** `bargeIn` holds.
- **Seen since (task 29 step 4, the service's `ClaudeCodePEngine` under the `AgentEngine` contract, 2026-10-30):** at an Office tool's end it doesn't hold on Windows. The contract's `barge-in` scenario sends a `next` message while the Office tool runs and lets the tool answer at once: on Windows the turn ends consuming the brief only (twice in two runs), and the message lands in the next turn; with 1.5 s between the message and the answer it lands in the running turn. On Linux the scenario passes. On the SDK the tool's answer comes back through the binary's input after the message, so the order holds; on `-p` it comes over HTTP and races the message written to the input. The binary acknowledges each message it reads with a `command_lifecycle` line (`state: "queued"`, `command_uuid` the message's uuid; then `started`, `completed`), about 3 ms after the write, with or without `--replay-user-messages` (which echoes the message only once a turn takes it). `command_lifecycle` is not in the SDK's typings and the SDK doesn't read it. The user chose to serve the Office tools through the binary's stream (spec §5.4 Defaults, amended 2026-10-30); see `fallback.priority-next-office-tool`.

### fallback.priority-next-office-tool

- **Run:** one turn calling an Office tool served through the stream whose handler sends a `next` message before it answers, as the contract's `barge-in` sends one while a held Office tool waits (task 29 step 4a).
- **Observed:** on Windows and on Linux the message lands in the running turn: its result lists the brief and the message. Re-run `fallback.priority-next` matches. The service's `ClaudeCodePEngine` passes the contract's `barge-in`, and the whole contract (10 of 10), on both.
- **Meaning:** through the stream the tool's answer goes down the binary's input after every message sent before it, as on the SDK, so `bargeIn` holds at an Office tool's end too.

## The OpenAI-compatible API

The Office's own loop (spec §5.4 Defaults, task 35) has no binary to check: it is checked by the `AgentEngine` contract on a live server and by task 35's check on the Test Project (apps/service/docs/testing.md, live checks). Seen once, on Windows only, on the user's Strata at `http://127.0.0.1:8080/v1` serving `qwen3.8-flash-next-coder-iq1_m` (`n_ctx` 100000), which reads a prompt at about 14 tokens/s and writes about 11 tokens/s, so each scenario ran alone.

- **Contract:** `reply` (streaming; 140 s), `refusal` (a Write judged by the Office rules, refused in their words; 364 s), `interrupt` (an Office tool held, the turn interrupted, the next message taken; 212 s), `resume` (the conversation kept and an Office tool called with the word remembered; 244 s), `output-schema` (StructuredOutput checked; 240 s) pass. `office-tool`, `barge-in`, `later` and `context-usage` were left out as the fake server covers them; `usage-windows` is refused by design.
- **Chat on the Test Project:** the Developer on the endpoint's model, asked how many workspaces the Test Project's `package.json` lists, ran Glob then Read and replied `3` in one message, in 475 s and 14.9k tokens.
- **A Stage on the Test Project:** a Task the user planned (the Planner never ran) on Quick fix with a Gate before Publish, the Developer on the endpoint's model. Implement (145 s, 94k tokens, 78k of them read from the server's cache) ran Read, Edit, `git status --short` through Bash, a Write to `.claude/` refused by the Office rules in their words (the model read the refusal and did not retry), and StructuredOutput; Tests passed and the Task waited at the Gate, then was dropped. Each answer's text shows as one message. A first run, with the refused Write aimed at `.github/`, was allowed: `.github/` is not a protected path in the Office rules (only `.git`, `.claude` and `.mcp.json`), so the check's Plan was wrong, not the engine.
- **Observed:** Strata streams the model's reasoning as `reasoning_content`, which the loop leaves out; only `content` is the answer. Two consecutive user messages in one request were accepted (200), so joining them per request is a precaution, not a need, on this server. Skills were not loaded live.
- **From the pinned binary (2.1.310), not from a session:** `AGENTS.md` and `.claude/AGENTS.md` load only through the built-in `cc-plugin-agents-md` plugin (by default where the project has no `CLAUDE.md`), which the Office's settings turn off, so the SDK adapter's sessions load neither and the loop's list matches. A background command's notice is queued as a `task-notification` command at priority `next`; whether that starts a turn in an idle SDK session was not seen.

## Other observations

Seen while running the checks, recorded so a bump can be compared against them.

- With connectors on (before §5.4 turned them off), claude.ai connectors connect while the session runs and arrive as `tool_addition` and `mcp_instructions_delta` messages between turns; a resumed session that starts before they connect sends their removal.
- The transcript holds a `session_context` attachment with the signed-in user's e-mail address, under `settingSources: ['project']`.
- The engine leaves an empty `memory/` folder in the transcript folder of each working directory when auto-memory is on.
- `apiKeySource` is `none`; no memory files and no user hooks reach a session.
- `engine.priority-now` differed once on Windows on 2026-10-25 (the running command was interrupted instead of finishing, in about half the usual time) and matched on the two runs after it. The Office does not use `now`.
- On Linux, after a command moved to the background, the model read its output file under `/tmp/claude-0/…/tasks/`, outside the worktree, and the read fence let it: the engine allows reads of its own task output. Harmless, and one more engine-owned path past the fence. Task 06's hook fences reads itself and lets each session read that folder of its own, by its session id (agreed with the user on 2026-10-25); it is under `%TEMP%\claude\` on Windows.

## Not checked

- On the `-p` fallback: priority `now` (not used), a hook that answers too late or with an error status rather than not at all, and whether the Skill tool asks for permission without the `Skill(…)` rule.
- Which engine-owned paths outside the worktree, other than the auto-memory folder, the engine auto-allows writes to. The hook fences writes regardless.
- From the research's "Could not confirm": whether `forkSession` resumes read the parent's cache, a non-child process posting into a session's inbox on Windows, concurrency limits beyond three sessions and how cache reads count against plan quota, `projectConfigRoot` and `CLAUDE_SECURESTORAGE_CONFIG_DIR`. Tier 1 uses none of them.
