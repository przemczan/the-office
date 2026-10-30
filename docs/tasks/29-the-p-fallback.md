# 29 · Running: the `-p` fallback adapter

Status: in progress

## Goal

A Role can work with Claude Code `-p` in place of the Agent SDK, picked in its Role card's Engine field ("Claude Code -p", as in the click-through), and does the same work there: chat, Stages, Office tools, the Office rules, exactly its skills, Stop, barge-in, resume, usage windows, as far as the engine check finds the CLI can. The fallback keeps The Office running if the SDK route stops being usable on the subscription. Spec [5.4](../spec/5.4-the-engine.md) (the port, the adapters, Defaults), [5.6](../spec/5.6-skills-per-session.md) (skills per session), [6](../spec/6-permissions-and-safety.md) (the Office rules); tickets [02](../../.scratch/the-office/issues/02-agent-engines.md), [22](../../.scratch/the-office/issues/22-skills-per-session.md) (the `-p` fallback's flags), [12](../../.scratch/the-office/issues/12-architecture.md) (the engine boundary); coverage row for task 29 in [coverage.md](coverage.md).

## Definition of Done

- [ ] The engine check has runs for the fallback on Windows and on Linux: the pinned binary in `-p` with stream-json in and out; for each capability of `EngineCapabilities`, whether it holds and how; Office tools from a `localhost` MCP endpoint; the Office rules from a hook that asks the service; exactly the session's skills. Check: `npm run engine-check -- --only fallback.` on both platforms, recorded in [engine-check.md](../engine-check.md).
- [ ] `ClaudeCodePEngine` passes the `AgentEngine` contract (`describeAgentEngineContract`) with the capabilities the engine check found, live under `OFFICE_ENGINE_TESTS=live`; its event mapping and its flags have unit tests. Check: the adapter's tests, live on Windows and Linux.
- [x] Sessions run on the engine their Role picks: the Engine module holds an engine per id, a session names its engine, capabilities are read per engine, a Thread resumes only on the engine its session ran on (a changed engine starts fresh). Check: service tests on two scripted engines.
- [ ] The Role card's Engine field offers "Claude Code -p" with its models; a Role switched to it chats and runs a Stage with Office tools. Check: Playwright of the Role card; a live check on the Test Project with a Role on the fallback (cheapest model).
- [ ] `npm run verify` and `npm run verify:linux` pass. Check: the commands.

## Read first

- [Engine module map](../../apps/service/src/modules/engine/MAP.md) (`ports/agent-engine.ts`, `ports/agent-engine.contract.ts`, `adapters/agent-sdk/`, `application/engine-sessions.ts`).
- [engine-check.md](../engine-check.md) (Pinned versions, How a check runs) and ticket [22](../../.scratch/the-office/issues/22-skills-per-session.md)'s `-p fallback` line.

Leave out: start at login (left out for now, spec 3: The Office is set up and started by hand); an Office-wide switch to the fallback; other engines (tier 3); the phone (task 28, postponed); the after-tier-2 fixes in the README.

## Steps

- [x] 0. Settle the open questions with the user; record the answers in spec 3, 5.1 and 5.4 Defaults; write this file, link it from the README, update coverage. Commit.
- [x] 1. The engine check's fallback runs: in `tools/engine-check`, a probe session for the pinned binary in `-p` (`--input-format stream-json --output-format stream-json`), and `fallback.*` checks: start and a turn, interrupt, priority `next` and `later`, resume by session id, the output schema, context usage, usage windows and `rate_limit_event`, Office tools from an HTTP MCP server named in `--mcp-config`, a `PreToolUse` hook that asks a local endpoint and refuses a call, the skills folder with ticket 22's flags and its start check, the lean options of spec 5.4 as flags. Run on Windows and on Linux; record each in engine-check.md. If a capability can't hold, or the tools or the rules can't reach the service, stop and ask the user before step 2. Commit.
  Read: `tools/engine-check/src/` (`probe-session.ts`, `run-checks.ts`, `main.ts`), engine-check.md's How a check runs and a check entry or two; the SDK's spawn of the binary, by grep in its package.
- [x] 2. An engine per Role, the service: the engine ids (`agent-sdk`, `claude-code-p`) and each one's models in the Engine module's public entry, People's `ENGINES` and `ENGINE_MODELS` and contracts' `engineSchema` built from them; `AgentEngines` holding an engine per id; `EngineSessions` starting and resuming on the session's engine, capabilities read per engine; the Thread's session keeps its engine, and a Role whose engine changed starts fresh; the fallback bound to a placeholder that refuses until step 4. Tests on two scripted engines. Commit.
  Read: `engine-sessions.ts`, `engine.module.ts`, `scripted-engine.module.ts`; `people/domain/role-card.ts`; `conversations/domain/thread.ts`, `stage-threads.ts` and `thread-runner.ts` where they start and resume.
- [x] 3. The Office tools and the Office rules over `localhost`, the service: an MCP endpoint serving a session's Office tools from `OfficeToolRegistry`, and the hook endpoint asking `OfficeRules` and the session's `ToolHold`, both behind a token made per session and handed only to its process; the Host and Origin checks apply. Tests over HTTP. Commit.
  Read: `adapters/agent-sdk/sdk-options.ts` (the tool server, the hook), `office-rules-hook.ts`, `application/office-tool-registry.ts`; `platform/http/` map entries.
- [ ] 4. `ClaudeCodePEngine`, the service: spawning the pinned binary with the flags step 1 settled, the session's environment and skills folder as the SDK adapter makes them, stream-json in (messages with priority, interrupt and the other control requests) and out (the SDK adapter's event mapping, shared, not copied), the start check, ending the process tree; declared capabilities as step 1 found; the contract live. Commit.
  Read: `agent-sdk-engine.ts`, `engine-process.ts`, `sdk-events.ts`, `start-check.ts`; `ports/agent-engine.contract.ts`; [testing](../../apps/service/docs/testing.md) for live adapter tests.
- [ ] 5. The Role card, the web: the Engine field offering "Claude Code -p" (`ENGINE_LABELS`), the models following the engine; Playwright. Commit.
  Read: `apps/web/src/shell/role-card-words.ts`; the Role card editor in `surfaces/people/`, by its map.
- [ ] 6. The live check on the Test Project with a Role on the fallback; `npm run verify` and `npm run verify:linux`; close the task. Commit.
  Read: [the Test Project](test-project.md); [testing](../../apps/service/docs/testing.md) for a live check.

## State

- Steps 0-3 done. Every capability holds on the pinned binary in `-p`, the same on Windows and Linux (engine-check.md, "The `-p` fallback"); `ClaudeCodePEngine` declares them all.
- Flags: `tools/engine-check/src/claude-code-p/arguments.ts` `claudeCodePArguments` (`--plugin-dir`), no `initialize` request; control requests `{type:'control_request', request_id, request:{subtype,...}}`, answers `control_response`; filter `control_*`, `keep_alive`, `transcript_mirror` out; answer the engine's own `control_request` with an error. Not in the check's flags but needed: `--effort`, the instructions (`--append-system-prompt-file`, the command line is capped at 32,767 characters on Windows). Binary resolution: `claude-code-p/pinned-binary.ts`; the service needs it through `OperatingSystem` (only `platform/os/` reads the system).
- Step 3 built: what both Claude Code adapters share is in Engine's `adapters/claude-code/` (`office-tools.ts` names and `officeToolAnswer`, `office-rules-hook.ts` with `toolDecision`, `tool-actions.ts`, `sdk-events.ts`, `tool-refusals.ts`, moved from `agent-sdk/`). `SessionEndpoints` (`adapters/claude-code-p/session-endpoints.ts`) opens a session's endpoints: a 256-bit token, the hook and MCP URLs on the address the service listens on (`HttpAdapterHost`), `close()` ends the token. `SessionEndpointsController` (`adapters/http/`, `/api/engine/claude-code-p/hook` and `/mcp`) answers the hook with the session's `preToolUse` and serves its Office tools statelessly, asking `decide` (the hook's `toolDecision`, with the ToolHold) on every call. `serveSessionEndpoints()` (`adapters/http/session-endpoints.fixtures.ts`) serves them with no database, for step 4's live test. `configureHttp` reads JSON bodies up to 16 MB (a Write's content reaches the hook whole).
- Step 4: the engine builds an `EndpointSession` per session (`officeRulesHook(rules, refusals, hold)` and `toolDecision` on the same rules), opens it before spawning, closes it on end or a failed start; the token goes in `OFFICE_SESSION_TOKEN` (drop any given variable of that name first, by `sameVariableName`). Hooks: `PreToolUse` only, `http`, `onFailure: 'block'`, 600 s. Move `engine-process.ts`, `start-check.ts` (over a narrow `reloadPlugins`/`getContextUsage` interface), the settings and `sessionEnvironment` into `adapters/claude-code/` as step 4 needs them.
- Traps: the MCP test client of `@modelcontextprotocol/sdk` doesn't load under vitest (`eventsource-parser`'s `source` condition), so the tests post JSON-RPC with fetch; an MCP server with no tool answers `tools/call` with a JSON-RPC error. A hook held for a Decision needs a timeout longer than 600 s or a refusal on timeout.
- Decided with the user on 2026-10-30: start at login dropped for now; the fallback at parity with the SDK adapter, picked per Role, no Office-wide switch, the pinned binary and the same models. Engine id `claude-code-p`, label "Claude Code -p". Chosen in step 2, for the user to confirm: the label reason "engine changed".
- Engine-check structure: `RecordedSession` (`src/recorded-session.ts`) is the base of `ProbeSession` (SDK) and `ClaudeCodePSession`; shared options in `src/office-options.ts`.

## Progress

- 2026-10-30 · step 0: questions settled (start at login dropped, the fallback at parity with the SDK adapter); spec 3, 5.1, 5.4 amended; next is step 1, the engine check's fallback runs.
- 2026-10-30 · step 1: the engine check runs the pinned binary in `-p` (`fallback.*`, 7 checks) on Windows and Linux; every capability holds, Office tools and rules reach `localhost` with a per-session token; next is step 2, an engine per Role.
- 2026-10-30 · step 2: an engine per Role: ids and models in Engine's public entry, `AgentEngines`, sessions start and resume on the engine their settings name, capabilities per engine, a Thread's session keeps its engine and a changed engine starts fresh; the fallback a refusing placeholder; next is step 3, the Office tools and rules over `localhost`.
- 2026-10-30 · step 3: the fallback's hook and MCP endpoints in the service under `/api/engine/claude-code-p/`, a token per session (`SessionEndpoints`), every Office tool call judged by the session's rules and ToolHold; shared Claude Code pieces in `adapters/claude-code/`; next is step 4, `ClaudeCodePEngine`.
