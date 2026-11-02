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
- "Sign in" runs `claude auth login` for the engine's folder. The browser opens, and the card shows the email and plan. Step 1c confirms this works under the service.
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
- [ ] 1a. Engines as rows, in Engine and the contracts, about 120k:
  - An `engines` table holds every engine, the API endpoints included (`api_endpoints` folded in or referenced). `EngineId` becomes a string id. Each engine has a kind, and the kind decides the adapter: the Agent SDK, or `-p` when the switch is on, or the API loop. `hasUsageWindows` goes by kind. `engineIdOf` and `ENGINE_IDS` go.
  - `EngineModels` is per engine id. Model prices are keyed as decided. `day_usage` and `usage_window_samples` rows are re-keyed by the migration.
  - `GET`/`PUT /settings/engines` carry the engines and the Office default.
  - The Role card's `engine` names an engine id. The migration maps the kinds: both Claude Code kinds go to `claude-code`, and API models are split. This mapping is replaced in 2a.
  - Commit.

  Read: the State; `engine/MAP.md`; `engine/domain/engines.ts`, `engine-settings.ts`, `model-prices.ts`, `api-endpoints.ts`; `engine/application/engine-models.ts`, `engine-settings-service.ts`, `agent-engines.ts`; `engine/adapters/postgres/engine-settings.schema.ts`; `packages/contracts/src/engines.ts`, `people.ts` (`roleCardSchema`); `people/application/role-service.ts` (`offeredBy` calls); the latest migration in `apps/service/drizzle/`.
- [ ] 1b. Caps and usage per engine, in Work and Pipelines, about 70k:
  - `engine_caps` is keyed by engine id. Window caps only exist on Claude Code engines. The migration copies the API set to each API engine.
  - The contract's caps check covers every listed engine, in place of `engineIdSchema.options`.
  - `UsageHistory` and Conversations' `task-tokens.ts` price by the engine id the run kept.
  - Commit.

  Read: the State; `work/MAP.md` (usage estimates part); `work/domain/usage-settings.ts`, `cap-waits.ts`, `usage-estimate.ts`; `work/adapters/postgres/work-settings.schema.ts`; `work/ports/account-windows.ts`, `day-usage.ts`, `model-prices.ts`; `packages/contracts/src/work.ts` l. 480–520; `pipelines/application/usage-history.ts`; `conversations/application/task-tokens.ts`.
- [ ] 1c. Each Claude Code engine's account, in Engine and the platform layer, about 90k:
  - Both Claude Code adapters set `CLAUDE_CONFIG_DIR` to the engine's folder, start and resume alike. The folder is made as the engine is added and removed with it.
  - `POST /settings/engines/:id/sign-in` runs the pinned binary's `auth login` with that folder, and `GET …/account` gives what `auth status --json` gives (signed in, email, plan). An event announces the change. Try it by hand first: does the login open the browser and finish with no TTY under the service, on Windows and on Linux? Log what you find.
  - Office-rules tests show an engine's folder refused like the rest of the Office data.
  - `npm run verify:linux`. Commit.

  Read: the State; `engine/adapters/claude-code/session-settings.ts` (`sessionEnvironment`); `engine/adapters/agent-sdk/sdk-options.ts`; `engine/adapters/claude-code-p/claude-code-p-arguments.ts`; `engine/adapters/claude-code-p/pinned-binary.ts`; `platform/MAP.md` (data directory, `secretPaths`); `engine/domain/secret-paths.ts`.
- [ ] 1d. Web, Settings › Engines and Office limits, about 110k:
  - The engines list: Add (Claude Code or API endpoint), rename, Sign in with the account's status, the `-p` switch, the default model, and the Office default. The prices card is re-keyed.
  - Office limits gets caps per engine, by name.
  - The Role card's Engine select lists the engines by name.
  - e2e tests. Commit.

  Read: the State; `apps/web/src/surfaces/settings/MAP.md` (Engines, Office limits); `settings/engines/engines-section.tsx`, `engine-settings-draft.ts`, `model-prices-card.tsx`; `settings/office-limits/usage-settings-draft.ts`; `apps/web/src/shell/engine-words.ts`; `apps/web/e2e/MAP.md`.
- [ ] 2a. The engine cascade, in People, Projects and Engine, about 120k:
  - Projects keeps the Project default, the force and the Project's Role overrides, with `GET`/`PUT` on the Project.
  - The Role card's engine and model become an optional Role override. The migration clears every one.
  - People's `EngineCascade.of(roleKey, projectId?)` gives the engine, the model and the level each came from.
  - The capability check runs at every level. A refusal names the Roles and Projects.
  - Commit.

  Read: the State; `people/MAP.md`, `projects/MAP.md`; `people/application/role-service.ts` (card checks by symbol); `people/domain/presets.ts`; `projects/` application service and schema by symbol; `packages/contracts/src/people.ts`, `projects.ts`.
- [ ] 2b. Sessions on the cascade, and no Stage model, in Conversations, Pipelines and Work, about 110k:
  - `thread-runner.ts`, `stage-threads.ts`, `thread-contexts.ts` and `thread-changes.ts` take the engine and model from `EngineCascade`, with the Thread's Project.
  - The Stage's `model` is dropped from the contract, the Planner's tools and saved Stage lists (migration).
  - `usage-estimate.ts` uses the cascade per Stage.
  - Commit.

  Read: the State; `conversations/MAP.md`; the `.engine` uses in those files (grep); `pipelines/MAP.md`; `packages/contracts/src/stages.ts` (`stageSchema`); `work/domain/usage-estimate.ts` l. 60–75.
- [ ] 2c. Web, the Role card, the Project page's Engine block and the Stage editor, about 110k:
  - The Role card's override, with "Office default", and what applies, from where, per Project.
  - The Project page's Engine block.
  - The Stage editor and the Task's Stage list drop Model.
  - e2e tests. Commit.

  Read: the State; `apps/web/src/surfaces/people/MAP.md`, `projects/MAP.md`; `apps/web/src/shell/role-card-words.ts`; the Stage editor (grep `model` in `surfaces/projects` and `surfaces/work`); `apps/web/e2e/MAP.md`.
- [ ] 3a. Removing an engine, in Engine, People and Projects, about 90k:
  - `DELETE /settings/engines/:id` with a replacement id, or none when it is the only engine. It moves every reference, falls back to the replacement's default model, and refuses a replacement that fails the capability check.
  - With no engine, starting a session is refused with words.
  - Running sessions finish, and their Threads start fresh.
  - Commit.

  Read: the State; `engine/application/engine-settings-service.ts`; `engine/application/engine-sessions.ts` (start, by symbol); the cascade from 2a; `conversations/domain/context-policy.ts` l. 120–145.
- [ ] 3b. Web, the remove dialog, about 50k: pick the replacement, list what moves, and warn when it is the only engine. e2e test. Commit.

  Read: the State; `settings/engines/engines-section.tsx`; `apps/web/e2e/MAP.md`.
- [ ] 4. The live check on the Test Project, about 60k. The user signs in two Claude accounts at the browser. Run it on Haiku, covering the Definition of Done's live points. Re-run the engine check's `skills.user-scope` under an engine's folder and update `engine-check.md`. Commit.

  Read: the State; [the Test Project](test-project.md); [testing](../../apps/service/docs/testing.md), live checks; `apps/service/test/live-check.ts`; `docs/engine-check.md` (`skills.user-scope`).
- [ ] 5. Close: tick the Definition of Done with each check run, run `npm run verify:linux`, archive the log, and set the task to done. Small.

## State

Step 0 is done. Spec, glossary and coverage are amended, and the user's answers of 2026-11-02 are recorded above.

Next is step 1a. Today the engines are fixed kinds:
- `ENGINES` and `engineIdOf` in `engine/domain/engines.ts`;
- `engineIdSchema` in `packages/contracts/src/engines.ts`;
- the Role card's `engine` and `model` in `packages/contracts/src/people.ts`;
- the Stage's optional `model` in `stages.ts`.

The pinned binary (2.1.310) has `claude auth login` (`--claudeai` by default, `--console`, `--sso`, `--email`) and `claude auth status --json` (`loggedIn`, `email`, `subscriptionType`, `configDirectory`).

Traps:
- Between steps, `npm run verify` must pass. 1a's mapping of kinds to ids is replaced by 2a's clearing, so keep it in the migration and nowhere else.
- `windows.ts` and `linux.ts` keep `~/.claude/.credentials.json` as a secret path. Keep it.

## Progress

- 2026-11-02 · step 0: task file written with the user's answers; spec, glossary, coverage and README amended; next is 1a, engines as rows.
