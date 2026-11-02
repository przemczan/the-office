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
- [ ] Every level names an engine and a model. Picking an engine fills in its default model. If a save at any level would newly put a Role a Pipeline names on an engine without Office tools or an answer held to a schema, the save is refused and the refusal names those Roles and Projects. Check: People, Projects and Engine service tests.
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
- [x] 2a. The Project levels, in Projects and the contracts, about 70k:
  - Projects keeps the Project default, "Use for every Role" and the Project's Role overrides (engine id and model, or none), with `GET`/`PUT` on the Project, and gives them through an exported service.
  - A minimal web fix if the Project contract changes.
  - Commit.

  Read: the State; `projects/MAP.md`; the Projects application service and schema, by symbol; `packages/contracts/src/projects.ts`.
- [x] 2b. The Role override and the engine cascade, in People and Engine, about 80k (split on 2026-11-02: replacing the card's engine and model at once breaks every session starter and its tests, too much for one step):
  - The Role card gains an optional Role override (`roleOverride`, an engine and model or none), kept beside its engine and model until 2b2. The migration sets none on every card, and presets carry none. The card check refuses an override on an unlisted engine or a model it doesn't offer.
  - `EngineCascade.of(roleKey, projectId?)` gives the engine, the model and the level each came from. It reads the Office default from Engine and the Project levels through a port People declares, bound to `ProjectService` in `app.module.ts`.
  - Commit.

  Read: the State; `people/MAP.md`; `people/application/role-service.ts` (the card checks, by symbol); `people/domain/presets.ts`; `packages/contracts/src/people.ts`; the [module template](../../apps/service/docs/module-template.md), on ports to another module.
- [x] 2b2. Sessions and the Usage estimate on the cascade, in Conversations and Work, about 70k (split on 2026-11-02 into 2b2 and 2b2b, each leaving `npm run verify` green):
  - `thread-runner.ts`, `stage-threads.ts` and `thread-contexts.ts` take the engine and model from `EngineCascade`, with the Project where it is known; a resumed session keeps its engine and takes the model the cascade gives now. The Usage estimate (`usage-estimates.ts`) reads it through a Work port, with the Task's Project.
  - The live checks (`test/live-check.ts`, the Test Project checks) set a Role override instead of the card's engine and model.
  - Commit.

  Read: the State; `conversations/MAP.md`; the `card.engine`/`card.model` uses (grep); `work/domain/usage-estimate.ts` l. 60–75.
- [x] 2b2b. The card without engine and model, in People, Conversations and the web, about 70k:
  - The card's `engine` and `model` go (domain, contract, presets, Proposal tools, Work's `KnownPerson`); a migration drops them from stored cards and Proposals. Old history entries keep their `engine` and `model` fields; new ones name `roleOverride`.
  - Minimal web fixes (`blank-role-card.ts`, `role-card-form.tsx`, `role-card-view.tsx`, `overview-tab.tsx`, `proposal-card.tsx`, `stage-editor.tsx`).
  - Commit.

  Read: the State; `people/MAP.md`; the `card.engine`/`card.model` uses (grep); `conversations/application/session-role.fixtures.ts`; `people/domain/role.fixtures.ts`; `conversations/adapters/office-tools/proposal-office-tools.ts`.
- [x] 2b3. The capability check, its rule and Projects' saves, about 60k (split on 2026-11-02; the Role override and the Office default went to 2b3b). The user's answer: only Roles a Pipeline names need `officeTools` and `outputSchema`:
  - The pure rule and People's check, registered with Projects' saves (Project default, force, Project's Role override) through a registry, bound in `app.module.ts`; the Roles from the Pipeline library through a port.
  - The Engine block's "no Project default" reads "Office default". Spec §5.4 and §8 amended.
  - Commit.

  Read: the State; `people/application/role-service.ts`; `projects/application/project-service.ts` (`changeProjectDefault`, `changeUseForEveryRole`, `changeRoleOverride`); `engine/domain/engine-settings.ts` (`officeDefaultProblems`).
- [x] 2b3b. The capability check on the Role override and the Office default, in People and Engine, about 50k:
  - A registry in People for `RoleService`'s card saves (Role override) and one in Engine for `EngineSettingsService.change` (Office default), each filled by `PipelineRoleCapabilityChecks` as it starts; each weighs every Pipeline Role outside any Project and in every Project (`KnownProjectLevels.engineLevelsOfEveryProject`, which then needs each Project's name for the refusal).
  - People and Engine service tests. Commit.

  Read: the State; `people/application/pipeline-role-capability-checks.ts`; `people/domain/pipeline-role-capabilities.ts`; `people/application/role-service.ts` (`changeCard`, the card checks); `engine/application/engine-settings-service.ts` (`change`); `projects/application/engine-levels-checks.ts` (the registry's shape).
- [x] 2b3c. The capability check the other way round, in Pipelines and People, about 60k (the user's answer of 2026-11-02 closes the three gaps 2b3b left; split in sizing into 2b3c, 2b3d and 2b3e):
  - A library save (add, save, a Proposal's Stages, and the check before Save) that newly names a Role whose engine lacks `officeTools` or `outputSchema` is refused, weighed outside any Project and in every Project; a Task's Stage list edit (and its check) the same way, in the Task's Project. Same mechanism: Pipelines' port `StageRoleEngines`, bound in `app.module.ts` to People's `PipelineRoleCapabilityChecks.newlyNamedRolesProblems`.
  - Spec §5.4 and §8 amended for all three gaps. People and Pipelines tests. Commit.

  Read: the State; `people/application/pipeline-role-capability-checks.ts`; `pipelines/application/pipeline-library-editor.ts`; `pipelines/application/task-stages-service.ts` (`review`); `app.module.ts` (the Pipelines and engine cascade registrations).
- [x] 2b3d. Open Tasks' own Stages counted, in People and Pipelines, about 70k:
  - The forward check (Project levels, Role override, Settings › Engines) also counts the Roles open Tasks' own Stages name (`task_stages` where the Task follows them and isn't done or dropped), each in its Task's Project only.
  - A registry in People (in place of the `KnownPipelineRoles` port) that Pipelines fills as it starts: the library's Roles everywhere, and each open Task's in its Project. Not a port: `EngineCascadeModule` can't import `PipelinesModule` (Pipelines → Work → engine cascade).
  - People and Pipelines tests. Commit.

  Read: the State; `people/application/pipeline-role-capability-checks.ts` (`rolesNamedByPipelines`, `newlyIncapableProblems`, `Place`); `people/engine-cascade.module.ts`; `pipelines/application/task-stages-service.ts`; the tests binding `knownPipelineRoles` (grep).
- [x] 2b3e. Rehire and preset hires, in People, about 40k:
  - Hiring back a person let go is refused when the Role override returning with their card would newly put a Role a Pipeline names on an incapable engine (through `RoleOverrideChecks`, before none, after the card's).
  - A preset hire: presets carry no Role override, so it can't change the cascade; a test proves it passes through the check.
  - People tests. Commit.

  Read: the State; `people/application/role-service.ts` (the hires, `roleOverrideProblems`); `people/domain/presets.ts` (grep `roleOverride`).
- [x] 2c. The rest of the sessions on the cascade, and no Stage model, in Conversations, Pipelines and Work, about 90k:
  - Whatever 2b2 left without the Thread's Project (`thread-changes.ts` included) passes it to `EngineCascade`.
  - The Stage's `model` is dropped from the contract, the Planner's Proposal tools and saved Stage lists (a migration).
  - `usage-estimate.ts` uses the cascade per Stage.
  - Minimal Stage editor fix.
  - Commit.

  Read: the State; `conversations/MAP.md`; the `.engine` uses in those files (grep); `pipelines/MAP.md`; `packages/contracts/src/stages.ts` (`stageSchema`); `work/domain/usage-estimate.ts` l. 60–75.
- [x] 2d. Web, the Role card, and the Stage editor, about 110k (split on 2026-11-02; the Project page's Engine block went to 2d2):
  - The Role card's override, with "Office default", picking an engine filling in its default model, and what applies and from where, per Project.
  - The Stage editor and the Task's Stage list without Model (the field and the row's word went in 2c; check nothing else names one).
  - e2e tests. Commit.

  Read: the State; `apps/web/src/surfaces/people/MAP.md`; `apps/web/src/shell/role-card-words.ts`; the Stage editor (grep `model` in `surfaces/projects` and `surfaces/work`); `apps/web/e2e/MAP.md`.
- [x] 2d2. Web, the Project page's Engine block, about 60k: the Project default (engine, then its models, picking an engine filling in its default model, or none), "Use for every Role" (only with a default; the default can't be cleared while it is on), and the Project's Role overrides (a Role, then an engine and model; removable). e2e test (only `people.e2e.ts` hires; see the State). Commit.

  Read: the State; `apps/web/src/surfaces/projects/MAP.md`; `project-page.tsx` and `default-pipeline-block.tsx` (the pattern); the three `PUT /projects/:id/…` routes in `projects/adapters/http/projects.controller.ts` (by symbol); `EngineFields` in `surfaces/people/role-card-form.tsx` (the engine and model pair to reuse); `apps/web/e2e/MAP.md`.
- [x] 3a. Removing an engine, with a replacement, in Engine, People and Projects, about 90k (split on 2026-11-02 into 3a, 3a2 and 3a3):
  - `DELETE /settings/engines/:id` with a replacement id. It moves every reference, falls back to the replacement's default model, and refuses a replacement that fails the capability check. Removing the only engine is refused in words until 3a2.
  - `PUT /settings/engines` no longer removes a saved engine; the web offers no Remove on a saved engine until 3b's dialog; e2e cleanup removes through `DELETE`.
  - Commit.

  Read: the State; `engine/application/engine-settings-service.ts`; `people/application/pipeline-role-capability-checks.ts`; `projects/application/project-service.ts` (`changeEngineLevels`, by symbol).
- [x] 3a2. Removing the only engine, about 70k (split on 2026-11-02 into 3a2 and 3a2b):
  - The references move to none: `office_default_engine_id` is NOT NULL and `EngineSettings.officeDefault` non-null, so a migration and People's cascade change; a Project with "Use for every Role" on loses its default (`changeProjectDefault` refuses that today).
  - With no engine, starting a session is refused with words.
  - Commit.

  Read: the State; `engine/domain/engine-removal.ts`; `people/domain/engine-cascade.ts`; `projects/domain/project-changes.ts` (`moveEngineLevels`).
- [x] 3a2a. The full verify's flakes under load (asked by the user on 2026-11-02), about 100k: every test file shares one database, so tests that read Office-wide rows (the queue for Start, the day's figures) see other files' rows; find each flake's cause and scope the test to its own rows or wait deterministically, no blind timeouts. Three full `npm run verify` runs in a row pass. Commit.

  Read: the State; [testing](../../apps/service/docs/testing.md); `vitest.config.ts`; `work/adapters/http/tasks.controller.test.ts` (`Window caps`, `The queue`); `notifications/application/now-service.test.ts`; `conversations/application/devops-proposals.test.ts` (`ninaProposes`); `apps/web/e2e/people.e2e.ts` (the skill-update test).
- [x] 3a2a2. The flakes 3a2a left, about 80k, each seen once in eight full runs, none reproduced alone: devops-proposals' skill installs stalled about 25 s ("Still drafting.", "No Office tool answered yet.") in the run where tasks.controller's Conflicts at Publish had its Resolve Stage fail; check from the JSON report's times whether they overlapped, for one cause behind both. The e2e skill-update test missed "→ v1.1.0" within 15 s: time one pass of `SkillUpdates.check` (every installed skill's Source in turn, the next pass 2 s after) in the e2e service. tasks.controller's fire alarm all-clear test (about 40 requests, no waits, 2 s in a full run) timed out at 5 s once: load alone, or a cause. Then three full `npm run verify` runs in a row pass. Commit.

  Read: the State; [testing](../../apps/service/docs/testing.md); `conversations/application/devops-proposals.test.ts` (`ninaProposes`, `ninaCalls`); `skills/adapters/git/git-source-fetcher.ts` (`SourceGit.run`); `skills/application/skill-updates.ts` (`check`); `apps/web/e2e/people.e2e.ts` l. 2266–2305.
- [ ] 3a2a3. The slow files and the e2e skill update, about 60k, after the engine work unless the flake returns:
  - The run lasts as long as its slowest files (about 65 s of 75): `tasks.controller.test.ts`, `command-line-git.test.ts` (alone 26 s, 479 git spawns in the service, 21.7 s of it), `publishing.test.ts` (alone 22 s, 493 spawns, 17.3 s); about 2.5 times slower in a full run. Build each file's repositories once and copy or `clone --local` them per test instead of `init` and `commit` each time, or split the files.
  - The e2e skill-update test missed "→ v1.1.0" in 15 s once; not reproduced. A pass of `SkillUpdates.check` takes 2–341 ms (48 passes in a full e2e run), so not its length. Left: one git call stalling the passes (they run one after another, `refs` waits up to 120 s), or an error other than `SkillRefused`/`SkillNotFound` ending a pass early. If it returns, copy `apps/web/e2e-results/artifacts/` before the next run; check whether Playwright's `webServer` shows the service's WARN lines.
  - Commit.

  Read: the State; [testing](../../apps/service/docs/testing.md); `projects/adapters/git/command-line-git.test.ts`, `projects/application/publishing.test.ts` (their repository helpers); `skills/application/skill-updates.ts` (`check`); `apps/web/playwright.config.ts`.
- [x] 3a2b. Running sessions on a removed engine, about 40k (split on 2026-11-02 into 3a2b and 3a2c):
  - Running sessions finish, and their Threads start fresh. Since 1e3 a removed Claude Code engine's folder goes at once (`EngineRemoved`, `EngineAccounts.onModuleInit`), under any session still running on it: wait for those sessions, or move the removal after them.
  - Commit.

  Read: the State; `engine/application/engine-sessions.ts` (start, by symbol); `engine/application/engine-accounts.ts`; `conversations/domain/context-policy.ts` l. 120–145.
- [ ] 3a2c. Closing the removal race (asked by the user on 2026-11-02), about 60k:
  - Every reference save refuses an engine that is being or has been removed, so nothing names a missing engine: one Engine service over `KeyedLocks` (`platform/locks/`, one key, re-entrant), exported and held by `EngineSettingsService.remove` from its read through `replace` (`EngineRemoved` published after), by `EngineSettingsService.change` (a `PUT` read before a removal and written after would list the engine again), by `RoleService.changeCard` (with `reword`) and `hireFromScratch`, and by `ProjectService.changeProjectDefault` and `changeRoleOverride`, each over its whole read, check and write. `hireBack` writes no override (the moves move a let-go card), so it stays out unless the code shows otherwise.
  - The second sweep of the moves in `remove` goes, with its log and the tests expecting two moves and "the move after it fails".
  - Tests: a move held on a promise while a `PUT`, a Role card save and a Project level save wait, each refused or not listing the engine once it is released.
  - Commit.

  Read: the State; `engine/application/engine-settings-service.ts`; `people/application/role-service.ts` (`changeCard`, `hireFromScratch`); `projects/application/project-service.ts` l. 178–222; `engine/adapters/http/engine-settings.controller.test.ts` l. 268–366.
- [ ] 3a3. A removed engine's data, about 50k:
  - An id is reserved only while its engine is listed: a Claude Code engine removed and added again under its name takes its old id back (`engineIdFor`), with the old account's day usage, window samples and ratios, and caps (`engine_day_usage`, `usage_window_samples`, the in-memory `officeTokensSoFar` and `UsageWindowSamples`, Work's `engine_caps`). Clear or move them on removal.
  - A removed engine's Model prices are kept, so its history stays priced: `replace` deletes every `model_prices` row and `pricedModels` keeps only offered models, and `priceOf` needs the engine listed to know its kind.
  - Commit.

  Read: the State; `engine/domain/model-prices.ts`; `engine/adapters/postgres/postgres-engine-settings.ts`; `work/adapters/postgres/work-settings.schema.ts`.
- [ ] 3b. Web, the remove dialog, about 50k: pick the replacement, list what moves, and warn when it is the only engine. e2e test. Commit.

  Read: the State; `settings/engines/engines-section.tsx`; `apps/web/e2e/MAP.md`.
- [ ] 4. The live check on the Test Project, about 60k. The user signs in two Claude accounts at the browser. Run it on Haiku, covering the Definition of Done's live points. Re-run the engine check's `skills.user-scope` under an engine's folder and update `engine-check.md`. Commit.

  Read: the State; [the Test Project](test-project.md); [testing](../../apps/service/docs/testing.md), live checks; `apps/service/test/live-check.ts`; `docs/engine-check.md` (`skills.user-scope`).
- [ ] 5. Close: tick the Definition of Done with each check run, run `npm run verify:linux`, archive the log, and set the task to done. Small.

## State

Steps 0, 1a–1e, 1e2–1e4, 1f, 1fb, 1f2, 1g, 2a, 2b, 2b2, 2b2b, 2b3, 2b3b–2b3e, 2c, 2d, 2d2, 3a, 3a2, 3a2a, 3a2a2 and 3a2b are done; next is 3a2c (closing the removal race), 3a3 and 3b. Steps were split on 2026-11-02: 2b, 2b2, 2b3, 2d, 3a into 3a, 3a2 and 3a3, 3a2 into 3a2 and 3a2b, and 3a2b into 3a2b and 3a2c. 3a2a3 (slow files, the e2e skill update) waits until after the engine work unless the flake returns.
- The only engine (3a2): `DELETE` without `replacement` removes it (`engineRemovalAmong(…, null)`, `EngineRemoval.replacement: Engine | null`); `movedEngineModel` gives none, so the Office default (migration 0085: nullable, both or neither), Role overrides, Project defaults (force turned off first, `moveEngineLevels`) and Projects' Role overrides go to none. After `replace` and `EngineRemoved`, the references move again (a failure there only logged). `engineInCascade` gives none with no level; `EngineCascade.of` throws Engine's `NoEngineListed` (words), `applying` gives none (Work's `KnownEngineCascade.applying`, the Usage estimate leaves the Stage out; `ThreadContexts`). A Thread message is refused (`ThreadRefused`, nothing logged); `AgentStageRunner.run` fails the Stage in words before git, and `sessionAhead` gives none. Web: the Office default card says none; the Role card's "Runs on" says "No engine". `GET /roles/:key/engine-cascade`'s `outsideProjects` and the settings' `officeDefault` are nullable.
- Removing an engine (3a): `DELETE /settings/engines/:engineId?replacement=` (contract `engineRemovalSchema`) → `EngineSettingsService.remove`: `engineRemovalAmong` (refuses an unlisted engine or replacement, or none while others are listed), `settingsWithoutEngine` (Office default moved), the checks with `EngineSettingsSave.removal` (People weighs moved Role overrides and Project levels, `movedProjectLevels`), then Engine's registry `EngineReferenceMoves` (People's `RoleOverrideMoves`, Projects' `ProjectLevelMoves`, `moveEngineLevels`), then `replace`, then `EngineRemoved`. Every move goes through `movedEngineModel`. Order chosen so a failed move leaves the engine listed and nothing dangling; a retry moves the rest. `PUT` refuses leaving a saved engine out (`leftOutEngineProblems`; `claudeCodeEngineProblems` gone); the web offers Remove only on an unsaved engine of either kind until 3b.
- Chosen (the spec is silent): a moved Role override is the card's next version, by the user, with its history entry, a let-go Role's too (hiring back restores the card). With no engine listed, the first engine saved takes the Office default on its default model (`officeDefaultOf`; the card offers only saved engines, so the user couldn't pick one), kept so by the user on 2026-11-02; otherwise a save without an Office default is refused.
- Capability check, forward (2b3, 2b3b; the user, 2026-11-02: "Pipeline Roles only"): only Roles a Pipeline names need `officeTools` and `outputSchema` (`people/domain/pipeline-role-capabilities.ts`); a save is refused when it would *newly* put such a Role on an engine lacking one (before vs after, so an old failure never blocks). `PipelineRoleCapabilityChecks` (EngineCascadeModule) registers on init with Projects' `EngineLevelsChecks` (through People's `ProjectLevelsSaves`; `ProjectService.changeEngineLevels`, 422 `ProjectRefused`), People's `RoleOverrideChecks` (422 `RoleRefused`) and Engine's `EngineSettingsChecks` (`EngineSettingsService.change`, after `changedEngineSettings`, before keeping or announcing; 422 `EngineSettingsRefused`). The last two weigh outside any Project and every Project; a Settings › Engines save on each side's own engines. An unfilled or let-go Role counts with no Role override; an unlisted engine is left to `checkEngineModel`. No real engine lacks either today: tests use stand-ins.
- `RoleOverrideChecks` runs on every way a Role override arrives (2b3b, 2b3e): `changeCard`/`cardChangeProblems`, hires from scratch, preset hires (`hiringFromPreset`, also `presetHiringProblems`; presets carry none, so before and after are both none and nothing is refused, proven in `pipeline-role-capability-checks.test.ts` and `roles.controller.test.ts`), and `hireBack` (before none, after the let-go card's; 422 before the standing changes).
- The other way round (2b3c): `PipelineLibraryEditor` (`add`, `save`, `saveProposedStages`, `proposedStagesProblems`, `check`) and `TaskStagesService.review` ask Pipelines' port `StageRoleEngines` (bound to `newlyNamedRolesProblems`) about Roles the Stages newly name; the library's weighed everywhere, a Task's in its Project. Tests: `StageRoleEnginesForTests`.
- Roles named (2b3d): People's registry `PipelineRoleSources` (exported by `EngineCascadeModule`) gives `PipelineRolesNamed` (`everywhere`, `byProject`), filled on init by Pipelines' `RolesNamedInStages` (library everywhere, open Tasks' own Stages by Project). Each `Place` weighs `rolesNamedIn` there. Pipelines' tests get the registry from `PipelinesPortsForTestsModule`.
- Role override (2b, 2b2b, 2d): `RoleCard.roleOverride: EngineModel | null` (migrations 0082, 0083); old history entries keep `engine`/`model`. Web: `EngineFields` ("Office default" or an engine, then its Model, filled with its `defaultModel`); the view's "Runs on" (`EngineThatApplies`) gives the cascade's result, level and other Projects.
- Cascade (2b, 2d): `EngineCascade.of(roleKey, projectId?)` → `{ engineId, model, level }`, pure `engineInCascade` (`people/domain/engine-cascade.ts`); Project levels through `KnownProjectLevels`. `GET /roles/:key/engine-cascade` (404 for an unfilled Role); web key `ENGINE_CASCADE`. Tests: `EngineCascadeStandIn`, Work's `KnownEngineCascadeForTests.inProject`. Every session asks it in its Project (2b2, 2c); the Usage estimate per Agent Stage.
- No Stage model (2c): gone from the contract, Pipelines, the Usage estimate and the web; migration 0084.
- Project levels (2a, 2d2): `Project.projectDefault`, `useForEveryRole`, `roleOverrides` (migration 0081), three `PUT /projects/:id/…` routes; the Project page's Engine block (`surfaces/projects/engine-block.tsx`) with `shell/engine-model-fields.tsx`.
- Web (1f–1g): engines named through `shell/use-engine-name.ts`. A removed engine's Model prices are still dropped (`pricedModels`), fixed in 3a3.
- Running sessions (3a2b): `RunningEngineSessions` (`EngineSettingsModule`, one instance for `EngineSessions` and `EngineAccounts`) counts each session from the top of `start`/`resume`, before the engine is looked up, until its events end or opening fails. On `EngineRemoved`, `EngineAccounts` waits for `allEnded` in the background (not awaited: a Thread's idle session lasts up to 10 minutes) and removes the folder unless the engine was added again meanwhile. Threads already start fresh on the next message (`engine-changed`; with no engine, refused until one is added).
- Accounts and folders (1e–1e4): `<office-data>/engines/<id>/`, removed after its sessions (3a2b); Sign in, a pasted token, Sign out. For step 4's live check: whether a real session runs on a pasted token's file, whether the binary rewrites it without a refresh token, whether a real Sign in's file carries one, whether Sign out after a real Sign in reads signed out; a real code completing the login, and `email`/`subscriptionType`.
- e2e: people.e2e.ts's engine tests add engines through `saveEngines` and remove them through `removeEngine` (`DELETE`, replacement `claude-code`); queue.e2e.ts lists "Local models" through `page.route`. The cascade test sets "Cascade shop"'s Developer override through the API, the Engine block's test ("Engine shop") all three levels in the UI, each cleared in `finally`. e2e tests name their Project page switch (skills.e2e.ts by its label).

Traps:
- 3a2c, the user on 2026-11-02: close the removal race, so every reference save refuses an engine that is being or has been removed (today only a save that read the engines before `replace` and wrote after the second move's sweep would still name it); then the second sweep goes. One in-process lock assumes one service process. Kept by the user: the first engine saved after none becomes the Office default.
- 3a3: a removed engine's folder waits for its sessions in memory: a service stopped meanwhile leaves the folder, its login included, and an engine added again under the name takes the id back with that folder (and the old login). Decide with the id's other data: clear unlisted engines' folders at boot, or never reuse a removed id.
- The Postgres round trip of a none Office default isn't tested on the shared database (it would stop every other file's sessions meanwhile); 0085 was checked on a copy, with the half-set row refused.
- Tests that move references use an engine id of their own (`removed-<uuid>`): the database is shared, and moving `claude-code` moved other files' Roles.
- Each check reads every Task and every `task_stages` row (two queries); fine at one user's scale, a filtered query if it grows.
- Shared database (3a2a, 3a2a2): every app with Work binds `ownProjectsQueue` (Work's `index.fixtures.ts`); every `AppModule` app also binds `ownProjectsStartedTasks` (Pipelines' `index.fixtures.ts`), since its start ends every left-running Stage run it lists as restarted and walks the Task on its own scripted engine (that was devops-proposals' stalls and tasks.controller's failed Resolve); a test of the day's figures fakes a day of its own; see testing.md. The cap timer counts from when the caps were weighed (`QueueService.setCapTimer`). The fire alarm's tests have 15 s, and roles.controller's MCP server test 30 s like the other fake-server reviews (load alone, numbers in the tests). A folder renamed into place on Windows may be held for a moment (EPERM in `writeWhole`): `platform/os/move-when-free.ts` tries again for about 2 s, used there and by `git-clone.ts`.
- Between steps, `npm run verify` must pass. 1c's mapping of kinds to ids lives only in the migrations. `windows.ts` and `linux.ts` keep `~/.claude/.credentials.json` as a secret path.
- drizzle-kit asks about renames without a TTY: generate in two passes and merge; a data-only migration is `drizzle-kit generate --custom --name <name>`.
- The workstation's `the_office` stands at 0081 (0082–0085 checked on a copy, not applied); check a copy with a scratchpad script: `MSYS_NO_PATHCONV=1`, the user from `docker exec the-office-postgres-1 printenv POSTGRES_USER`, `createdb -T the_office <copy>`, `docker cp` the file in, `psql -v ON_ERROR_STOP=1 -f`.
- Postgres tests need Docker Desktop and `docker compose up -d postgres`.
- Write Markdown with UTF-8, never PowerShell's `Set-Content` default.

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
- 2026-11-02 · step 2a: Projects keeps the Project default, "Use for every Role" and the Project's Role overrides (migration 0081, three PUTs, events, `engineLevelsOf`); next is 2b, the cascade and the Role override in People.
- 2026-11-02 · step 2b: split into 2b, 2b2, 2b3; the Role card gains `roleOverride` (migration 0082, none everywhere) and People resolves `EngineCascade.of(roleKey, projectId?)` through Engine's Office default and the `KnownProjectLevels` port; next is 2b2, sessions on the cascade.
- 2026-11-02 · step 2b2: split into 2b2 and 2b2b; Threads, Stage runs and the context label take the engine and model from `EngineCascade` (a resume keeps its engine, takes the model now), the Usage estimate through Work's `KnownEngineCascade`, the live checks through a Role override; next is 2b2b, the card without engine and model.
- 2026-11-02 · step 2b2b: the Role card drops `engine` and `model` (domain, contract, presets, Proposal tools, Work's `KnownPerson`; migration 0083), old history entries keep them; the web's Engine field sets the Role override with "Office default"; next is 2c, since 2b3 waits on the user.
- 2026-11-02 · step 2c: the context label asks the cascade in a Task Thread's Project; a Stage has no model (contract, Pipelines, Usage estimate, migration 0084, the Stage editor's Model field gone); next is 2d, the web's Role card override, the Project's Engine block and the Stage editor.
- 2026-11-02 · step 2d: `/role-card-options` carries each engine's default model, which picking an engine fills in; `GET /roles/:key/engine-cascade` and the Role card's "Runs on" with the Projects where something else applies; the Stage editor checked clean; 2d split, the Engine block is 2d2; next 2d2.
- 2026-11-02 · step 2d2: the Project page's Engine block (Project default, "Use for every Role", the Project's Role overrides), the engine and model pair moved to `shell/engine-model-fields.tsx` for the Role card and the block; e2e test in people.e2e.ts; next 3a.
- 2026-11-02 · step 2b3: split into 2b3 and 2b3b; a Project save that would newly put a Role a Pipeline names on an engine without `officeTools`/`outputSchema` is refused (People's check through Projects' `EngineLevelsChecks` registry); the Engine block says "Office default"; spec §5.4, §8 amended; next is 2b3b.
- 2026-11-02 · step 2b3b: the capability check also refuses a Role override save (People's `RoleOverrideChecks`, in `RoleService`) and a Settings › Engines save (Engine's `EngineSettingsChecks`), weighing outside any Project and every Project by name; next is 3a.
- 2026-11-02 · step 2b3c: the user closed 2b3b's three gaps (spec §5.4, §8 amended); a library or Task Stage list save that newly names a Role whose engine lacks `officeTools`/`outputSchema` is refused (Pipelines' `StageRoleEngines` port to People's check; library everywhere, Task in its Project); next is 2b3d (open Tasks' Stages counted).
- 2026-11-02 · step 2b3d: open Tasks' own Stages count in the forward check, each in its Task's Project; People's registry `PipelineRoleSources`, filled by Pipelines' `RolesNamedInStages`, replaces the `KnownPipelineRoles` port, and each place weighs its own Roles; next is 2b3e (rehire and preset hires).
- 2026-11-02 · step 2b3e: hiring back is refused when the Role override returning with the card fails `RoleOverrideChecks` (before none); preset hires pass through the check too, with none before or after, and tests prove it lets them through; next is 3a (removing an engine).
- 2026-11-02 · step 3a: split into 3a, 3a2, 3a3; `DELETE /settings/engines/:id?replacement=` moves the Office default, Role overrides (new card versions) and Project levels through `EngineReferenceMoves`, checked first; PUT no longer removes. Next: 3a2, removing the only engine.
- 2026-11-02 · step 3a2: split into 3a2 and 3a2b; removing the only engine moves every reference to none (migration 0085), the first engine saved takes the Office default, sessions are refused in words with no engine, the references move again after the engine goes. Next: 3a2b, running sessions and the folder.
- 2026-11-02 · step 3a2a: the cap timer counts from when the caps were weighed (a Task held an hour more when a release straddled the hour before a reset); apps with Work see only their own Projects' queue; Now's day figures tested on a day of their own; next is 3a2a2, the flakes left.
- 2026-11-02 · step 3a2a2: an `AppModule` test app took up other files' running Stage runs at boot (ended as restarted, walked on its own scripted engine): both whole-app tests bind `ownProjectsStartedTasks`; the fire alarm's tests get 15 s, roles.controller's MCP server test 30 s (load alone); skill folders renamed into place try again while Windows holds them (`moveWhenFree`, shared with the clone); slow files and the e2e skill update go to 3a2a3; next is 3a2b.
- 2026-11-02 · step 3a2b: split into 3a2b and 3a2c (the removal race, asked by the user); `RunningEngineSessions` counts each session per engine, and a removed Claude Code engine's folder goes only once its sessions have ended, kept when the engine is added again meanwhile. Next: 3a2c, the removal race.
