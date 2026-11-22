# People: module map

**Owns:** Roles hired from presets (Planner, Developer, Reviewer, CTO, Devops, Office Manager) or from scratch (keyed from the card's title by `roleKeyFor`, never a preset's key), Role cards and their versions (`roles`, `role_card_versions`), each version with who proposed it when the user applied a Proposal or an Agent changed it with `change_role` (`proposed_by`, "proposed by" in `GET /roles/:key/changes`) and the user who saved it, hired the person or applied the Proposal (`saved_by`, a `{ userId, name }` snapshot, `savedBy` in the history; none for `change_role` or an engine's removal), authority and Hard switches, Task limits, the capabilities (Shared memory, Chat, Consultant, Run environment: the presets set them, Run environment on for Developer and Devops, off and fixed for the Caretaker; migration 0111 gave every stored card and Role Proposal the field, on for the Roles keyed `developer` and `devops`), the Role override (`roleOverride`, an engine and model or none for the Office default; presets carry none); the engine cascade (`EngineCascade.of(roleKey, { projectId?, taskId?, initiativeId? })`, the engine, model and level for a Role in a Project or in no Project, about a Task or an Initiative, whose Task's engine and Initiative's engine take the Project default's place, `domain/engine-cascade.ts`), and what the Role card says of it (`acrossProjects`, `GET /roles/:key/engine-cascade`: outside any Project, and the Projects where another engine or model applies), provided by `EngineCascadeModule.register({ imports, knownProjectLevels, knownWorkLevels, projectLevelsSaves })` apart from `PeopleModule`; the capability check on the cascade's saves (`PipelineRoleCapabilityChecks`, pure `domain/pipeline-role-capabilities.ts`): a save that would newly put a Role a Pipeline names on an engine lacking `officeTools` or `outputSchema` is refused, naming the Roles and the Project, so far on a Project's levels only; each person's Memory (`memory_notes`, append-only notes, deleted one at a time or all, each by the signed-in user on the Memory tab, `{ kind: "user", user }`, or by an Agent with `remember`); each person's Avatar (`application/person-avatars.ts`, `POST`/`DELETE /roles/:key/avatar` and `GET …/:imageId/content`; the file at `<office-data>/avatars/<image id>`, a new id for every upload, by the platform's `images/` rules, and the row's `avatar` jsonb holding its id and media type); the Office tools that read People, never changing it (`adapters/office-tools/`): `list_people`, each person's short record from `PersonRecords`, which Conversations also gives for a person's Open page, and `read_role`, a Role's whole card, which a change by `propose_role` or `change_role` starts from, as each gives a field whole. The duties (spec §2.2, "Duties", "Who holds a duty"): the eight built-in jobs in `domain/duties.ts` (`DUTIES`, each with its default Role key and fallback, the user, the Caretaker or unstaffed), the user's setting of each to a hired Role or none (`duty_assignments`, a row only for a duty set; a missing row is the default key), and `Duties` (`application/duties.ts`): the list, `holderOf`, `heldBy`, a dry run (`changeProblems`), `change` and the all-or-nothing `changeAll` refused once a duty names another Role than its `from`, each change through the `DutyChangeChecks` registry other modules fill, and where an MCP tool never set starts (`mcpToolDefault`: consulting the holder of Default Consultant for MCP tool hard switches, Ask me while nobody holds it or the holder's Consultant is off); `GET /settings/duties` and `PUT /settings/duties/:duty`. A Hard switch or an MCP tool may consult any preset key or any Role hired from scratch, never the Caretaker (`consultableRoleKeys`, `presets.ts`); `roleCardProblems` takes them, with who holds the MCP duty, as `RoleCardContext`. `list_people` says the duties each person holds and the duties nobody holds with their fallbacks. Setting up an Office (spec §2.2, "Setting up an Office with nobody hired"): `OfficeSetup` (`application/office-setup.ts`, pure rules in `domain/office-setup.ts`) judges several hires (`SetUpHire`, from a preset or from scratch, each as hiring it alone is, via `RoleService.hiring`, two into one key refused) and duty changes (`SetUpDuty`, by `Duties.weighedWithHires`, counting the hires as hired, so a duty may name a Role the same set-up hires; one naming the Role it goes to already refused) and saves them all or none through `OfficeSetupRepository` (one Postgres transaction over `roles`, `role_card_versions` and `duty_assignments`), under Engine's `EngineReferenceLock`, publishing `RoleHired` and `DutyHolderChanged` after. A hire's key is known before it exists (`hiredKeyOf`). The presets answer the duties each suits (`dutiesSuitedTo`, from `DUTIES`' defaults; `GET /presets`' `duties`). `RoleCards.hiredPeople` lists everyone filling a Role now, the Caretaker included, oldest hire first (a hire back keeps `hiredAt`), for Conversations' Live view.

**Talks to:** calls Engine (profiles; the engines, and the models each offers now through `EngineModels`, which the card checks are handed: `roleCardProblems`, `hireFromScratch` and `changeRoleCard` take `ModelsOffered` in their `RoleCardContext`, a lookup by engine from `EngineModels.modelsOffered`; the Office default from `EngineModels.officeDefault`; a removed engine's Role overrides moved by `RoleOverrideMoves` (to none with the only engine), registered in Engine's `EngineReferenceMoves` with `roleOverrideMovesOf` for the removal's preview (by Role key), each as the card's next version by the user with its history entry, a let-go Role's too, past the checks, which Engine's removal ran first) Skills (a Role's skills) and MCP servers (a Role's servers with their tools, `RoleMcpServers.byRole`/`serversOf`, listed on the card with each tool's setting from `mcp-tool-settings.ts`, at `mcpToolDefault` when unset). Work and Pipelines read cards through their `KnownPeople` ports, bound to `RoleCards` in [app.module.ts](../../app.module.ts); Conversations reads them through the index, and applies Proposals of Roles through `RoleService` (`hireFromScratch`/`hire`/`changeCard` with the user who applied it and `proposedBy`, and `change_role`'s held call through `reword`; `hiringProblems`/`presetHiringProblems`/`cardChangeProblems` judge one as it is drafted, saving nothing). Holds Engine's `EngineReferenceLock` over `changeCard`, `reword` and `hireFromScratch`, from reading the engines through the write, publishing after it is released, so an engine removed meanwhile is never named. Work, Pipelines and Notifications ask who holds a duty through `holderOf` on their `KnownPeople` ports (`RoleCards.holderOf`), and Work and Pipelines every duty's holder at once through `dutyHolders` (`RoleCards.dutyHolders`, `Duties.holders`), for Stages naming several duties; Pipelines' Stage editor asks `RoleCards.permissionNarrowingProblems`, which weighs a Stage's MCP tools as a card's. A session's `SessionRole` carries `mcpToolDefault`, read as it starts or resumes, which Conversations' runners and Pipelines' Agent Stages pass to `mcpToolSettingsFor` and `narrowedPermissionProfile`. `GET /roles/:key/memory` names each note written on a Task by that Task's title (`taskTitle`, absent once the Task is gone), all the notes' Tasks read in one call through `MemoryTaskTitles`, which Work fills as it starts (`MemoryTaskTitleSourceFromWork`), as Work calls People; a test booting Work without People provides it (`WorkPortsForTestsModule`).

**Traps:** the card names no engine or model of its own, only `roleOverride`; Role card versions saved by older releases still name the fields `engine` and `model` (`RoleCardField`, migration 0083 left them in `role_card_versions.changes`). Conversations' runners and Work's Usage estimate take the engine and model from `EngineCascade` (`of` throws Engine's `NoEngineListed` in words while no engine is listed, the cascade then giving none; `applying` gives none instead, for the Usage estimate and a Thread's context label), which tests that stand in for People replace with `EngineCascadeStandIn` (`index.fixtures.ts`). Projects' levels come through the `KnownProjectLevels` port, which [app.module.ts](../../app.module.ts) binds to `ProjectService`, and the capability check registers with Projects' saves through the `ProjectLevelsSaves` port, bound to Projects' `EngineLevelsChecks` registry (Projects can't ask People, which reads Projects); People never imports Projects. A Task's and an Initiative's engines come the same way through the `KnownWorkLevels` port, bound to Work's `WorkEngineLevels` in its own `WorkEngineLevelsModule` (Work imports the cascade, so the cascade can't import `WorkModule`); Work resolves a Task's Initiative, People knows Initiatives only by id. The capability check weighs a change of Tasks' engines, or of the Pipeline a Task follows (`WorkLevelsMove.namedBefore`, whom its Stages named before), through `workLevelsChangeProblems`, which Pipelines calls from Work's `TaskEngineChecks` registry, and a Task's Stage edit at the Task's levels when it or its Initiative sets an engine (`newlyNamedRolesProblems`' `task`). The same check (`PipelineRoleCapabilityChecks`, in `EngineCascadeModule`) registers with People's own `RoleOverrideChecks` (run by `RoleService`'s card saves, hires from scratch and `cardChangeProblems`, since `RoleService` sits in `PeopleModule` below the cascade) and with Engine's `EngineSettingsChecks` (Settings › Engines' saves; Engine never imports People); those two weigh outside any Project and every Project. The Roles Agent Stages name come from the registry `PipelineRoleSources` (exported by `EngineCascadeModule`), which Pipelines fills as it starts, since Pipelines reaches the cascade through Work: the library's Roles weigh everywhere, an open Task's own Stages' only in its Project (pure `domain/pipeline-roles-named.ts`); each place weighs its own Roles. The other way round, Pipelines asks the check about the Roles a save of Stages newly names (`newlyNamedRolesProblems`, exported by `EngineCascadeModule` and bound to Pipelines' `StageRoleEngines` port): the library's weighed everywhere, a Task's in its Project. Stages may name a duty instead of a Role (Pipelines' `stageWorker`): the sources report duties apart (`PipelineRolesNamed.duties`, `NewlyNamedRoles.dutyKeys`), and the check weighs each by its holder's Role (`withDutiesResolved` with `Duties.holders`; a duty nobody holds names no Role). The check also registers with `DutyChangeChecks`, refusing a holder change that would put a duty some Pipeline names on an incapable engine (`dutyChangeProblems`). A person let go keeps the Role's key (`letGoAt`), so nothing else can be hired into it until `hireBack`; `RoleCards.find` and `forResumedSession` treat them as not filling it, while `RoleService.read`/`list` still show them. A Role hired from a preset has the preset's fixed key, so only `adapters/http/roles.controller.test.ts` hires from the presets ([testing](../../../docs/testing.md)). The Caretaker (`CARETAKER`, `domain/caretaker.ts`) is built in: seeded by migration `0087_caretaker.sql` on every database, never hired from scratch into its key, never let go, in no preset; its card's capabilities, permission profile (edit, run, web; its MCP tool settings stay free), Hard switches and Task limit (none, so Pipelines' staffing check refuses it as talk-only) are fixed, checked in `roleCardProblems` (`builtInCardProblems`), so every save, Proposal and dry run refuses a change to them; the Role answers `builtIn` on the web. Records from before users existed name the first user once made (`PeopleEarlierRecords`, registered with the platform's `EarlierRecords`): migration 0143 left their user jsonb null (`saved_by`, a user note's `source.user`), which the claim rewrites, while a version no user saved is SQL null and stays so; the Caretaker's seeded first version names nobody. An Avatar sits on the Role's row, in no card version: `RoleRepository.changeAvatar` saves no version, `RoleAvatarChanged` reaches only the web, and the Caretaker's fixed card rules don't touch it. A file is written before the row names it and removed after the row stops naming it, as a Project's images. Someone let go can't change theirs (`changeAvatar` refuses). A duty names a Role key, hired or not: a holder let go or never hired counts as nobody and the fallback applies, hiring the key back restores it, and a rename changes nothing. `DutyHolderChanged` is published only when the user sets a duty to another Role key or none; hiring, letting go and hiring back change who holds a duty in effect without it, so a subscriber that cares hears `RoleHired`, `RoleLetGo` and `RoleHiredBack` too (the web refreshes the duties on each). `OfficeSetupRepository`'s Postgres adapter writes `duty_assignments` too, so a test that applies a set-up binds `OfficeSetupRepositoryForTests` over its own repositories (`index.fixtures.ts`), and one that hires presets keeps its Roles in memory (`application/office-setup.full.test.ts`). Every test file shares `duty_assignments`, and a stored duty changes who every file's sessions consult: tests set duties on `DutyRepositoryForTests` (`ports/duty-repository.fixtures.ts`, `dutiesOver` in `application/duties.fixtures.ts`), and the Postgres repository's test rolls its transaction back. Stand-ins for `SessionRole` in other modules' tests give `MCP_TOOL_DEFAULT_STAND_IN` (`index.fixtures.ts`). The MCP tool default follows the duty, so with Devops not hired an unset tool reads Ask me, not Consult Devops. `PostgresRoleRepository`'s and `PostgresDutyRepository`'s reads go through the platform's read scope (`readOnce`, platform MAP): within one GET they answer the same objects to every caller, who never changes them, and every write of their tables runs through `forgettingReads`, a new writer too.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

RoleCards, Consultant, HiredPerson, SessionRole, RoleService, PersonRecords, Duties, DutyChange, DutyWithHolder, DutyRefused, OfficeSetup, hiredKeyOf, SetUpDuty, SetUpHire, dutiesSuitedTo, DutyChangeChecks, DutyChangeCheck, DutyHolderSave, DUTIES, DutyHolding, DutyKey, DutyHolderChanged, EngineCascade, EngineCascadeLocation, KnownWorkLevels, TaskOnWorkLevels, WorkLevelsOf, PipelineRoleCapabilityChecks, NewlyNamedRoles, PipelineRoleSources, PipelineRoleSource, TaskRoleSource, PipelineRolesNamed, EngineCascadeLevel, EngineInCascade, ProjectCascadeLevels, WorkCascadeLevels, MemoryService, MemoryTaskTitles, MemoryTaskTitleSource, RoleCardChanged, RoleHired, RoleHiredBack, RoleLetGo, hardSwitchInEffect, HARD_SWITCH_LABELS, HardSwitchKey, HardSwitchValue, CARETAKER, mcpToolSettingsFor, narrowedMcpToolSetting, McpToolSettings, narrowedPermissionProfile, permissionNarrowingProblems, PermissionNarrowing, RoleCard, RoleNotFound, RoleRefused, PeopleModule, EngineCascadeModule

## Domain events

- `domain/duty-events.ts`: DutyHolderChanged
- `domain/role-events.ts`: RoleHired, RoleLetGo, RoleHiredBack, RoleMemoryChanged, RoleCardChanged, RoleAvatarChanged

## HTTP routes (under `/api`)

- `POST /roles/:key/avatar`: AvatarsController.change
- `DELETE /roles/:key/avatar`: AvatarsController.remove
- `GET /roles/:key/avatar/:imageId/content`: AvatarsController.content
- `GET /settings/duties`: DutiesController.list
- `PUT /settings/duties/:duty`: DutiesController.change
- `GET /roles/:key/engine-cascade`: EngineCascadeController.ofRole
- `GET /roles/:key/memory`: MemoryController.read
- `POST /roles/:key/memory`: MemoryController.write
- `DELETE /roles/:key/memory/:noteId`: MemoryController.remove
- `DELETE /roles/:key/memory`: MemoryController.clear
- `GET /presets`: RolesController.presets
- `GET /role-card-options`: RolesController.cardOptions
- `POST /roles`: RolesController.hire
- `GET /roles`: RolesController.list
- `GET /roles/:key`: RolesController.read
- `PUT /roles/:key/card`: RolesController.changeCard
- `POST /roles/:key/let-go`: RolesController.letGo
- `POST /roles/:key/hire-back`: RolesController.hireBack
- `GET /roles/:key/changes`: RolesController.history

## Tables

- `adapters/postgres/duties.schema.ts`: duty_assignments
- `adapters/postgres/memory.schema.ts`: memory_notes
- `adapters/postgres/roles.schema.ts`: roles, role_card_versions

## Files

### ./

- `engine-cascade.module.ts`: EngineCascadeModuleOptions, EngineCascadeModule
- `index.fixtures.ts`: MCP_TOOL_DEFAULT_STAND_IN, EngineCascadeStandIn, DutyRepository, WorkLevelsForTests, WorkLevelsForTestsModule, DutyRepositoryForTests, OfficeSetupRepository, RoleRepository, OfficeSetupRepositoryForTests, aRole
- `people.module.ts`: PeopleModule

### adapters/http/

- `avatars.controller.fixtures.ts`: PNG, SVG_WITH_A_SCRIPT, expectRefused
- `avatars.controller.ts`: AvatarsController
- `duties.controller.ts`: DutiesController
- `engine-cascade.controller.ts`: EngineCascadeController
- `memory.controller.ts`: MemoryController
- `role-refusals.filter.ts`: RoleRefusalsFilter
- `role-responses.ts`: RoleResponseContext, roleResponseContext, toRoleResponse
- `roles.controller.ts`: RolesController
- Tests: avatars.controller.full.test.ts, avatars.controller.test.ts, duties.controller.test.ts, engine-cascade.controller.test.ts, roles.controller.test.ts

### adapters/office-tools/

- `people-office-tools.fixtures.ts`: toolsOver
- `people-office-tools.ts`: LIST_PEOPLE, READ_ROLE, PeopleOfficeTools
- Tests: people-office-tools.full.test.ts, people-office-tools.test.ts

### adapters/postgres/

- `duties.schema.ts`: dutyAssignments
- `memory.schema.ts`: memoryNotes
- `people-earlier-records.ts`: PeopleEarlierRecords
- `postgres-duty-repository.ts`: PostgresDutyRepository, assignDuties
- `postgres-memory-repository.ts`: PostgresMemoryRepository
- `postgres-office-setup-repository.ts`: PostgresOfficeSetupRepository
- `postgres-role-repository.ts`: Transaction, PostgresRoleRepository, addRole
- `roles.schema.ts`: roles, roleCardVersions
- Tests: people-earlier-records.test.ts, postgres-duty-repository.test.ts, postgres-memory-repository.full.test.ts, postgres-memory-repository.test.ts, postgres-office-setup-repository.test.ts, postgres-role-repository.full.test.ts, postgres-role-repository.test.ts, run-environment-capability-migration.test.ts

### adapters/websocket/

- `role-web-events.ts`: RoleWebEvents

### application/

- `duties.fixtures.ts`: dutiesOver
- `duties.ts`: DutyHolder, DutyWithHolder, DutyChange, WeighedDutyChanges, Duties
- `duty-change-checks.ts`: DutyHolderSave, DutyChangeCheck, DutyChangeChecks
- `engine-cascade.ts`: EngineCascadeLocation, EngineCascade
- `memory-service.ts`: Memory, MemoryService
- `memory-task-titles.ts`: MemoryTaskTitleSource, MemoryTaskTitles
- `office-setup.ts`: OfficeSetup
- `person-avatars.ts`: OpenedAvatar, PersonAvatars
- `person-records.ts`: PersonRecords
- `pipeline-role-capability-checks.ts`: NewlyNamedRoles, TaskStagesSave, WorkLevelsChange, WorkLevelsMove, PipelineRoleCapabilityChecks
- `pipeline-role-sources.ts`: PipelineRoleSource, TaskRoleSource, PipelineRoleSources
- `role-cards.ts`: SessionRole, Consultant, HiredPerson, RoleCards
- `role-history.ts`: RoleHistoryEntry, roleHistory
- `role-override-checks.ts`: RoleOverrideSave, RoleOverrideCheck, RoleOverrideChecks
- `role-override-moves.ts`: RoleOverrideMoves
- `role-service.ts`: RoleWithAssignments, RoleCardOptions, RoleService
- Tests: duties.full.test.ts, engine-cascade.full.test.ts, memory-service.full.test.ts, office-setup.full.test.ts, person-avatars.full.test.ts, person-records.full.test.ts, pipeline-role-capability-checks.full.test.ts, role-cards.full.test.ts, role-override-engine-removal.full.test.ts

### domain/

- `avatar.ts`: AvatarMediaType, Avatar, AvatarNotFound
- `caretaker.ts`: CARETAKER_FIXED_PARTS, isBuiltIn, builtInCardProblems
- `duties.ts`: DutyFallback, Duty, DUTIES, DutyKey, DutyAssignments, DutyHolding, isDutyKey, dutyFor, hiredKeysOf, dutyHolding, dutyHoldings, dutiesHeldBy, mcpToolDefault, dutyChangeProblems
- `duty-events.ts`: DutyHolderChanged
- `duty-refused.ts`: DutyRefused, DutyNotFound
- `engine-cascade.ts`: ENGINE_CASCADE_LEVELS, EngineCascadeLevel, EngineInCascade, ProjectCascadeLevels, movedProjectLevels, WorkCascadeLevels, NO_WORK_LEVELS, EngineCascadeLevels, engineInCascade, ProjectWithCascadeLevels, RoleEngineCascade, roleEngineCascade
- `hard-switches.ts`: HARD_SWITCH_KEYS, HardSwitchKey, HARD_SWITCH_LABELS, HardSwitchEnforcement, HARD_SWITCH_ENFORCEMENT, HardSwitchValue, HardSwitches, ALLOWED, ASK_ME, NEVER, consult, hardSwitchesProblems, hardSwitchInEffect, switchesAskingYouUntilHired, sameHardSwitchValue
- `known-roles.ts`: PLANNER, DEVELOPER, REVIEWER, CTO, DEVOPS, OFFICE_MANAGER, CARETAKER
- `mcp-tool-settings.ts`: McpToolSettings, mcpToolKey, mcpToolSetting, mcpToolSettingsFor, mcpToolSettingsProblems, noWiderThan, narrowedMcpToolSetting
- `memory-note-not-found.ts`: MemoryNoteNotFound
- `memory-note.ts`: MEMORY_NOTE_LENGTH, MemoryNoteSource, MemoryNote, MemoryNoteDraft, writeMemoryNote
- `office-setup.ts`: SetUpHire, SetUpDuty, hiredKeyOf, hireWords, setUpProblems
- `permission-profile.ts`: RUN_PERMISSIONS, RunPermission, PermissionProfile, PermissionNarrowing, narrowedPermissionProfile, PermissionNarrowingContext, permissionNarrowingProblems
- `pipeline-role-capabilities.ts`: PIPELINE_ROLE_CAPABILITIES, PipelineRoleCapability, PipelineRole, RoleOnIncapableEngine, rolesOnIncapableEngines, newlyOnIncapableEngines, eachRoleOnEngineOnce, IncapableEngineNames, incapableEngineProblems
- `pipeline-roles-named.ts`: NamedWhere, PipelineRolesNamed, RolesAndDuties, NO_PIPELINE_ROLES, withDutiesResolved, dutyNamedAnywhere, rolesNamedIn, rolesNamedAnywhere, namedWhere, onlyRole, mergedRolesNamed
- `presets.ts`: Preset, PRESETS, presetFor, consultableRoleKeys, dutiesSuitedTo, presetTitle
- `role-card-changes.ts`: RoleCardField, RoleCardValue, RoleCardFieldChange, roleCardChanges
- `role-card-version-not-found.ts`: RoleCardVersionNotFound
- `role-card.ts`: EFFORTS, Effort, SESSION_DEFAULTS, SessionDefault, Capabilities, RoleCard, NAME_LENGTH, TITLE_LENGTH, RESPONSIBILITIES_LENGTH, INSTRUCTIONS_LENGTH, trimmedRoleCard, ModelsOffered, RoleCardContext, roleCardProblems, personNameProblems
- `role-changes.ts`: RoleChange, hire, hireFromScratch, letGo, hireBack, changeRoleCard, moveRoleOverride, changeAvatar
- `role-events.ts`: RoleHired, RoleLetGo, RoleHiredBack, RoleMemoryChanged, RoleCardChanged, RoleAvatarChanged
- `role-key.ts`: roleKeyFor
- `role-not-found.ts`: RoleNotFound
- `role-refused.ts`: RoleRefused
- `role.fixtures.ts`: OFFERED_MODELS, CARD_CONTEXT, aRoleCard, aRole
- `role.ts`: Role, RoleCardVersion
- `task-limit.ts`: TaskLimit, LOWEST_TASK_LIMIT, HIGHEST_TASK_LIMIT, taskLimitProblem
- `user.fixtures.ts`: ANN_LEE, BEN_ITO
- `user.ts`: UserRef
- Tests: caretaker.full.test.ts, duties.full.test.ts, engine-cascade.full.test.ts, hard-switches.full.test.ts, mcp-tool-settings.full.test.ts, memory-note.full.test.ts, office-setup.full.test.ts, permission-profile.test.ts, pipeline-role-capabilities.full.test.ts, presets.full.test.ts, role-card-changes.full.test.ts, role-card.full.test.ts, role-changes.full.test.ts, role-key.full.test.ts, task-limit.full.test.ts

### ports/

- `avatar-files.ts`: AvatarFiles
- `duty-repository.fixtures.ts`: DutyRepositoryForTests
- `duty-repository.ts`: DutyAssignment, DutyRepository
- `known-project-levels.ts`: KnownProjectLevels
- `known-work-levels.fixtures.ts`: WorkLevelsForTests, WorkLevelsForTestsModule
- `known-work-levels.ts`: WorkLevelsOf, TaskOnWorkLevels, KnownWorkLevels
- `memory-repository.ts`: MemoryRepository
- `office-setup-repository.fixtures.ts`: OfficeSetupRepositoryForTests
- `office-setup-repository.ts`: OfficeSetupRepository
- `project-levels-saves.ts`: ProjectLevelsSave, ProjectLevelsSaves
- `role-repository.ts`: RoleUpdate, RoleRepository
