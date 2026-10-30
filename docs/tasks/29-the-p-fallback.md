# 29 · Running: the `-p` fallback adapter

Status: done

## Goal

A Role can work with Claude Code `-p` in place of the Agent SDK, picked in its Role card's Engine field ("Claude Code -p", as in the click-through), and does the same work there: chat, Stages, Office tools, the Office rules, exactly its skills, Stop, barge-in, resume, usage windows, as far as the engine check finds the CLI can. The fallback keeps The Office running if the SDK route stops being usable on the subscription. Spec [5.4](../spec/5.4-the-engine.md) (the port, the adapters, Defaults), [5.6](../spec/5.6-skills-per-session.md) (skills per session), [6](../spec/6-permissions-and-safety.md) (the Office rules); tickets [02](../../.scratch/the-office/issues/02-agent-engines.md), [22](../../.scratch/the-office/issues/22-skills-per-session.md) (the `-p` fallback's flags), [12](../../.scratch/the-office/issues/12-architecture.md) (the engine boundary); coverage row for task 29 in [coverage.md](coverage.md).

## Definition of Done

- [x] The engine check has runs for the fallback on Windows and on Linux: the pinned binary in `-p` with stream-json in and out; for each capability of `EngineCapabilities`, whether it holds and how; Office tools through the binary's stream (a `localhost` MCP endpoint until step 4a); the Office rules from a hook that asks the service; exactly the session's skills. Check: `npm run engine-check -- --only fallback.` on both platforms, recorded in [engine-check.md](../engine-check.md).
- [x] `ClaudeCodePEngine` passes the `AgentEngine` contract (`describeAgentEngineContract`) with the capabilities the engine check found, live under `OFFICE_ENGINE_TESTS=live`; its event mapping and its flags have unit tests. Check: the adapter's tests, live on Windows and Linux.
- [x] Sessions run on the engine their Role picks: the Engine module holds an engine per id, a session names its engine, capabilities are read per engine, a Thread resumes only on the engine its session ran on (a changed engine starts fresh). Check: service tests on two scripted engines.
- [x] The Role card's Engine field offers "Claude Code -p" with its models; a Role switched to it chats and runs a Stage with Office tools. Check: Playwright of the Role card; a live check on the Test Project with a Role on the fallback (cheapest model).
- [x] `npm run verify` and `npm run verify:linux` pass. Check: the commands.

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
- [x] 4. `ClaudeCodePEngine`, the service: spawning the pinned binary with the flags step 1 settled, the session's environment and skills folder as the SDK adapter makes them, stream-json in (messages with priority, interrupt and the other control requests) and out (the SDK adapter's event mapping, shared, not copied), the start check, ending the process tree; declared capabilities as step 1 found; the contract live. Commit.
  Read: `agent-sdk-engine.ts`, `engine-process.ts`, `sdk-events.ts`, `start-check.ts`; `ports/agent-engine.contract.ts`; [testing](../../apps/service/docs/testing.md) for live adapter tests.
- [x] 4a. The Office tools through the binary's stream (the user's choice B, 2026-10-30; spec 5.4 Defaults amended): in place of the `localhost` MCP endpoint, the fallback names the `office` server as `{type: 'sdk', name: 'office'}` in `--mcp-config`, and `ClaudeCodePEngine` answers the binary's `mcp_message` control requests from an in-process MCP server holding the session's Office tools, as the SDK adapter's `createSdkMcpServer` does; each call still asked of the Office rules and the ToolHold (`toolDecision`). Remove the MCP endpoint (`SessionEndpointsController.mcp`, `MCP_ROUTE`, `mcpUrl`, `officeToolServer` in the controller, `EndpointSession.officeTools`/`decide` if nothing else needs them, their tests), keep the hook endpoint and its token. In `tools/engine-check`: switch `claude-code-p/arguments.ts` and `claude-code-p-session.ts` to the same route and re-run `fallback.start`, `fallback.tools-and-rules` and `fallback.priority-next` on Windows and Linux, plus a check that a `next` message sent as an Office tool answers lands in the running turn (the Windows finding); record them in engine-check.md. Then the live contract passes 10 of 10 on Windows and on Linux; tick step 4 with this one. Commit.
  Read: the State; `adapters/claude-code-p/stream-json.ts` (`refuse`, `read`), `claude-code-p-arguments.ts` (`officeToolServer`), `adapters/http/session-endpoints.controller.ts`; the SDK's handling by grep in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` (`mcp_message`, `sdkMcpServers`).
- [x] 5. The Role card, the web: the Engine field offering "Claude Code -p" (`ENGINE_LABELS`), the models following the engine; Playwright. Commit.
  Read: `apps/web/src/shell/role-card-words.ts`; the Role card editor in `surfaces/people/`, by its map.
- [x] 6. The live check on the Test Project with a Role on the fallback; `npm run verify` and `npm run verify:linux`; close the task. Commit.
  Read: [the Test Project](test-project.md); [testing](../../apps/service/docs/testing.md) for a live check.

## State

- Done 2026-10-30. A Role works with Claude Code `-p` when its Role card's Engine field says so: `ClaudeCodePEngine` (`apps/service/src/modules/engine/adapters/claude-code-p/`) runs the pinned binary over stream-json, its Office tools in-process through the binary's stream (`mcp_message`), the Office rules through the hook endpoint on `localhost` with a token per session; sessions start and resume on their Role's engine (`AgentEngines`, `EngineSessions`), a changed engine starts fresh ("engine changed").
- Checked: the engine check's `fallback.*` on Windows and Linux; the live contract 10/10 on both; task 12's Test Project check with `OFFICE_CHECK_ENGINE=claude-code-p` (the Planner planned, the Developer implemented with the Office tools, one command refused by the rules, the handover note through an Office tool, `npm test` passed, `main` untouched). Its last assertion, the Test Project's folder clean, failed only on the user's own uncommitted work there (19 files changed 01:00–07:24, before the run), not the Agent's.
- `fallback.start` records only that the usage query answers: before any turn its windows follow the account's state (none named on Linux on 2026-10-30).
- Left: `--append-system-prompt-file` and the `Skill(...)` rules were not run live with skills (the checks hire with no skills); the conversations module's task 09 chat check no longer builds its Nest module (`ThreadRunner` needs `StageThreads` since), found here, not fixed.
- Decided with the user on 2026-10-30: start at login dropped for now; the fallback at parity with the SDK adapter, per Role, the pinned binary and the same models; "engine changed"; Office tools through the binary's stream; the token reaching an Agent's commands accepted, the rules asked on every Office tool call; `--plugin-dir`.

## Progress

The log is archived in [archive/29-the-p-fallback.md](archive/29-the-p-fallback.md).
