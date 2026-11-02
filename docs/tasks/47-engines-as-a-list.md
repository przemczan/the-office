# 47 · Engines as a list

Status: in progress

## Goal

The user lists the engines The Office works on in Settings › Engines. Each Claude Code account is an engine of its own, with its own config folder and a "Sign in" button; the `-p` fallback is a switch on it. Each API endpoint of the OpenAI-compatible API is an engine too. Every engine has a default model.

The engine and model a session runs on come from the engine cascade, the most specific level winning: the Office default, the Project default, the Role override (Office-wide, on the Role card), the Project's Role override. A Project can force its default on every Role in it ("Use for every Role"), which skips the Role overrides but not its own. A Stage keeps only its effort, session and budget. The Role card shows the engine that applies and where it comes from.

Caps and usage are kept per engine. Removing an engine moves everything that names it to a replacement the user picks.

## Definition of Done

- [ ] Engines are rows: each has an id (made from its name when added, kept on a rename), a name, a kind (Claude Code or OpenAI-compatible API) and a default model. A Claude Code engine also has the `-p` switch (off by default). An OpenAI-compatible API engine also has the endpoint's base URL, key and models. The upgrade turns today's setup into these rows. Check: Engine domain and Postgres tests; the migration run on a copy of the workstation's database.
- [ ] Each Claude Code engine's sessions run with `CLAUDE_CONFIG_DIR` set to the engine's own folder in the Office data directory, on both adapters. A session resumes only on the engine that started it. "Sign in" runs the pinned binary's `claude auth login` for that folder, giving its sign-in page and taking the code the user pastes. "Paste a token instead" writes a `claude setup-token` token into the engine's folder as its login, never sent back, in no environment, gone with the folder; "Sign out" removes the folder's login. The card shows the email and plan that `claude auth status` gives, that a pasted token signs it in, or "Signed out". Agents can't read any engine's folder. Check: adapter tests of the environment; a test of the status parsing; service tests of the token's routes and that no response holds it; adapter tests of the written login; office-rules tests of the folders; `npm run verify:linux`.
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
- On 2026-11-02, after step 1e2: Sign in stays as 1e2 built it, the sign-in page as a link and its code pasted into the engine's card. On top, "Paste a token instead": the user runs `claude setup-token` and pastes the token; The Office writes it into the engine's folder as its `.credentials.json`, in no environment (the user's later answer of 2026-11-02, after the file descriptor failed on Windows; step 1e4). "Sign out" removes that file, whatever signed the engine in.
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
- [x] 1c3. A Thread's session names its engine by id, in Conversations, about 70k (split from the old 1c3, the seam being `engineModelOf`, the one place a card meets an engine id until 1c3b):
  - `ThreadSession.engineId`, and the Context policy compares engine ids (`Continuation.engineId`). Conversations turn the card into its engine id with `engineModelOf` where a card meets a session; `settingsOf` runs on the session's engine id.
  - The migration (`0077`) maps both Claude Code kinds to `claude-code`, and an API session to the endpoint its Role card version's Model field names, if still an engine; any other session goes, so its Thread starts fresh.
  - `task-tokens.ts` counts by the session's engine id.
  - Commit.
- [x] 1c3b. The Role card's engine as an engine id, and the rest of 1b's bridges removed, in People, Conversations, Work, Pipelines, the contracts and the web, about 150k (may split again: service and contracts, then web and e2e):
  - The Role card's `engine` names an engine id, and its Model field drops the `endpoint/` prefix. The migration maps both Claude Code kinds to `claude-code` and splits API models on every `role_card_versions` row (older versions are what resumes run with), the `changes` history's `engine` and `model` entries, and open `proposals` whose `hire` or `change` carries a card's engine or model. 2b replaces this with clearing.
  - Conversations take the card's engine and model as they are where 1c3 used `engineModelOf` (`thread-contexts.ts`, `thread-runner.ts` `moveFor`/`settingsOf`, `stage-threads.ts` `cardEngineId`, `settingsOf`, the interrupt's `capabilitiesOf`); `StageThread.engine` and `StageWorkPlace.engine` become engine ids.
  - Remove the bridges: `ROLE_ENGINES`, `RoleEngine` and `engineModelOf` (`engine/domain/engines.ts`); `AgentEngines.named`; `EngineSessions.missingCapabilitiesOf(RoleEngine)`; `EngineModels.offeredBy`, `byEngine` and `modelsOn` (per engine id instead); contracts' `roleEngineSchema`, `parseApiEndpointModel` and `apiEndpointModel` once nothing names `endpoint/model`. Stage runs keep the card's engine until 1d, so `usage-history.ts` prices both a `RoleEngine` and an engine id until then.
  - Lift `claudeCodeEngineProblems`' refusal of a removed `claude-code` only if nothing still names it by kind (its second-engine refusal stays until 1d and 1e).
  - Minimal web fixes: the Role card form and words (`role-card-words.ts`, `engine-words.ts`' `modelLabel`), `proposal-card.tsx`, `role-card-view.tsx`, `stage-editor.tsx`, `people.e2e.ts`' engine select. The service's `e2e.ts` seeds and the test fixtures naming card engines (`session-role.fixtures.ts`, `proposal.fixtures.ts`, `work-ports.fixtures.ts`, `pipelines-ports.fixtures.ts`, …; grep `"agent-sdk"|"claude-code-p"`).
  - Commit.

  Read: the State; `people/MAP.md`; `packages/contracts/src/people.ts` (`roleCardSchema`); `people/application/role-service.ts` (the `offeredBy` calls); each `RoleEngine` site by grep (`RoleEngine|engineModelOf|ROLE_ENGINES`), by range.
- [x] 1d. Caps per engine, and Stage runs keep the engine's name, in Work and Pipelines, about 80k:
  - `engine_caps` is keyed by engine id (done in 1b, migration included). What is left: the contract's `engineIdHasUsageWindows` still answers by id, so a second Claude Code engine's Window caps would be refused; answer by the engine's kind.
  - `stage_runs` keeps the engine id and its name at the time of the run. The migration fills in `claude-code` for both Claude Code kinds and the endpoint's id for API runs.
  - Minimal web fix in Office limits.
  - Commit.

  Read: the State; `work/MAP.md` (usage estimates part); `work/domain/usage-settings.ts`, `cap-waits.ts`; `work/adapters/postgres/work-settings.schema.ts`; `pipelines/adapters/postgres/stage-runs.schema.ts`, `postgres-stage-run-repository.ts` l. 85–100; `pipelines/application/agent-stage-runner.ts` (where it records the engine).
- [x] 1e. Each Claude Code engine's config folder, in Engine and the platform layer, about 100k (split: sizing put the whole step well over 120k, so Sign in, the account's status and the Notification went to 1e2):
  - Both Claude Code adapters set `CLAUDE_CONFIG_DIR` to `<office-data>/engines/<id>/`, on start and on resume, the folder made when missing.
  - Every adapter is handed its engine (`SessionOptions.engine`); `apiEndpointModel` and `parseApiEndpointModel` go.
  - Existing Threads on a Claude Code engine start fresh (a migration).
  - Office-rules tests show an engine's folder refused like the rest of the Office data, by path and through the variable.
  - Check that background-command output and the hook's read allowance (`engineTemporaryFolder`) still match under a moved config folder.
  - `npm run verify:linux`. Commit.
- [x] 1e2. Each Claude Code engine's account, in Engine, about 90k (split: the code paste the login needs made the whole step over 120k, so the folders, the second engine and `EngineDown` went to 1e3):
  - `POST /settings/engines/:id/sign-in` runs the pinned binary's `auth login` with the engine's folder (`engineConfigFolder`) and gives the page that signs in by a pasted code; `POST …/sign-in/code` hands the login that code. `GET …/account` gives what `auth status --json` gives: signed in, email, plan. An event announces the change.
  - Try the sign-in by hand first: does the login open the browser and finish with no TTY under the service, on Windows and on Linux? Spawn it with stdin not a TTY on a temporary folder, watch its output for about 15 s, kill it, never finish it. Log what you find; if it needs a TTY, stop and ask.
  - Commit.
- [x] 1e3. Each Claude Code engine's folder and the engine down, in Engine and Notifications, about 60k:
  - The folder is made when a Claude Code engine is added and removed with it, its Sign in ended; `claudeCodeEngineProblems`' second-engine refusal goes (its refusal of removing `claude-code` stays until 3a).
  - `EngineDown` carries the engine's id and name, and the Notification names the engine. Check how `office.down.engine` Notifications replace one another: by kind alone, a second engine's would take the first's place.
  - Commit.

  Read: the State; `engine/MAP.md`; `engine/application/engine-settings-service.ts`; `engine/engine-accounts.module.ts`; `engine/adapters/claude-code/claude-code-cli-accounts.ts`; `engine/domain/engine-settings.ts` (`claudeCodeEngineProblems`); `engine/domain/engine-events.ts`; `engine/application/engine-sessions.ts` (`engineDown`); `notifications/MAP.md`; `notifications/domain/notification.ts` (grep `office.down.engine`), `notification-service.ts` (grep `EngineDown`).
- [x] 1e4. The pasted token and Sign out, in Engine and the contracts, about 70k (the user's answers of 2026-11-02):
  - A `claude setup-token` token (`sk-ant-oat01-…`, its shape checked) is written into the engine's folder as its `.credentials.json`, owner-only, never sent back nor logged; it goes with the folder. Sign out removes the file.
  - Routes set the token and sign out, each announced as `engine.account-changed`.
  - The account says a pasted token signs it in (no email or plan).
  - Tests on fakes and temp folders. Commit.

  Read: the State; `engine/MAP.md`; `engine/domain/engine-account.ts`; `engine/application/engine-accounts.ts`; `engine/ports/claude-code-accounts.ts`; `engine/adapters/claude-code/claude-code-cli-accounts.ts`, `engine-config-folder.ts`; `engine/adapters/http/engine-accounts.controller.ts`; `packages/contracts/src/engines.ts` l. 142–169.
- [x] 1f. Web, Settings › Engines, the list, about 70k (split: sizing put the whole step over 120k, so the account went to 1fb):
  - The engines list: Add (Claude Code or API endpoint), rename, the `-p` switch, the default model.
  - The Office default, the search endpoint, and the prices card keyed as decided.
  - e2e tests. Commit.

  Read: the State; `apps/web/src/surfaces/settings/MAP.md` (Engines); `settings/engines/engines-section.tsx`, `engine-settings-draft.ts`, `model-prices-card.tsx`; `apps/web/e2e/MAP.md`.
- [x] 1fb. Web, a Claude Code engine's account, about 60k:
  - On each saved Claude Code engine: the account line (email and plan, that a pasted token signs it in, or "Signed out"), Sign in (the sign-in page as a link and a field for its code), "Paste a token instead" (a token box, `PUT …/:engineId/token`, its 400 words shown), "Sign out" on a signed-in engine (`DELETE …/:engineId/sign-in`); the account refetched on `engine.account-changed` and on each call's success.
  - e2e tests. Commit.

  Read: the State; `apps/web/src/surfaces/settings/MAP.md` (Engines); `settings/engines/claude-code-engine-fields.tsx`; `apps/web/src/api/engine.ts`, `github.ts` (the event invalidations); `apps/web/e2e/MAP.md`.
- [x] 1f2. The windows by engine, in Engine and Notifications, about 50k (found in 1e3: two engines' readings alternating would raise false "reset" and "nearly used"):
  - `UsageWindowsChanged` names its engine; Notifications keep each engine's 5-hour window apart (`windowPercent`, one for every engine today) and name the engine in the window words; Now's windows by engine id.
  - Commit.

  Read: the State; `engine/application/usage-window-state.ts`; `notifications/MAP.md`; `notification-service.ts` (`subscribeToOffice`); `now-service.ts` (grep `UsageWindowsChanged`); `notification.ts` (`windowNearlyUsed`, `windowReset`).
- [x] 1g. Web, the engines by name everywhere else, about 80k:
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
  - Running sessions finish, and their Threads start fresh. Since 1e3 a removed Claude Code engine's folder goes at once (`EngineRemoved`), under any session still running on it: wait for those sessions, or move the removal after them.
  - An id is reserved only while its engine is listed: a Claude Code engine removed and added again under its name takes its old id back, with the old account's day usage, window samples and ratios, and caps. Clear or move them on removal.
  - Commit.

  Read: the State; `engine/application/engine-settings-service.ts`; `engine/application/engine-sessions.ts` (start, by symbol); the cascade from 2b; `conversations/domain/context-policy.ts` l. 120–145.
- [ ] 3b. Web, the remove dialog, about 50k: pick the replacement, list what moves, and warn when it is the only engine. e2e test. Commit.

  Read: the State; `settings/engines/engines-section.tsx`; `apps/web/e2e/MAP.md`.
- [ ] 4. The live check on the Test Project, about 60k. The user signs in two Claude accounts at the browser. Run it on Haiku, covering the Definition of Done's live points. Re-run the engine check's `skills.user-scope` under an engine's folder and update `engine-check.md`. Commit.

  Read: the State; [the Test Project](test-project.md); [testing](../../apps/service/docs/testing.md), live checks; `apps/service/test/live-check.ts`; `docs/engine-check.md` (`skills.user-scope`).
- [ ] 5. Close: tick the Definition of Done with each check run, run `npm run verify:linux`, archive the log, and set the task to done. Small.

## State

Steps 0, 1a–1e, 1e2–1e4, 1f, 1fb, 1f2 and 1g are done; next is 2a (the Project levels, in Projects and the contracts).
- Engines by name in the web (1g): `shell/use-engine-name.ts` names engines everywhere (one no longer listed by its id); `engineIdLabel` is gone. Usage estimate words take the lookup (`usageEstimateWords(estimate, engineName)`, "Claude Code: 60k tokens …; Local models: …" when several). Office limits: each engine's caps under its name in the engines list's order (the service's `everyEngineCaps`), "<name>'s window caps" / "<name>'s daily caps", and the section's own engine's 5-hour window. Now and the status strip: one figure per engine, "40% of <name>'s 5-hour window", always named, ordered by the engines list, a reading of an engine no longer listed last by its id (`namedFiveHourWindows` in `now-words.ts`, `useFiveHourWindows`, nothing while the engines are being read). Change history and a Proposal's change: `changeLine`/`fieldValueText` take `FieldValueNames { roleTitles, engineName }`, "Engine Claude Code → People Strata". The Role card's Engine select already named engines (1c3b).
- Windows by engine (1f2): `UsageWindowsChanged(engineId, engineName, windows)`; `UsageWindowState.update(engine, reading)`, `readingsByEngine` (in the order first read). Notifications keep `windowPercents` by engine id and name the engine in the window words, pointing to `{ kind: "office", engineId }`. Now's `fiveHourWindows: [{ engineId, percentUsed, resetsAt }]`, empty until a reading. A removed engine's reading stays in `UsageWindowState` until a restart, so Now lists it (for 3a).
- Account (1fb): `settings/engines/claude-code-engine-account.tsx`, shown in `ClaudeCodeEngineFields` once the engine has an id: the line (`engine-account-words.ts`: "Signed in as <email> · Claude <Plan>", "A pasted token signs it in", "Signed out"), Sign in (the sign-in page as a link, a Code box, Finish, Cancel), "Paste a token instead" (password box, "Save the token", refusal words shown, emptied on success), Sign out on a signed-in engine. Local state only, never in the engines' draft. `api/engine.ts`: `engineAccountQuery` keyed `["settings","engines",<id>,"account"]`, refreshed on each success and by `engineEventInvalidations` (`engine.account-changed`). `postToApi` became `sendToApiWithNoAnswer(method, …)`.
- Settings › Engines (1f): one "Engines" card, the Claude Code engines first (`claude-code-engine-fields.tsx`: Name, Default model from the Claude models `GET` prices, the switch "The -p fallback"), then the API endpoints (`api-endpoint-fields.tsx`, now with a Default model select); "Add a Claude Code engine" and "Add an API endpoint". A Claude Code engine has Remove only before its first Save; a saved API endpoint keeps its old Remove until 3b. The "Office default" card (`office-default-card.tsx`) offers the saved engines still listed, picking one filling in its default model. `draftedEngines` gives new ids in Save's order across both kinds. For 1fb: put the account part in `ClaudeCodeEngineFields`, only when `edit.id` is set (an unsaved engine's account would 404).
- Pasted token (1e4, the user's answer of 2026-11-02): `PUT /settings/engines/:engineId/token` `{ token }` (contract `enginePastedTokenSchema`, shape `sk-ant-oat01-[\w-]+`, 400 in words that never name it; 204) writes `<office-data>/engines/<id>/.credentials.json` = `{ claudeAiOauth: { accessToken, refreshToken: null, expiresAt: now + 1 year, scopes: ["user:inference"] } }` (`adapters/claude-code/engine-credentials.ts`, written beside and renamed, mode 0600, behind `ownEngineConfigFolder`'s guard), ending any Sign in under way. `DELETE …/:engineId/sign-in` (204) is Sign out: it removes that file, ending any Sign in. Both publish `EngineAccountChanged`. The domain's `PastedToken` reads as `[a pasted token]` in `String`, JSON and `inspect`; only `reveal()` gives it. No session or adapter change: sessions read the folder through `CLAUDE_CONFIG_DIR`, and `sessionEnvironment` drops any `CLAUDE_*` of the service.
- How the card knows: `holdsPastedToken` reads the file; `refreshToken: null` means a pasted token (only The Office writes one; a Sign in's carries a refresh token, unconfirmed until step 4). Then `engineAccountOf(output, true)` drops any email or plan an earlier Sign in left in `.claude.json`. Account contract: `{ signedIn, pastedToken, email, plan }`. No marker, no table, no migration.
- Probed (2.1.310, Windows, bogus token, temp folder, `auth status` only): the file reads `loggedIn: true, authMethod: "claude.ai"`, no email; `auth status` leaves it unchanged; removing it reads signed out (exit 1); `accessToken` alone reads signed out. Linux read the same in the earlier probe.
- For step 4's live check: whether a real session runs on such a file; whether the binary rewrites or clears it with no refresh token (at expiry or on a 401); whether a real Sign in's file carries a refresh token (the tell); whether Sign out after a real Sign in reads signed out despite `.claude.json`.
- Accounts (1e2): `EngineAccountsModule` (in `AppModule` only) holds `EngineAccountsController` (`GET …/account`, `POST …/sign-in` → `{ url }`, `POST …/sign-in/code` → 204, `PUT …/token`, `DELETE …/sign-in`; 404 not a Claude Code engine, 409 no Sign in under way, 400 no token, 502 the binary failed), `EngineAccounts` and the port `ClaudeCodeAccounts` (`ClaudeCodeCliAccounts`; the e2e service binds `StandInClaudeCodeAccounts`: a code signs in `STAND_IN_ACCOUNT`, a token `STAND_IN_PASTED_TOKEN_ACCOUNT`). Unconfirmed until step 4: a real code completing the login, and `email`/`subscriptionType`.
- Folders (1e, 1e3): `<office-data>/engines/<id>/` (`engine-config-folder.ts`), made when a Claude Code engine is added or a session starts, removed on `EngineRemoved`; `claudeCodeOfficeRules` refuses it as Office data. Engine down names the engine (`EngineDown`, Notification pointer `{ kind: "office", engineId }`).
- Engines are rows of `engines`; `GET`/`PUT /settings/engines` carry the engines, Office default, search endpoint and prices. `PUT` drops any engine left out, which deletes its folder and account. `claudeCodeEngineProblems` refuses only removing `claude-code` (until 3a).
- A real Claude Code session on the workstation runs signed out (engine down) until the user signs `claude-code` in from Settings › Engines. Live adapter tests need `<temp>/office-engine-data/engines/claude-code/` signed in (testing.md).
- e2e: people.e2e.ts's engine tests add and remove their engines through `saveEngines` (`PUT /api/settings/engines`), since each engine has caps and Office limits' Save names every engine; the account test signs in only its own "Account check" engine.
- Web: known gap, a removed API engine's prices are dropped on save (3a).
- e2e: queue.e2e.ts's estimate test lists "Local models" in the browser only (`page.route` on `GET /api/settings/engines`); people.e2e.ts's People Strata test checks its history line and its Daily caps in Office limits.

Traps:
- On Windows, renaming over a file another process holds open fails with EPERM: a token pasted while the binary reads `.credentials.json` could be refused (a 500); retry the paste. Not seen yet.
- Between steps, `npm run verify` must pass. 1c's mapping of kinds to ids lives only in the migrations.
- `windows.ts` and `linux.ts` keep `~/.claude/.credentials.json` as a secret path. Keep it.
- drizzle-kit asks about renames without a TTY: generate in two passes and merge (as 0075 and 0079 were); a data-only migration is `drizzle-kit generate --custom --name <name>`.
- The workstation's `the_office` stands at 0074; check a copy (`createdb -T the_office <copy>`) by applying 0075 onwards with `psql -f` inside the container; the hook refuses shell loops over files, so use a script in the scratchpad.
- Postgres tests need Docker Desktop (`C:\Docker\Docker Desktop.exe`) and `docker compose up -d postgres`.

## Progress

- 2026-11-02 · step 0: task file written with the user's answers; spec, glossary, coverage and README amended; next is 1a, engine ids as strings.
- 2026-11-02 · step 1a: engine ids are strings in the contracts, the service and the web; Work refuses caps not naming every engine id; next is 1b, engines as rows.
- 2026-11-02 · step 1b: engines are rows of `engines`, with the migration re-keying prices, day usage and caps; Role cards reach them through `engineModelOf` until 1c; next is 1c, the engines in the API and on the Role card.
- 2026-11-02 · step 1c: Settings › Engines' API carries the engines, the Office default (migration 0076) and prices keyed by engine id; the step was split, the Role card and the bridges going to 1c2; next is 1c2.
- 2026-11-02 · step 1c2: sessions run on an engine id and its adapter by kind and `-p` switch, an unlisted engine refused; the Role card part split off to 1c3; next is 1c3, the Role card's engine as an engine id.
- 2026-11-02 · step 1c3: a Thread's session names its engine id (migration 0077); the Role card part split off to 1c3b; next is 1c3b, the Role card's engine as an engine id.
- 2026-11-02 · step 1c3b: the Role card names an engine id (migration 0078, Stage models' `<endpoint>/` too) and 1b's bridges are gone; the web labels engines by name; next is 1d, caps per engine and Stage runs keeping the engine's id and name.
- 2026-11-02 · step 1d: caps judged by the engine's kind in Work, not the contract, cap waits naming the engine; Stage runs keep the engine's id and name (migration 0079) and the old-run pricing bridge is gone; next is 1e, each Claude Code engine's account.
- 2026-11-02 · step 1e: Claude Code sessions run with `CLAUDE_CONFIG_DIR` on the engine's own folder in the Office data, refused to Agents; every adapter gets its engine, `apiEndpointModel` gone; Threads on Claude Code start fresh (0080); Sign in split to 1e2; next is 1e2.
- 2026-11-02 · step 1e2: Sign in runs `auth login` on the engine's folder, giving its page and taking a pasted code, `GET …/account` reads `auth status`, `engine.account-changed` announces a login's end; the login works with no TTY; folders, a second engine and `EngineDown` split to 1e3; next is 1e3.
- 2026-11-02 · step 1e3: a Claude Code engine's folder is made when added and removed with it, its Sign in ended; a second Claude Code engine is allowed; `EngineDown` and its Notification name the engine, each engine's kept and handled apart; next is 1f, Settings › Engines, then 1f2, the windows by engine.
- 2026-11-02 · step 1e4 (stopped): spec §5.4 names the code paste and "Paste a token instead"; step 1e4 written, 1f given the token box; `auth status` probed with a token; stopped on whether Agents can read `CLAUDE_CODE_OAUTH_TOKEN` (§6, options in State); next is the user's answer, then 1e4.
- 2026-11-02 · step 1e4 (stopped again): the token on `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` probed: read on Linux, not on Windows (the binary reads a descriptor only as a socket or through `/proc`); a token in the folder's `.credentials.json` reads as signed in on both; nothing built; next is the user's choice (options in State), then 1e4.
- 2026-11-02 · step 1e4: a pasted `claude setup-token` token is written into the engine's folder as its `.credentials.json` (`PUT …/:engineId/token`), Sign out removes it (`DELETE …/:engineId/sign-in`), the account tells a pasted token; spec §5.4 and §6 say so; next is 1f, Settings › Engines.
- 2026-11-02 · step 1f: Settings › Engines lists the Claude Code engines and API endpoints with Add of each kind, a default model on every engine, the -p fallback switch and the Office default; the account split off to 1fb; next is 1fb, Sign in, the token and Sign out.
- 2026-11-02 · step 1fb: each saved Claude Code engine in Settings › Engines shows its account with Sign in (page link and code), "Paste a token instead" and Sign out, refetched on `engine.account-changed`; next is 1f2, the windows by engine.
- 2026-11-02 · step 1f2: `UsageWindowsChanged` names its engine; Notifications keep each engine's 5-hour window apart and name the engine in the window words; Now's `fiveHourWindows` by engine id, the web showing the first until 1g; next is 1g, the engines by name in the web.
- 2026-11-02 · step 1g: the web names engines everywhere: Office limits' caps, each engine's 5-hour window on Now and the status strip, the Usage estimate words and the Role card's change history; `engineIdLabel` removed; next is 2a, the Project levels.
