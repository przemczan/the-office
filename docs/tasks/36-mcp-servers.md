# 36 · MCP servers for Agents

Status: in progress

## Goal

A Role's Agents can use the tools of MCP servers the user chose for it. The user adds each server to an Office-wide library in Settings → MCP servers, reviews it before it can be used, and assigns it on the Role card. A server's Server values are set Office-wide and overridden on a Project's page. Every MCP tool has its own setting in the Role card's permission profile, starting at Consult Devops, and the Office rules judge each call before it runs, on all three engines.

## Definition of Done

- [ ] The user adds an MCP server by a form or by pasting its JSON config: a local command (stdio) or a remote URL (Streamable HTTP), with its Server values (environment variables or headers; plain or secret; required or not). Each value has an Office-wide value; a secret is never sent back. The user edits and removes servers. Check: service tests of the library, its validation and its routes; the contract's schemas.
- [ ] A server is off until reviewed: the review shows its command or URL, its values and the tools it lists on a test connection, and turning it on records that tool list. Changing the server turns it off until it is reviewed again. Check: service tests against a fake stdio MCP server and a fake HTTP one.
- [ ] A Role card assigns servers, and a Project's page overrides Server values. A session starts with its Role's servers that are on, with its Project's values (the Office-wide values in chat), fixed for the session and kept on resume. A server missing a required value is left out, and the brief says so. Check: service tests of the session's servers; a Conversations test of a Stage and a chat getting them.
- [ ] Each MCP tool has a setting in the permission profile (Allowed, Consult a person, Ask me, Never), starting at Consult Devops; a Stage narrows it, never widens it. The Office rules judge each call: Allowed runs, Consult and Ask me hold the call as a Hard switch's call is held, Never refuses in the rules' words. Check: domain tests of the profile; rule tests through `toolDecision`.
- [ ] The Agent SDK and `-p` engines run the session's servers with only the Office's MCP config (never a Project's `.mcp.json`), and the OpenAI-compatible API engine runs them through an MCP client in its loop, ending a local server's process tree at the session's end. Check: `describeAgentEngineContract`'s MCP scenario on each engine (the scripted engine, the API engine on its fake server); `npm run verify` and `npm run verify:linux`.
- [ ] The web: Settings → MCP servers (the list, add by form or JSON, review, on and off, Office-wide values); the Role card's MCP servers and each tool's setting; the Project page's Server values. Check: e2e tests of each.
- [ ] Seen once live on the Test Project with the Agent SDK engine and the cheapest model: a Role with a local MCP server calls one Allowed tool and one at Consult Devops, which waits on a Consultation and then runs. Check: the run summarised in State and recorded in [engine-check.md](../engine-check.md).

## Read first

- [Spec §5.4](../spec/5.4-the-engine.md#defaults), its Defaults line on MCP servers, and [§6](../spec/6-permissions-and-safety.md), its MCP tools line: what this task builds.
- The [skills map](../../apps/service/src/modules/skills/MAP.md): the precedent for a library reviewed before use, assigned on the Role card (`role_skills`), resolved per session and per Project.
- The [engine map](../../apps/service/src/modules/engine/MAP.md): `SessionOptions`, the Office rules in `adapters/office-rules/`, and where each adapter sets its MCP servers.

Leave out: Agents proposing MCP servers (a Devops Proposal, later); the legacy SSE transport; OAuth sign-in for remote servers (a secret header only); MCP resources, prompts and sampling (tools only); a server's tool list changing mid-session (the list is fixed at session start, so the cache holds); per-server usage counts; the phone.

Decided with the user on 2026-10-31:

- The shape spec §8 gives: an Office-wide library, each server reviewed before use, assigned on the Role card, per-Project values, every tool starting at Consult.
- All three engines run them; the OpenAI-compatible API engine gets its own MCP client, from `@modelcontextprotocol/sdk`, already a dependency.
- Each tool has its own setting, like a Hard switch, starting at Consult Devops.
- Server values: an Office-wide value with a Project override. Secrets are kept in the database and never sent back.
- The user adds servers (a form or pasted JSON); off until reviewed.
- The words: "MCP server" and "Server value" (both in the glossary).
- Step 4's questions (answered later on 2026-10-31): a Stage's narrowing is built now, as step 4b, for the whole profile; in chat, Allowed MCP tools run, Consult and Ask me are refused in the Hard switch's chat words, Never is refused; Devops's card accepts the default Consult Devops, and at runtime that Consultation goes to the user; spec §5.3 names the MCP servers module.

## Steps

- [x] 0. Write this file; settle the open questions with the user; spec §5.4's Defaults line and §6's MCP tools line, the glossary's terms, `coverage.md`'s row; link it from the README. Commit.
- [x] 1. The library in a new module `mcp-servers`: the `mcp_servers` table (name, transport, command with arguments or URL, the declared Server values with their Office-wide values, on or off), `GET`/`POST`/`PUT`/`DELETE /api/mcp-servers` with contracts, a pasted JSON config parsed into a server (the shape of Claude Code's `mcpServers` entries), validation, events. A secret's value is never sent back; an edit that changes the command, URL or values' names turns the server off. Commit.
  Read: the [module template](../../apps/service/docs/module-template.md); `skills/application/skill-library.ts` (the library's shape and events); `engine/adapters/http/` Settings › Engines' controller and `packages/contracts/src/` its schema (a key never sent back, task 35 step 1); `apps/service/drizzle/` (the latest migration).
- [x] 2. The review: an `McpClient` port with an adapter on `@modelcontextprotocol/sdk` (stdio through the platform's process spawning, so the tree ends; Streamable HTTP) that connects, lists tools and closes, with timeouts. `GET /api/mcp-servers/:name/review` connects with the Office-wide values and returns the config and the tools; `PUT …/state` turns a server on only against the reviewed tool list, which is stored. A fake stdio server and a fake HTTP server as test fixtures. Commit.
  Read: the State; `skills/adapters/http/skills.controller.ts` (`review`, `changeState`); `platform/os/` (`platform/MAP.md`) for spawning and `ProcessTrees`.
- [x] 3. Assignment and values: a Role's servers (`role_mcp_servers`, as `role_skills`, with `PUT /api/mcp-servers/:name/roles`), a Project's Server values (`project_server_values`, `GET`/`PUT` under the Project), and `SessionMcpServers`, which resolves a session's servers for a Role and a Project (or chat), records them with the session for resume, and lists what was left out for the brief. Wire it where `SessionSkills.prepare` and `rebuild` are called, into a new `SessionOptions.mcpServers`. Commit.
  Read: the State; `skills/application/role-skills.ts`, `session-skills.ts`; `conversations/application/thread-runner.ts` (l. 395–420) and `stage-threads.ts` (l. 355–420, 615–625); `engine/ports/session-options.ts`.
- [x] 4. Permissions: in People, the profile's MCP tool settings (a value per `server/tool`, as `HardSwitchValue`; a tool not on the card is Consult Devops), on the card and its validation, and a Stage's narrowing. In the Engine, an `mcp-tool` `AgentAction` for `mcp__<server>__<tool>`, judged in `toolDecision`: Allowed, a hold through `ToolHold` for Consult and Ask me, Never refused. Find how a held Hard switch works in chat and match it. Commit.
  Read: the State; `people/domain/permission-profile.ts`, `hard-switches.ts`, `role-card.ts`; the Stage's narrowing (grep `narrow` in `pipelines/domain`); `engine/domain/agent-action.ts`; `engine/adapters/office-rules/tool-decision.ts`; `engine/ports/agent-engine.ts` (`ToolHold`).
- [ ] 4b. Stage narrowing (the user, 2026-10-31: build it now): a Stage's permission settings, which narrow the Role card's profile and never widen it, for edit, run, web and each MCP tool, in the Pipeline's data, its contracts and the Stage editor, and applied where `agent-stage-runner.ts` `open` builds the session's profile. Uses step 4's order. Tests and an e2e test of the Stage editor. Commit.
  Read: the State; `pipelines/application/agent-stage-runner.ts` `open` (l. 225–273); the Pipeline's Stage schema in `pipelines/domain` and `packages/contracts/src/`; `apps/web/src/shell/pipelines/stage-editor.tsx` (by symbol); `apps/web/e2e/MAP.md`.
- [ ] 5. The Claude Code engines: `sdk-options.ts` adds the session's servers beside the Office tool server, and `claude-code-p-arguments.ts` puts them in `--mcp-config` under `--strict-mcp-config`; a Project's `.mcp.json` is never loaded (check `settingSources: ['project']`). The hook judges their tools. The scripted engine and the contract gain an MCP scenario on the fake stdio server. `npm run verify:linux`. Commit.
  Read: the State; `engine/adapters/agent-sdk/sdk-options.ts`; `engine/adapters/claude-code-p/claude-code-p-arguments.ts`, `stream-json.ts` (l. 45–125); `engine/ports/agent-engine.contract.ts`; `engine/adapters/claude-code/office-rules-hook.ts`.
- [ ] 6. The OpenAI-compatible API engine: an MCP client per session in the loop, which starts the servers before the first turn, adds their tools to the fixed tool list under `mcp__<server>__<tool>`, judges each call before it runs, and closes the servers at the session's end (a local server's process tree ended). The contract's MCP scenario on the fake chat-completions server. `npm run verify:linux`. Commit.
  Read: the State; `engine/adapters/openai-compatible-api/session-tools.ts`, `office-tool.ts`, `api-session.ts` (by symbol), `openai-compatible-api-engine.ts`; step 2's client adapter.
- [ ] 7. The web: Settings → MCP servers (a new section: the list, add by form or pasted JSON, review with the tool list, on and off, Office-wide values, secrets shown only as set or not); the Role card's MCP servers and each tool's setting (as the Hard switches); the Project page's Server values block. e2e tests. Commit.
  Read: `apps/web/src/surfaces/settings/MAP.md`, `settings-page.tsx` (`SECTIONS`), `skills/` and `engines/`; `apps/web/src/surfaces/people/MAP.md`, `role-card-form.tsx` (by symbol); `apps/web/src/surfaces/projects/skills-block.tsx`; `apps/web/e2e/MAP.md`.
- [ ] 8. The live check on the Test Project, Agent SDK engine, cheapest model: a Role with a local MCP server (a small fixture server, nothing installed) calls an Allowed tool and one at Consult Devops. Record it in engine-check.md; close the task. Commit.
  Read: [the Test Project](test-project.md); [testing](../../apps/service/docs/testing.md) (live checks); `docs/engine-check.md` (`## Runs`).

## State

- Built (steps 1–3): module `mcp-servers` (library, review, `RoleMcpServers`, `ProjectServerValues`, `SessionMcpServers` recording name, tools and `reviewDigest` per session, values read afresh on resume; migrations 0061–0063); the client in `platform/mcp/` with fake servers (`fake-mcp-servers.fixtures.ts`). `SessionOptions.mcpServers` is set by Conversations; no engine runs it yet. Those left out lead the Brief (`withLeftOutServers`).
- Step 4, People: `permissionProfile.mcpTools` (only the tools set, keyed `server/tool`; unset is `MCP_TOOL_DEFAULT`, Consult Devops) in `people/domain/mcp-tool-settings.ts` with `mcpToolSettingsProblems` (Devops's own card may consult Devops), `mcpToolSettingsFor` (a session's whole set), and the order for 4b: `noWiderThan`, `narrowedMcpToolSetting`. Migration 0064 adds `mcpTools: {}` to stored cards and Proposals. The Role response has `mcpServers` (name, on, each tool with its setting) from `RoleMcpServers.byRole/serversOf` (`McpServerOnCard`).
- Step 4, Engine: the `mcp-tool` action (`mcpToolOf` in `office-tool-names.ts`), judged in `OfficeRules.mcpToolDecision` by `profile.mcpTools` (any tool not there is not available, a Project's `.mcp.json` tools too). Never is refused there; Consult and Ask me return a refusal carrying `approval`, which `toolDecision` puts to `SessionOptions.approvalHold`.
- Decided (deviation from "through `ToolHold`"): approvals go through their own `ApprovalHold` beside `ToolHold`, so a fire-alarm hold that ignores its argument can never approve a call. Engines pass `{ toolHold, approvalHold }` (`SessionHolds`) to `toolDecision`/`officeRulesHook`.
- Conversations: `HeldCalls.holdMcpToolCall` holds a call as Change Roles' is (a Decision or Consultation, "Allow once" spent by the identical call; `mcpToolCallWords` sorts the input's keys). `ApprovalHolds` is filled by `HeldCalls` on start, since `HeldCalls` → `Consultations` → `ThreadRunner` forbids injecting it there. Chat: refused in the Hard switch's chat words. Stages: the card's settings pass through `StageSessionSettings.profile.mcpTools` unchanged until 4b.
- Tools whose `mcp__<server>__<tool>` exceeds 64 characters are left out of sessions (`sessionTools`, also the card's list) and flagged in the review as `toolsTooLong`.
- Open: later consolidation, `EngineProcess` and `ProgramStdioTransport` both spawn-and-end. The scripted engine's own `toolHold` call (l. 320) doesn't judge MCP tools yet (step 5).
- Traps for 4b: `StageSessionSettings.profile` (Conversations) differs from the engine profile in `mcpTools` (only set ones); narrow in `agent-stage-runner.ts` `open`, and `pipelines/ports/known-people.ts` already carries `mcpTools`.
- Next: step 4b, Stage narrowing.

## Progress

- 2026-10-31 · step 0: task file written, open questions settled with the user, spec, glossary, coverage and README updated; next step 1, the library.
- 2026-10-31 · step 1: module `mcp-servers` with the library (`mcp_servers`), its routes and contracts, pasted JSON configs read for the form, secrets never sent back, edits to what runs or values' names turning a server off; next step 2, the review.
- 2026-10-31 · step 2: the review: a platform MCP client (stdio through `startProgram`, tree ended on close; Streamable HTTP) with fake servers, `GET …/review` and `PUT …/state` bound to a review digest, the reviewed tools stored (0062); next step 3, assignment and values.
- 2026-10-31 · step 3: Role assignment (`role_mcp_servers`, `PUT …/roles`), Project Server values (`project_server_values`, routes on Projects), `SessionMcpServers` recording name, tools and digest per session and resolving values afresh on resume, wired into `SessionOptions.mcpServers` with those left out leading the Brief; next step 4, permissions.
- 2026-10-31 · step 4: MCP tool settings on the card (`mcpTools`, Consult Devops unset, migration 0064) and on the Role response with each server's tools; the `mcp-tool` action judged by the Office rules, Consult and Ask me held through a new `ApprovalHold` by `HeldCalls` as Change Roles is; over-long tool names left out; next step 4b, Stage narrowing.
