# 47 · Engines as a list

Status: in progress

## Goal

The user lists the engines The Office works on in Settings › Engines. Each Claude Code account is an engine of its own, with its own config folder and a "Sign in" button; the `-p` fallback is a switch on it. Each API endpoint of the OpenAI-compatible API is an engine too. Every engine has a default model.

The engine and model a session runs on come from the engine cascade, the most specific level winning: the Office default, the Project default, the Role override (Office-wide, on the Role card), the Project's Role override. A Project can force its default on every Role in it ("Use for every Role"), which skips the Role overrides but not its own. A Stage keeps only its effort, session and budget. The Role card shows the engine that applies and where it comes from.

Caps and usage are kept per engine. Removing an engine moves everything that names it to a replacement the user picks.

## Definition of Done

- [ ] Engines are rows: each has an id (made from its name when added, kept on a rename), a name, a kind (Claude Code or OpenAI-compatible API) and a default model. A Claude Code engine also has the `-p` switch (off by default). An OpenAI-compatible API engine also has the endpoint's base URL, key and models. The upgrade turns today's setup into these rows. Check: Engine domain and Postgres tests; the migration run on a copy of the workstation's database.
- [ ] Each Claude Code engine's sessions run with `CLAUDE_CONFIG_DIR` set to the engine's own folder in the Office data directory, on both adapters. A session resumes only on the engine that started it. "Sign in" runs the pinned binary's `claude auth login` for that folder. The card shows the email and plan that `claude auth status` gives, or "Signed out". Agents can't read any engine's folder. Check: adapter tests of the environment; a test of the status parsing; office-rules tests of the folders; `npm run verify:linux`.
- [ ] Settings › Engines lists the engines, with Add, rename, Sign in and the `-p` switch for Claude Code, the endpoint fields for API engines, a default model, the Office default, the search endpoint and the Model prices. Check: e2e test.
- [ ] Model prices: one price per Claude model, shared by every Claude Code engine; one per engine and model on API engines. A removed engine's prices are kept, so its history stays priced. Check: Engine tests; e2e test of the prices card.
- [ ] Caps are per engine: Window caps on each Claude Code engine, and Daily caps on every engine, each API engine included. Day usage, window readings, samples and ratios are kept by engine id. Check: Work and Engine tests; the migration; e2e test of Settings › Office limits.
- [ ] The engine cascade resolves the engine and model for a Role in a Project, or in no Project (the Office levels only). It applies to every session: Threads, Stage runs, Consultations, the Planner, Devops and the Office Manager. The Usage estimate uses it per Stage. Check: a domain test of every level and the force; Conversations and Pipelines tests that a session starts on the engine the cascade gives.
- [ ] Every level names an engine and a model. Picking an engine fills in its default model. If a save at any level would leave some Role on an engine that fails the Role card's capability check, the save is refused and the refusal names those Roles and Projects. Check: People, Projects and Engine service tests.
- [ ] A Stage has no model of its own. The contract and the Planner's Proposal tools drop it, and saved Stage models are dropped. Check: Pipelines tests; the migration; the contract's schemas.
- [ ] The Role card's Engine and Model offer "Office default" (no override) or an engine with one of its models. The card says which engine and model apply and where that comes from, and lists the Projects where something else applies. Check: e2e test.
- [ ] The Project page's Engine block sets the Project default, "Use for every Role", and the Project's Role overrides. Check: e2e test.
- [ ] Removing an engine asks for a replacement, the default suggested. Every reference moves to the replacement: the Office default, Project defaults, Role overrides and Projects' Role overrides. When the replacement doesn't offer a model a reference named, that reference takes the replacement's default model. When the removed engine was the only one, the references move to none and nothing runs until an engine is added; starting a session is refused with words. A running session finishes on the old engine, and its Thread starts fresh on its next message. Stage runs keep the name of the engine they ran on. Check: service tests; e2e test of the remove dialog.
- [ ] Seen live on the Test Project with two Claude accounts signed in as two engines, on Haiku. Check: the run summarised in State, covering:
  - both sign-ins and their status;
  - a Stage on each engine, as the cascade gives it, Project force included;
  - each engine's windows read on its own;
  - the removal of one engine moving its references;
  - the engine check's `skills.user-scope` re-run under an engine's own folder.

## Read first

- [Spec §5.4](../spec/5.4-the-engine.md): the Defaults "Engines are a list" and "The engine cascade"; [§2.2](../spec/2.2-people.md): the Role card and Limits; [§8](../spec/8-open-questions-and-risks.md): Tier 3's engines.
- The [engine map](../../apps/service/src/modules/engine/MAP.md), and the map of each module the step changes.
- The glossary's Engine, Office default, Project default and Role override.

Leave out:
- The Codex engine and other engine kinds.
- A model per Stage, and engine picks per Thread or per Task.
- Switching to another account by itself when a cap is reached.
- Sign-in by API key (the `--console` login) and SSO options.
- The phone.

The click-through has no screens for these. The nearest are the Role card's "Works with" row and its Engine and Model fields (`people.js`, l. 41 and 303–304) and the Stage editor's Model field (`pipelines.js`, l. 93), which goes. New screens follow Settings › Engines' existing cards and the Project page's blocks.

Decided with the user on 2026-11-01 and 2026-11-02:
- One engine per Claude account, each in its own config folder, `<office-data>/engines/<engine id>/`, the first included. At the upgrade the first Claude Code engine is signed in once, and existing Threads start fresh, since their transcripts stay in `~/.claude`.
- "Sign in" runs `claude auth login` for the engine's folder. The browser opens, and the card shows the email and plan. Step 1e confirms this works under the service.
- The `-p` fallback is a switch on each Claude Code engine. Roles on `-p` today move to the first Claude Code engine with the switch off.
- Each API endpoint is an engine. Caps are per engine: Window caps on each Claude Code engine, Daily caps on every engine. Existing caps go to the first engine of each kind; the OpenAI-compatible API's set is copied to each API engine.
- Model prices: one per Claude model across the Claude Code engines; one per engine and model on API engines. A removed engine's history stays priced.
- The upgrade clears every Role's engine and model, and every saved Stage's model. Everything runs on the Office default, which is the first Claude Code engine on its default model, Sonnet (`claude-sonnet-5-5`).
- The Office default is set in Settings › Engines. The Project page has a new Engine block: the Project default, "Use for every Role", and the Project's Role overrides.
- The live check signs in the user's two Claude accounts, the user at the browser once.

Defaults, accepted by the user on 2026-11-02:
- Every session follows the cascade. Onboarding a Project that doesn't exist yet uses the Office levels.
- A changed engine starts the Thread fresh, by the existing `engine-changed` move. A changed model alone resumes.
- When a replacement engine doesn't offer a model a reference named, the reference takes its default model.
- A save at any level that fails some Role's capability check is refused, naming those Roles.
- The `claude-code` rows go to the first Claude Code engine, which keeps the id `claude-code`. API models named `endpoint/model` split into an engine (the endpoint's id) and a model.

Chosen while writing, for the user to review:
- Engine owns the engines and the Office default. People owns the Role override and resolves the cascade (`EngineCascade`), reading the Office default through its port to Engine and the Project levels through a port to Projects. Projects owns the Project default, the force and the Project's Role overrides. No new module.
- A Role override and a Project's Role override name an engine and a model together, or nothing. "Office default" on the Role card means no override.
- The Role card's line shows what applies outside any Project. Projects where something else applies are listed under it, each with its level.
- Stage runs keep the engine's id and its name at the time of the run.
- The engine down Notification names the engine.
- An engine's folder lies in the Office data directory, which the secrets refusal already covers, so no new secret path is needed. The user's own `~/.claude` credentials stay refused.

## Steps

- [x] 0. Write this file; settle the open questions with the user; amend spec §2.1, §2.2, §2.3, §3, §4, §5.4, §5.6, §6 and §8 and `engine-check.md`; add the glossary's Engine, Office default, Project default and Role override, and amend Window cap, Daily cap, Model price, OpenAI-compatible API, API endpoint, Role and Role card; refine `coverage.md`'s row; link from the README. Commit.
Every step leaves `npm run verify` passing. A service step that changes a contract the web reads also changes the web, just enough for typecheck and e2e to stay green. The full UI comes in the web steps, and the sizes below count those small web fixes.

- [x] 1a. Engine ids as strings, behaviour unchanged, in the contracts, the service and the web, about 80k:
  - `engineIdSchema` becomes a string id. `engineIdHasUsageWindows` and `hasUsageWindows` take the string and still answer by id until 1b gives engines a kind. The ids stay `claude-code` and `openai-compatible-api` for now.
  - Every importer is retyped: Engine, Work (`usage-settings.ts`, `cap-waits.ts`, `usage-estimate.ts`, `daily-caps.ts`, `starts-since-reading.ts`, the ports), Pipelines' `usage-history.ts`, Conversations' `task-tokens.ts`, `apps/service/test/live-check.ts`, and the web's `engine-words.ts`, `role-card-words.ts`, `model-prices-card.tsx` and `usage-settings-draft.ts`.
  - The caps check in `work.ts` goes over the engines the settings list, not `engineIdSchema.options`.
  - Commit.

  Read: the State; `packages/contracts/src/engines.ts`; `packages/contracts/src/work.ts` l. 480–520; `engine/domain/engines.ts`; each importer by grep (`engineIdOf|EngineId\b|engineIdSchema|ENGINE_IDS`), by range.
- [x] 1b. Engines as rows, in Engine, about 100k:
  - An `engines` table: id, name, kind, default model, the `-p` switch, and for an API engine its endpoint (`api_endpoints` folded in).
  - The migration does the following:
    - creates the first Claude Code engine, `claude-code`;
    - turns each API endpoint into an engine with its id;
    - re-keys `model_prices` (Claude models by model; API ones by engine and model);
    - re-keys `engine_day_usage` and `usage_window_samples` (the `openai-compatible-api` rows split by the endpoint in the model name).
  - `AgentEngines` picks the adapter by kind, or `-p` when the switch is on. `EngineModels` is per engine id. `ENGINES`, `engineIdOf` and `ENGINE_IDS` go. `GET`/`PUT /settings/engines` keep their shape for now.
  - Commit.

  Read: the State; `engine/MAP.md`; `engine/domain/engines.ts`, `engine-settings.ts`, `model-prices.ts`, `api-endpoints.ts`; `engine/application/engine-models.ts`, `agent-engines.ts`, `engine-settings-service.ts`; `engine/adapters/postgres/engine-settings.schema.ts`, `postgres-engine-settings.ts`; the latest migration in `apps/service/drizzle/`.
- [x] 1c. Settings › Engines' API, in Engine and the contracts, about 80k (split from the old 1c, which 1b's 260k showed too big for one step):
  - `GET`/`PUT /settings/engines` carry the engines (Add, rename, default model, the `-p` switch, an API engine's endpoint) and the Office default. The API endpoints' old fields go. Model prices are keyed by engine id, null for the Claude models.
  - Minimal web fixes in `settings/engines/`.
  - Commit.

  Read: the State; `engine/adapters/http/engine-settings.controller.ts`; `engine/domain/engine-settings.ts`; `packages/contracts/src/engines.ts`; `apps/web/src/surfaces/settings/MAP.md` (Engines).
- [x] 1c2. Sessions run on an engine id, in Engine, with Conversations' and Pipelines' callers, about 70k (the old 1c2 split in two: the Role card's contract can't change without the web, so the seam is inside-out):
  - `SessionSettings` names an engine id and the model by its id there (`EngineModel`), not a `RoleEngine`. `EngineSessions` finds the listed engine and its adapter by kind and the `-p` switch (`AgentEngines.of(engine)`); an engine id not listed is refused (`EngineNotListed`), not the engine down. `capabilitiesOf` and `readUsageWindows` go by engine id.
  - The adapters stay keyed by the way they run a session (`EngineAdapter`: `agent-sdk`, `claude-code-p`, `openai-compatible-api`), in `AgentEngines` and `ScriptedEngineModule`. A Role card on `-p` now runs on the Agent SDK, as the upgrade decided; the switch is the engine's.
  - Conversations turn the card's engine and model into an engine id where it builds a session's settings (`engineModelOf`); Threads keep the card's engine until 1c3.
  - Commit.

  Read: the State; `engine/application/engine-sessions.ts`, `agent-engines.ts`; `scripted-engine.module.ts`; `conversations/application/stage-threads.ts` and `thread-runner.ts` (`settingsOf`).
- [ ] 1c3. The Role card's engine as an engine id, and the rest of 1b's bridges removed, in People, Conversations, Work, Pipelines, the contracts and the web, about 120k:
  - The Role card's `engine` names an engine id, and its Model field drops the `endpoint/` prefix. The migration maps both Claude Code kinds to `claude-code` and splits API models, on Role cards and on stored Threads (a Thread's session keeps no model, so an API one takes its Role card's endpoint, or starts fresh). 2b replaces this with clearing.
  - Remove the bridges: `ROLE_ENGINES`, `RoleEngine` and `engineModelOf` (`engine/domain/engines.ts`); `AgentEngines.named`; `EngineSessions.missingCapabilitiesOf(RoleEngine)`; `EngineModels.offeredBy`, `byEngine` and `modelsOn` (per engine id instead); contracts' `roleEngineSchema`, `parseApiEndpointModel` and `apiEndpointModel` once nothing names `endpoint/model`. Stage runs keep the card's engine until 1d, so `usage-history.ts` prices both a `RoleEngine` and an engine id until then.
  - Lift `claudeCodeEngineProblems`' refusal of a removed `claude-code` only if nothing still names it by kind (its second-engine refusal stays until 1d and 1e).
  - Minimal web fixes: the Role card form and words (`role-card-words.ts`, `engine-words.ts`' `modelLabel`), `proposal-card.tsx`, `role-card-view.tsx`, `stage-editor.tsx`, `people.e2e.ts`' engine select.
  - Commit.

  Read: the State; `people/MAP.md`; `packages/contracts/src/people.ts` (`roleCardSchema`); `people/application/role-service.ts` (the `offeredBy` calls); each `RoleEngine` site by grep (`RoleEngine|engineModelOf|ROLE_ENGINES`), by range.
- [ ] 1d. Caps per engine, and Stage runs keep the engine's name, in Work and Pipelines, about 80k:
  - `engine_caps` is keyed by engine id (done in 1b, migration included). What is left: the contract's `engineIdHasUsageWindows` still answers by id, so a second Claude Code engine's Window caps would be refused; answer by the engine's kind.
  - `stage_runs` keeps the engine id and its name at the time of the run. The migration fills in `claude-code` for both Claude Code kinds and the endpoint's id for API runs.
  - Minimal web fix in Office limits.
  - Commit.

  Read: the State; `work/MAP.md` (usage estimates part); `work/domain/usage-settings.ts`, `cap-waits.ts`; `work/adapters/postgres/work-settings.schema.ts`; `pipelines/adapters/postgres/stage-runs.schema.ts`, `postgres-stage-run-repository.ts` l. 85–100; `pipelines/application/agent-stage-runner.ts` (where it records the engine).
- [ ] 1e. Each Claude Code engine's account, in Engine, Notifications and the platform layer, about 100k:
  - Both Claude Code adapters set `CLAUDE_CONFIG_DIR` to `<office-data>/engines/<id>/`, on start and on resume. The folder is made when the engine is added and removed with it.
  - `POST /settings/engines/:id/sign-in` runs the pinned binary's `auth login` with that folder. `GET …/account` gives what `auth status --json` gives: signed in, email, plan. An event announces the change.
  - Try the sign-in by hand first: does the login open the browser and finish with no TTY under the service, on Windows and on Linux? Log what you find.
  - `EngineDown` carries the engine's id and name, and the Notification names the engine.
  - Office-rules tests show an engine's folder refused like the rest of the Office data.
  - Check that background-command output and the hook's read allowance (`engineTemporaryFolder`) still match under a moved config folder.
  - `npm run verify:linux`. Commit.

  Read: the State; `engine/adapters/claude-code/session-settings.ts` (`sessionEnvironment`); `engine/adapters/agent-sdk/sdk-options.ts`; `engine/adapters/claude-code-p/claude-code-p-arguments.ts`, `pinned-binary.ts`; `engine/domain/engine-events.ts`; `notifications/domain/notification.ts` (grep `office.down.engine`); `platform/MAP.md` (data directory, `secretPaths`, `engineTemporaryFolder`); `engine/domain/secret-paths.ts`.
- [ ] 1f. Web, Settings › Engines, about 100k:
  - The engines list: Add (Claude Code or API endpoint), rename, Sign in with the account's status, the `-p` switch, the default model.
  - The Office default, the search endpoint, and the prices card keyed as decided.
  - e2e tests. Commit.

  Read: the State; `apps/web/src/surfaces/settings/MAP.md` (Engines); `settings/engines/engines-section.tsx`, `engine-settings-draft.ts`, `model-prices-card.tsx`; `apps/web/e2e/MAP.md`.
- [ ] 1g. Web, the engines by name everywhere else, about 80k:
  - Office limits sets the caps per engine.
  - Now and the status strip show each Claude Code engine's windows, by name.
  - The Usage estimate words name the user's engines.
  - The Role card's Engine select lists the engines.
  - e2e tests. Commit.

  Read: the State; `settings/office-limits/usage-card.tsx`, `usage-settings-draft.ts`; `apps/web/src/shell/status-strip.tsx`; `surfaces/now/now-page.tsx` (grep `usageWindows`); `shell/work/usage-estimate-words.ts`; `shell/engine-words.ts`; `apps/web/e2e/MAP.md`.
- [ ] 2a. The Project levels, in Projects and the contracts, about 70k:
  - Projects keeps the Project default, "Use for every Role" and the Project's Role overrides (engine id and model, or none), with `GET`/`PUT` on the Project, and gives them through an exported service.
  - A minimal web fix if the Project contract changes.
  - Commit.

  Read: the State; `projects/MAP.md`; the Projects application service and schema, by symbol; `packages/contracts/src/projects.ts`.
- [ ] 2b. The engine cascade and the Role override, in People and Engine, about 120k:
  - The Role card's engine and model become an optional Role override. The migration clears every one, and presets carry none.
  - `EngineCascade.of(roleKey, projectId?)` gives the engine, the model and the level each came from. It reads the Office default through a port to Engine and the Project levels through a port to Projects.
  - The capability check runs at every level, Office default and Project saves included. A refusal names the Roles and Projects.
  - Minimal Role card form fix.
  - Commit.

  Read: the State; `people/MAP.md`; `people/application/role-service.ts` (the card checks, by symbol); `people/domain/presets.ts`; `packages/contracts/src/people.ts`; the [module template](../../apps/service/docs/module-template.md), on ports to another module.
- [ ] 2c. Sessions on the cascade, and no Stage model, in Conversations, Pipelines and Work, about 110k:
  - `thread-runner.ts`, `stage-threads.ts`, `thread-contexts.ts` and `thread-changes.ts` take the engine and model from `EngineCascade`, with the Thread's Project.
  - The Stage's `model` is dropped from the contract, the Planner's Proposal tools and saved Stage lists (a migration).
  - `usage-estimate.ts` uses the cascade per Stage.
  - Minimal Stage editor fix.
  - Commit.

  Read: the State; `conversations/MAP.md`; the `.engine` uses in those files (grep); `pipelines/MAP.md`; `packages/contracts/src/stages.ts` (`stageSchema`); `work/domain/usage-estimate.ts` l. 60–75.
- [ ] 2d. Web, the Role card, the Project page's Engine block and the Stage editor, about 110k:
  - The Role card's override, with "Office default", and what applies and from where, per Project.
  - The Project page's Engine block.
  - The Stage editor and the Task's Stage list without Model.
  - e2e tests. Commit.

  Read: the State; `apps/web/src/surfaces/people/MAP.md`, `projects/MAP.md`; `apps/web/src/shell/role-card-words.ts`; the Stage editor (grep `model` in `surfaces/projects` and `surfaces/work`); `apps/web/e2e/MAP.md`.
- [ ] 3a. Removing an engine, in Engine, People and Projects, about 90k:
  - `DELETE /settings/engines/:id` with a replacement id, or none when it is the only engine. It moves every reference, falls back to the replacement's default model, and refuses a replacement that fails the capability check.
  - With no engine, starting a session is refused with words.
  - Running sessions finish, and their Threads start fresh.
  - Commit.

  Read: the State; `engine/application/engine-settings-service.ts`; `engine/application/engine-sessions.ts` (start, by symbol); the cascade from 2b; `conversations/domain/context-policy.ts` l. 120–145.
- [ ] 3b. Web, the remove dialog, about 50k: pick the replacement, list what moves, and warn when it is the only engine. e2e test. Commit.

  Read: the State; `settings/engines/engines-section.tsx`; `apps/web/e2e/MAP.md`.
- [ ] 4. The live check on the Test Project, about 60k. The user signs in two Claude accounts at the browser. Run it on Haiku, covering the Definition of Done's live points. Re-run the engine check's `skills.user-scope` under an engine's folder and update `engine-check.md`. Commit.

  Read: the State; [the Test Project](test-project.md); [testing](../../apps/service/docs/testing.md), live checks; `apps/service/test/live-check.ts`; `docs/engine-check.md` (`skills.user-scope`).
- [ ] 5. Close: tick the Definition of Done with each check run, run `npm run verify:linux`, archive the log, and set the task to done. Small.

## State

Steps 0, 1a, 1b, 1c and 1c2 are done. The old 1c2 was split again: 1c2 moved sessions onto engine ids; 1c3 does the Role card, its contract, the migration and the web.
- Engines are rows of `engines` (`engine/domain/engines.ts`: `ClaudeCodeEngine` with `claudeCodeP` | `ApiEngine`; `engineIdFor`, `offeredModels`, `hasUsageWindows(engine)`). Migrations `0075_engines.sql` and `0076_office_default.sql` (`engine_settings.office_default_engine_id`/`_model`).
- `GET`/`PUT /settings/engines` carry the engines, the Office default, the search endpoint and prices keyed by engine id (null for Claude models). `claudeCodeEngineProblems` keeps exactly one Claude Code engine, `claude-code`, until 1c3 (Role cards name it by kind), 1d and 1e.
- Sessions (1c2): `SessionSettings` is an `EngineModel` (`engineId`, bare `model`) in `engine-sessions.ts`; `listed()` finds the engine or throws `EngineNotListed` (`ports/agent-engine.ts`, before `watch`, so no engine down); `AgentEngines.of(engine)` picks the adapter by kind and the `-p` switch; adapters are keyed by `EngineAdapter` (`agent-engines.ts`, also `ScriptedEngineModule.register`). `optionsOf` hands the API adapter `apiEndpointModel(engine.id, model)` until 1e gives adapters their engine. `capabilitiesOf(engineId)` is async; `readUsageWindows({ engineId })` gives none for an unlisted engine.
- Conversations build settings with `...engineModelOf(card or session engine, model)` in `stage-threads.ts` (`settingsOf`, the interrupt's `capabilitiesOf`) and `thread-runner.ts` (`settingsOf`). Threads, `context-policy` and stage runs still keep the card's `RoleEngine`, so a card switched to `-p` still starts fresh (`engine-changed`) but now runs on the Agent SDK: deliberate, as the upgrade moves `-p` cards to the switch-off engine.
- Bridges left for 1c3: `ROLE_ENGINES`, `RoleEngine`, `engineModelOf` (`engines.ts` l. 80–107); `AgentEngines.named` and `EngineSessions.missingCapabilitiesOf(EngineAdapter)` (People's card check); `EngineModels.offeredBy`/`byEngine`/`modelsOn`; contracts' `roleEngineSchema`, `parseApiEndpointModel`, `apiEndpointModel`. Callers: `role-service.ts` l. 52, 144, 169, 181–186, 233, 256, `role-card.ts` l. 44, `presets.ts`; `threads.schema.ts` l. 33 (stored; the session keeps no model, so the migration takes an API Thread's endpoint from its Role card, or lets it start fresh), `thread.ts` l. 52, `context-policy.ts` l. 74, `thread-contexts.ts` l. 30, `thread-changes.ts` l. 263, `stage-threads.ts` l. 161, 280, 496, 613, 701, `thread-runner.ts` l. 363, 456, `task-tokens.ts` l. 36–38; `known-people.ts` l. 16, `usage-estimate.ts` l. 69–70, `usage-estimates.ts` l. 131; `usage-history.ts` l. 46–54 (stage runs keep the card's engine until 1d, so price both). Web: `role-card-words.ts` l. 50, 312, `engine-words.ts` `modelLabel`, `proposal-card.tsx` l. 344, `role-card-view.tsx` l. 39, 64, `role-card-form.tsx` l. 404–431, `stage-editor.tsx` l. 416–418, `blank-role-card.ts` l. 16, `people.e2e.ts` l. 286–330.
- Tests: `thread-runner.test.ts` lists the fake API endpoint by overriding `EngineModels` (`listing(api)`; the fixture now gives `endpoint`); `engine-sessions.test.ts` lists `claude-code`, a `-p` engine `fallback` and an API engine `lab`.
- Known gaps: `task-tokens.ts` counts an API Stage Thread on `openai-compatible-api` (1c3/2c). A removed API engine's prices are still dropped on save (3a).

The pinned binary (2.1.310) has `claude auth login` (`--claudeai` by default, `--console`, `--sso`, `--email`) and `claude auth status --json` (`loggedIn`, `email`, `subscriptionType`, `configDirectory`).

Traps:
- Between steps, `npm run verify` must pass. 1c's mapping of kinds to ids is replaced by 2b's clearing, so keep it in the migration and nowhere else.
- `windows.ts` and `linux.ts` keep `~/.claude/.credentials.json` as a secret path. Keep it.
- drizzle-kit asks about renames without a TTY: generate in two passes and merge (as 0075 was).
- Postgres tests need Docker Desktop (`C:\Docker\Docker Desktop.exe`) and `docker compose up -d postgres`.

## Progress

- 2026-11-02 · step 0: task file written with the user's answers; spec, glossary, coverage and README amended; next is 1a, engine ids as strings.
- 2026-11-02 · step 1a: engine ids are strings in the contracts, the service and the web; Work refuses caps not naming every engine id; next is 1b, engines as rows.
- 2026-11-02 · step 1b: engines are rows of `engines`, with the migration re-keying prices, day usage and caps; Role cards reach them through `engineModelOf` until 1c; next is 1c, the engines in the API and on the Role card.
- 2026-11-02 · step 1c: Settings › Engines' API carries the engines, the Office default (migration 0076) and prices keyed by engine id; the step was split, the Role card and the bridges going to 1c2; next is 1c2.
- 2026-11-02 · step 1c2: sessions run on an engine id and its adapter by kind and `-p` switch, an unlisted engine refused; the Role card part split off to 1c3; next is 1c3, the Role card's engine as an engine id.
