# Engine check

What tier 1 takes on trust about the engine, checked against live sessions on the pinned versions: the skills mechanism of [spec §5.6](spec.md#56-skills-per-session), the permission build rules of [§6](spec.md#6-permissions-and-safety) and the engine behaviours of [§5.4](spec.md#54-the-engine). The check lives in [tools/engine-check](../tools/engine-check); each entry below names the check id it shares with `tools/engine-check/expectations.json`, where the observed facts are recorded per platform.

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
| Model for the checks | `claude-haiku-5-5` |

## Runs

| Platform | Date | Result |
|---|---|---|
| Windows 11 (win32), the workstation | 2026-10-25 | 24 checks run and recorded; the slow `engine.decision-wait` recorded 2026-10-24 |
| Ubuntu 24.04 x64 (linux), an LXC container signed in to Claude Code as root | 2026-10-25 | 23 checks run and recorded, and the slow `engine.decision-wait` (62 minutes) |

`permissions.powershell-twin` runs on Windows only. Results differ between platforms only where an entry says so: `skills.user-scope`, `engine.priority-now` and `engine.lean-options`.

## How a check runs

Each check runs in a throwaway git repository in a temp folder, with an Office data directory beside it holding the session plugin folder (`office-data/sessions/<session-id>/skills/`) and Task worktrees. Sessions start with the options The Office ships, so a result holds for The Office:

- `settingSources: ['project']`, the session plugin folder in `plugins`, `skills` listing `office:<name>` for each session skill;
- settings: `syncClaudeAiSkills` and `syncClaudeAiPlugins` false, `disableBundledSkills` and `disableSkillShellExecution` true, `disableClaudeAiConnectors` true, `autoMemoryEnabled` and `autoDreamEnabled` false, the three built-in plugins false in `enabledPlugins`, `permissions.blockReadsOutsideWorkingDirectories` true, the session plugin folder in `permissions.additionalDirectories`;
- `tools` naming the built-in tools explicitly, the same list on both platforms with PowerShell on Windows only (see `engine.lean-options`);
- `permissionPrompts: 'none'`, the `claude_code` system prompt preset with `excludeDynamicSections`, an environment without inherited `CLAUDE*`, `ANTHROPIC*`, `MCP_*` and `OTEL_*` variables;
- the hooks The Office registers (`PreToolUse`, `PostToolUse`, `PermissionDenied`), recorded on every call and allowing by default; a check decides calls where it needs to.

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

## Skills

### skills.start-check

- **Run:** a session with skills `alpha` and `beta`, started without a model call (a `shouldQuery: false` message still yields `init` and the turn-start attachments).
- **Observed:** `init.plugins` lists `office` at the session folder with no errors, and no other plugin; the listing the model gets holds exactly `office:alpha`, `office:beta`. `init.skills` also names `design` and `doctor`, outside the allowlist, though the listing stays clean.
- **Meaning:** the start check of §5.6 works as written: compare `init.plugins` and the listing, not `init.skills`. A release that adds a built-in plugin shows here as another plugin, and its id joins the `enabledPlugins` list.

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

### skills.user-scope

- **Run:** a session under the Office's options on a workstation with user-scope installed plugins, user skills, synced skills and synced plugins.
- **Observed:** none of them loads. `~/.claude/commands` is absent on the Windows workstation, so that part proves nothing there. On the Linux container none of them is present, so the Linux run proves nothing here; the Windows run is the evidence. No variant with sync on was run, since it could write into `~/.claude`.
- **Meaning:** `settingSources: ['project']` with the sync settings off keeps the user's own Claude Code setup out of Office sessions; no per-session `CLAUDE_CONFIG_DIR` is needed.

### skills.plugin-folder-reads

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
- **Observed:** the `PreToolUse` hook is called before the engine answers for the allowed call, the fence refusal (`permission_denied`, reason type `other`), the refusal for want of an approval surface (`asyncAgent`) and the subagent's own call (the subagent tool is `Agent` in `tool_use` though `init.tools` lists `Task`). A Read refused by a path-scoped deny rule never reaches the hook: it is refused at input validation ("File is in a directory that is denied by your permission settings."), sends no `permission_denied` message and shows only in `result.permission_denials`. The `PermissionDenied` hook was called for none of these refusals.
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

- **Run:** Read, Grep and Glob each pointed at the worktree, the session skills folder and elsewhere in the Office data directory, with the Office's options and without the skills-folder grant; a shell `cat` of the Office data file in a session of its own.
- **Observed:** all three tools are fenced alike: the worktree is readable, the rest of the Office data directory is refused, and the skills folder is readable exactly when it is in `permissions.additionalDirectories`. The shell `cat` outside is refused for want of an approval, since no command allow rule covers it.
- **Linux:** the same with the Office's explicit tool list. With the engine's default tool set Linux has no Grep or Glob at all (a call answers "No such tool available: Grep. Grep is not available in this session — search file contents with `grep` via the Bash tool instead."), which led §5.4 to name the tools explicitly.
- **Meaning:** the fence covers every file tool, and the grant opens the skills folder for all three and nothing else. Contradicted §6's "shell reads outside are accepted", now amended: they work only for profiles that allow commands. Not tried: a `cat` inside the worktree. Task 06 settled it without allow rules: the Office rules hook (`OfficeRules` in `apps/service/src/modules/engine/domain/`) allows each command its profile allows, wherever it reads, and refuses the rest.

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
- **Meaning:** the Office-wide limit of 3 running Tasks (§9) is within what the engine runs on one login.

### engine.lean-options

- **Run:** a first call in each of two worktrees of one repository under the Office's options; a session started without a model call with a short `tools` list (Bash, Edit, Glob, Grep, PowerShell on Windows, Read, Skill, Write) and `strictMcpConfig`.
- **Observed:** the first call under the Office's options is about 28k tokens on Windows (the system prompt and 27 built-in tools, 24.6k, cached and shared, plus the first message) and about 23k on Linux (26 tools, no PowerShell). The engine's default set on Linux has no Grep or Glob; naming them in `tools` brings them back. The second worktree's first call reads the same prefix from the cache as the first's, so the cached prefix is identical across Tasks. No claude.ai connector loads. The short list brings the start to about 10k.
- **Meaning:** §5.1's stable cached prefix holds across worktrees. §5.4 names the tools explicitly so both platforms get the same set. A first call close to §2.5's 30k resume-or-brief threshold is the cost of that set; trimming it per Role (which needs Task, WebSearch, ToolSearch) is open in §5.4.

### engine.auto-memory

- **Run:** a session asked to save a fact to its auto-memory, under the Office's options and with `autoMemoryEnabled: true` (the engine's default).
- **Observed:** under the Office's options `init` names no memory folder, the model has none to write to, and no folder is created. With the engine's default, `init.memory_paths` (not in the typings) names `~/.claude/projects/<repository>/memory/`, and the model writes there with no prompt despite the read fence and `permissionPrompts: 'none'`; the hook sees those writes first.
- **Meaning:** §5.4 now turns auto-memory off: its folder is outside the worktree, shared by every worktree of a repository and every Role, and outside the Brief. Memory stays The Office's own (Shared memory, tier 2). The engine auto-allows writes to some of its own paths outside the worktree, so the read fence and `permissionPrompts: 'none'` do not keep writes in the worktree: the hook fences writes itself (task 06).

## Other observations

Seen while running the checks, recorded so a bump can be compared against them.

- With connectors on (before §5.4 turned them off), claude.ai connectors connect while the session runs and arrive as `tool_addition` and `mcp_instructions_delta` messages between turns; a resumed session that starts before they connect sends their removal.
- The transcript holds a `session_context` attachment with the signed-in user's e-mail address, under `settingSources: ['project']`.
- The engine leaves an empty `memory/` folder in the transcript folder of each working directory when auto-memory is on.
- `apiKeySource` is `none`; no memory files and no user hooks reach a session.
- On Linux, after a command moved to the background, the model read its output file under `/tmp/claude-0/…/tasks/`, outside the worktree, and the read fence let it: the engine allows reads of its own task output. Harmless, and one more engine-owned path past the fence. Task 06's hook fences reads itself and lets each session read that folder of its own, by its session id (agreed with the user on 2026-10-25); it is under `%TEMP%\claude\` on Windows.

## Not checked

- Items that concern only `claude -p` (tier 2), among them whether the Skill tool asks for permission by default.
- Which engine-owned paths outside the worktree, other than the auto-memory folder, the engine auto-allows writes to. The hook fences writes regardless.
- From the research's "Could not confirm": whether `forkSession` resumes read the parent's cache, a non-child process posting into a session's inbox on Windows, concurrency limits beyond three sessions and how cache reads count against plan quota, `projectConfigRoot` and `CLAUDE_SECURESTORAGE_CONFIG_DIR`. Tier 1 uses none of them.
