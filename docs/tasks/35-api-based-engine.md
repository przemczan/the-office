# 35 · The OpenAI-compatible API engine, for local LLMs

Status: in progress

## Goal

Any Role can work on a model served on the OpenAI-compatible API, such as a local LLM: The Office runs the agent loop itself, and a session on it can do what a session on the Agent SDK does. Replies stream. Each tool call runs only once the Office rules have judged it. Commands also run in the background. The web is searched and fetched, and skills are listed and loaded. The Context policy holds. The user lists the API endpoints and a search endpoint Office-wide in Settings → Engines, and a Role picks the engine and, in its Model field, an API endpoint and one of its models. The Office refuses only what the engine cannot do.

## Definition of Done

- [ ] The user lists the API endpoints Office-wide (name, base URL, a key never sent back, empty for a local server, models with their context windows) and sets the search endpoint (SearXNG). The Role card's and the Stage editor's Model field offers each API endpoint's models from the service. Check: service tests of the settings and of the card's validation; an e2e test of Settings → Engines and the card's Engine and Model fields.
- [ ] The engine keeps the `AgentEngine` contract against a fake OpenAI-compatible server that streams: a reply, Office tools, a refusal, barge-in, later, interrupt (a running command ended with it), resume, output schema and context usage. It declares usage windows missing and refuses them. Check: `describeAgentEngineContract` on the fake server in `npm run verify`.
- [ ] Every tool call (Read, Grep, Glob, Edit, Write, the shells, WebFetch, WebSearch, Skill, TaskStop) is judged before it runs by the same Office rules as the Claude Code engines (profile, git, secrets, protected paths, the read fence, ToolHold). A refusal shows as `tool-refused` in the rules' words. Check: adapter tests of each rule through the loop; `npm run verify` and `npm run verify:linux`.
- [ ] A command runs in the background as on the SDK: it starts, its output can be read, and TaskStop stops it. It ends on Stop and when the session ends. Check: adapter tests on both systems (`npm run verify:linux`).
- [ ] WebSearch goes through the search endpoint's port, and SearXNG is the one adapter built. Check: adapter tests against a fake SearXNG.
- [ ] A session lists exactly its skills or doesn't start (`SessionSkillsDiffer`), and loads a skill by its name. It resumes from the conversation it kept. Near the context limit it hands over as the Context policy says, with no automatic compaction. Check: adapter tests; a Conversations test of a resume and of a fresh start on this engine.
- [ ] Seen once live on Strata (Windows only): the contract's cheapest scenarios, then a Role on this engine answering in chat and running a Stage on the Test Project (a read, an edit, a command, an Office tool, a refusal). Check: the runs summarised in State and recorded in [engine-check.md](../engine-check.md).

## Read first

- [Spec §5.4](../spec/5.4-the-engine.md), its Defaults line on this engine: what this task builds.
- The [engine map](../../apps/service/src/modules/engine/MAP.md): the port, the capabilities, what the Claude Code adapters share in `adapters/claude-code/`.
- [Spec §6](../spec/6-permissions-and-safety.md): the rules the loop enforces itself.

Leave out: usage windows (a local server has none) and cost (a turn reports `0`); search providers other than SearXNG; MCP servers (task 36); usage estimates (task 37); trimming the tool set per Role; sub-agents (`Task`/`Agent`), Monitor, NotebookEdit, cron, worktree and messaging tools; images in or out; an API endpoint per Project; a Linux live run; the phone.

Decided with the user on 2026-10-31:

- The engine, as spec §8 says: The Office's own agent loop on the OpenAI-compatible API. It runs each tool call itself after the Office rules judge it, lists and loads skills, and keeps the Context policy. Its endpoints and models are set Office-wide, and any Role may pick it, refused only what the engine cannot do.
- One engine id. The Role card's Model field picks an API endpoint and one of its models.
- The words: "OpenAI-compatible API" for the engine, "API endpoint" for what Settings → Engines lists, and "Search endpoint" for the web search it goes through (all three in the glossary).
- An API endpoint's key is kept in the database and never sent back; it stays empty for a local server.
- WebFetch and WebSearch are both built. WebSearch goes through a search endpoint set in Settings, SearXNG's JSON API (self-hosted, no key), behind a port so other providers can be added later. Only SearXNG is built.
- Full parity with the SDK adapter's sessions: replies stream, and commands run in the background (started, their output read, stopped; ended on Stop and at the session's end).
- Spec §5.4 holds these as a Defaults line, accepted 2026-10-31.
- The live check runs on the user's "Strata" at `http://127.0.0.1:8080/v1`, which is slow: a few small requests, one at a time, with generous timeouts, and the cheapest scenario that proves the point. Windows only.

## Steps

- [x] 0. Write this file; settle the open questions with the user; spec §5.4's Defaults line, the glossary's terms, `coverage.md`'s row; link it from the README. Commit.
- [ ] 1. The Office-wide settings in the Engine module: the API endpoints and the search endpoint, in a Postgres table, with `GET`/`PUT /api/settings/engines` and its contract. An application service answers each engine's models: the static list for the Claude Code engines, the API endpoints' models for this one. People's card validation and `cardOptions` ask it instead of `ENGINE_MODELS`. No engine id yet. Commit.
  Read: `engine/domain/engines.ts`; `engine/index.ts`; `engine/engine.module.ts`; `people/domain/role-card.ts` (`roleCardProblems`, l. 71–98); `people/application/role-service.ts` (`cardOptions`, l. 152–162); the precedent `conversations/adapters/http/size-threshold.controller.ts`, `conversations/application/context-policy-settings.ts`, `conversations/adapters/postgres/postgres-conversations-settings.ts`; `packages/contracts/src/people.ts` (`engineSchema`, l. 5; the card options, l. 125); `apps/service/drizzle/` (the latest migration, `0048_*`); the module template on adding a table.
- [ ] 2. The client: a chat-completions client for the OpenAI-compatible API that streams (server-sent events: text, tool-call deltas assembled into whole calls, the final usage) and can be aborted. It comes with a fake server fixture that replays scripted streamed answers and records each request. Commit.
  Read: the State; `engine/ports/session-events.ts`; `platform/http/` (`platform/MAP.md`, l. 45–53) for an HTTP client already in use.
- [ ] 3. The loop's core. Add the engine id (`ENGINES`, `engineSchema`, `AgentEngines`, `ScriptedEngineModule`, `ENGINE_LABELS`, the tests that build the record) and the adapter `adapters/openai-compatible-api/`: the session loop over the client (streamed text, tool calls and their results, a turn's tokens, the turn's end), and the file tools under Claude Code's names and inputs (Read, Grep, Glob, Edit, Write), each judged by `toolDecision` with the session's Office rules before it runs. What both kinds of adapter share moves out of `adapters/claude-code/`. Capabilities not built yet are declared false. Commit.
  Read: `engine/ports/agent-engine.ts`, `engine-session.ts`, `session-options.ts`; `adapters/claude-code/office-rules-hook.ts` (`toolDecision`), `tool-actions.ts` (`agentAction`), `session-office-rules.ts`; `adapters/claude-code-p/claude-code-p-engine.ts` (l. 48–110, how an adapter is laid out); `scripted-engine.module.ts` (l. 37); `application/engine-sessions.test.ts` (l. 100–105, 300–365); `apps/web/src/shell/role-card-words.ts` (`ENGINE_LABELS`, l. 49).
- [ ] 4. A turn's control. The shells (Bash; PowerShell on Windows) run in the foreground through the platform's `Shell`. Interrupt aborts the stream and ends each command's process tree with `ProcessTrees`. Also barge-in (`next` between tool calls, `later` after the turn), ToolHold, Office tools from `SessionOptions.officeTools` judged again as they run, and a turn's output held to its schema through a final `StructuredOutput` tool the loop validates. The contract, barge-in and interrupt included, passes on the fake server. Commit.
  Read: `platform/os/shell.ts`, `process-trees.ts`; `engine/ports/office-tool.ts`; `adapters/claude-code-p/office-tool-server.ts`; `ports/agent-engine.contract.ts` (l. 24–75); `adapters/claude-code-p/claude-code-p-engine.test.ts`.
- [ ] 5. Background commands, as the SDK's sessions run them. `run_in_background` on a shell call answers with the command's id and its output file, which sits in a folder of the session's own that its rules let it read. TaskStop stops a command. Each one ends on interrupt and at the session's end. Commit.
  Read: the State; `adapters/claude-code/engine-task-folder.ts` (how the SDK names its output folder, and the rules' readable folders in `session-office-rules.ts`); `platform/os/process-trees.ts`; [engine-check.md](../engine-check.md) by grep for `background`.
- [ ] 6. The web tools: WebFetch, the page fetched and turned into text; WebSearch through the search endpoint's port, with a SearXNG adapter (`/search?format=json`) and a fake SearXNG for tests; both judged as `web` by the profile. With no search endpoint set, WebSearch is refused with words that say so. Commit.
  Read: the State; `engine/domain/agent-action.ts`; `domain/office-rules.ts` (the `web` case, by grep); step 1's settings service.
- [ ] 7. Skills and the Context policy. The session's listing comes from `SessionSkills.folder` and the Project's skills at the worktree's top, checked with `listingProblems` before the first turn, and the `Skill` tool loads one by name. The conversation is kept under `<office-data>/sessions/<id>/` so the session resumes, and is removed with the skills folder. `readContextUsage` gives the last request's tokens against the model's context window. Commit.
  Read: [spec §5.6](../spec/5.6-skills-per-session.md), [§2.5](../spec/2.5-context-policy.md); `engine/domain/skill-listing.ts`; `skills/application/session-skills.ts` (the folder's layout and removal), `project-skills.ts`; `conversations/application/thread-runner.ts` (l. 395–460, 515–530) and `stage-threads.ts` (l. 355–365, 570–610).
- [ ] 8. Settings → Engines in the web: the API endpoints and their models, the key shown only as set or not set, and the search endpoint, with Save and Discard. The Role card's and the Stage editor's Model field offers each API endpoint's models, and the card names what the engine can't do. Commit.
  Read: `apps/web/src/surfaces/settings/MAP.md`, `settings-page.tsx` (`SECTIONS`); `office-limits/office-limits-section.tsx`; `apps/web/src/surfaces/people/role-card-form.tsx` (l. 330–360); `apps/web/src/shell/pipelines/stage-editor.tsx` (l. 405–415); `apps/web/e2e/MAP.md`.
- [ ] 9. The live check on Strata, gently: the contract's cheapest scenarios with `OFFICE_ENGINE_TESTS=live`, one at a time, then a Role on this engine on the Test Project, in chat and through one Stage. Record the runs in engine-check.md; close the task. Commit.
  Read: [the Test Project](test-project.md); [testing](../../apps/service/docs/testing.md) (live checks); `docs/engine-check.md` (`## Runs`, l. 24–37).

## State

- Step 0 done: the decisions above, spec §5.4's Defaults line, the glossary's three terms, `coverage.md`'s row. Nothing is built yet; step 1 is next.
- How the Model field holds an API endpoint and a model is step 1's to choose. `SessionOptions.model` and the card's `model` are one string today, and a model id may itself hold `/` or `:`. The simplest choice is an endpoint id with its own separator, split once.
- `ENGINE_MODELS` is a static list read by synchronous domain code (`roleCardProblems`), so the models move behind an application service (step 1); the web reads them from the card options (`role-card-form.tsx`, `stage-editor.tsx`).
- Every Agent Stage asks for an output schema (`STAGE_RESULT_SCHEMA`), so `outputSchema` must be true. Conversations read context usage and resume with no capability check.
- Mirroring the Claude Code engines' tool names and inputs lets `agentAction`, `toolDecision` and the Office rules judge the loop's calls unchanged. TaskStop and Skill already count as `engine` actions there.
- On a local server the Context policy's "cache warm" (under an hour) means little; resume stays the warm path whatever the label says.
- Strata, at `http://127.0.0.1:8080/v1`, answers `/v1/models` with `qwen3.8-flash-next-coder-iq1_m` and a 100k context. It is the user's and it is slow: tests never reach it; the live check sends few, small requests, one at a time.

## Progress

- 2026-10-31 · step 0: the task file, with the user's answers (one engine id, the words, the key, SearXNG, streaming and background commands, Strata), spec §5.4's Defaults line, the glossary, coverage; next is step 1, the Office-wide settings.
