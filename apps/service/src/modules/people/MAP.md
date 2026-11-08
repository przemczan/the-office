# People: module map

**Owns:** Roles hired from presets (Planner, Developer, Reviewer, CTO, Devops, Office Manager) or from scratch (keyed from the card's title by `roleKeyFor`, never a preset's key), Role cards and their versions (`roles`, `role_card_versions`), each version with who proposed it when the user applied a Proposal or an Agent changed it with `change_role` (`proposed_by`, "proposed by" in `GET /roles/:key/changes`), authority and Hard switches, Task limits, the Role override (`roleOverride`, an engine and model or none for the Office default; presets carry none); the engine cascade (`EngineCascade.of(roleKey, projectId?)`, the engine, model and level for a Role in a Project or in no Project, `domain/engine-cascade.ts`), and what the Role card says of it (`acrossProjects`, `GET /roles/:key/engine-cascade`: outside any Project, and the Projects where another engine or model applies), provided by `EngineCascadeModule.register({ imports, knownProjectLevels, projectLevelsSaves })` apart from `PeopleModule`; the capability check on the cascade's saves (`PipelineRoleCapabilityChecks`, pure `domain/pipeline-role-capabilities.ts`): a save that would newly put a Role a Pipeline names on an engine lacking `officeTools` or `outputSchema` is refused, naming the Roles and the Project, so far on a Project's levels only; each person's Memory (`memory_notes`, append-only notes, deleted one at a time or all); each person's Avatar (`application/person-avatars.ts`, `POST`/`DELETE /roles/:key/avatar` and `GET …/:imageId/content`; the file at `<office-data>/avatars/<image id>`, a new id for every upload, by the platform's `images/` rules, and the row's `avatar` jsonb holding its id and media type); the Office tools that read People, never changing it (`adapters/office-tools/`): `list_people`, and `read_role`, a Role's whole card, which a change by `propose_role` or `change_role` starts from, as each gives a field whole.

**Talks to:** calls Engine (profiles; the engines, and the models each offers now through `EngineModels`, which the card checks are handed: `roleCardProblems`, `hireFromScratch` and `changeRoleCard` take `ModelsOffered`, a lookup by engine from `EngineModels.modelsOffered`; the Office default from `EngineModels.officeDefault`; a removed engine's Role overrides moved by `RoleOverrideMoves` (to none with the only engine), registered in Engine's `EngineReferenceMoves` with `roleOverrideMovesOf` for the removal's preview (by Role key), each as the card's next version by the user with its history entry, a let-go Role's too, past the checks, which Engine's removal ran first) Skills (a Role's skills) and MCP servers (a Role's servers with their tools, `RoleMcpServers.byRole`/`serversOf`, listed on the card with each tool's setting from `mcp-tool-settings.ts`, Consult Devops when unset). Work and Pipelines read cards through their `KnownPeople` ports, bound to `RoleCards` in [app.module.ts](../../app.module.ts); Conversations reads them through the index, and applies Proposals of Roles through `RoleService` (`hireFromScratch`/`hire`/`changeCard` with `proposedBy`, and `change_role`'s held call through `reword`; `hiringProblems`/`presetHiringProblems`/`cardChangeProblems` judge one as it is drafted, saving nothing). Holds Engine's `EngineReferenceLock` over `changeCard`, `reword` and `hireFromScratch`, from reading the engines through the write, publishing after it is released, so an engine removed meanwhile is never named.

**Traps:** the card names no engine or model of its own, only `roleOverride`; history entries saved before task 47 step 2b2b still name the fields `engine` and `model` (`RoleCardField`, migration 0083 left them in `role_card_versions.changes`). Conversations' runners and Work's Usage estimate take the engine and model from `EngineCascade` (`of` throws Engine's `NoEngineListed` in words while no engine is listed, the cascade then giving none; `applying` gives none instead, for the Usage estimate and a Thread's context label), which tests that stand in for People replace with `EngineCascadeStandIn` (`index.fixtures.ts`). Projects' levels come through the `KnownProjectLevels` port, which [app.module.ts](../../app.module.ts) binds to `ProjectService`, and the capability check registers with Projects' saves through the `ProjectLevelsSaves` port, bound to Projects' `EngineLevelsChecks` registry (Projects can't ask People, which reads Projects); People never imports Projects. The same check (`PipelineRoleCapabilityChecks`, in `EngineCascadeModule`) registers with People's own `RoleOverrideChecks` (run by `RoleService`'s card saves, hires from scratch and `cardChangeProblems`, since `RoleService` sits in `PeopleModule` below the cascade) and with Engine's `EngineSettingsChecks` (Settings › Engines' saves; Engine never imports People); those two weigh outside any Project and every Project. The Roles Agent Stages name come from the registry `PipelineRoleSources` (exported by `EngineCascadeModule`), which Pipelines fills as it starts, since Pipelines reaches the cascade through Work: the library's Roles weigh everywhere, an open Task's own Stages' only in its Project (pure `domain/pipeline-roles-named.ts`); each place weighs its own Roles. The other way round, Pipelines asks the check about the Roles a save of Stages newly names (`newlyNamedRolesProblems`, exported by `EngineCascadeModule` and bound to Pipelines' `StageRoleEngines` port): the library's weighed everywhere, a Task's in its Project. a person let go keeps the Role's key (`letGoAt`), so nothing else can be hired into it until `hireBack`; `RoleCards.find` and `forResumedSession` treat them as not filling it, while `RoleService.read`/`list` still show them. A Role hired from a preset has the preset's fixed key, so only `adapters/http/roles.controller.test.ts` hires from the presets ([testing](../../../docs/testing.md)). The Caretaker (`CARETAKER`, `domain/caretaker.ts`) is built in: seeded by migration `0087_caretaker.sql` on every database, never hired from scratch into its key, never let go, in no preset; its card's capabilities, permission profile (edit, run, web; its MCP tool settings stay free), Hard switches and Task limit (none, so Pipelines' staffing check refuses it as talk-only) are fixed, checked in `roleCardProblems` (`builtInCardProblems`), so every save, Proposal and dry run refuses a change to them; the Role answers `builtIn` on the web. An Avatar sits on the Role's row, in no card version: `RoleRepository.changeAvatar` saves no version, `RoleAvatarChanged` reaches only the web, and the Caretaker's fixed card rules don't touch it. A file is written before the row names it and removed after the row stops naming it, as a Project's images. Someone let go can't change theirs (`changeAvatar` refuses).

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

RoleCards, Consultant, SessionRole, RoleService, EngineCascade, PipelineRoleCapabilityChecks, NewlyNamedRoles, PipelineRoleSources, PipelineRoleSource, PipelineRolesNamed, EngineCascadeLevel, EngineInCascade, ProjectCascadeLevels, MemoryService, RoleCardChanged, RoleHired, RoleHiredBack, RoleLetGo, hardSwitchInEffect, HARD_SWITCH_LABELS, HardSwitchKey, HardSwitchValue, CARETAKER, CTO, DEVOPS, OFFICE_MANAGER, mcpToolSettingsFor, narrowedMcpToolSetting, McpToolSettings, narrowedPermissionProfile, permissionNarrowingProblems, PermissionNarrowing, RoleCard, RoleNotFound, RoleRefused, PeopleModule, EngineCascadeModule

## Domain events

- `domain/role-events.ts`: RoleHired, RoleLetGo, RoleHiredBack, RoleMemoryChanged, RoleCardChanged, RoleAvatarChanged

## HTTP routes (under `/api`)

- `POST /roles/:key/avatar`: AvatarsController.change
- `DELETE /roles/:key/avatar`: AvatarsController.remove
- `GET /roles/:key/avatar/:imageId/content`: AvatarsController.content
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

- `adapters/postgres/memory.schema.ts`: memory_notes
- `adapters/postgres/roles.schema.ts`: roles, role_card_versions

## Files

### ./

- `engine-cascade.module.ts`: EngineCascadeModuleOptions, EngineCascadeModule
- `index.fixtures.ts`: EngineCascadeStandIn
- `people.module.ts`: PeopleModule

### adapters/http/

- `avatars.controller.ts`: AvatarsController
- `engine-cascade.controller.ts`: EngineCascadeController
- `memory.controller.ts`: MemoryController
- `role-refusals.filter.ts`: RoleRefusalsFilter
- `role-responses.ts`: filledKeys, toRoleResponse
- `roles.controller.ts`: RolesController
- Tests: avatars.controller.test.ts, engine-cascade.controller.test.ts, roles.controller.test.ts

### adapters/office-tools/

- `people-office-tools.ts`: LIST_PEOPLE, READ_ROLE, PeopleOfficeTools
- Tests: people-office-tools.test.ts

### adapters/postgres/

- `memory.schema.ts`: memoryNotes
- `postgres-memory-repository.ts`: PostgresMemoryRepository
- `postgres-role-repository.ts`: PostgresRoleRepository
- `roles.schema.ts`: roles, roleCardVersions
- Tests: postgres-memory-repository.test.ts, postgres-role-repository.test.ts

### adapters/websocket/

- `role-web-events.ts`: RoleWebEvents

### application/

- `engine-cascade.ts`: EngineCascade
- `memory-service.ts`: Memory, MemoryService
- `person-avatars.ts`: OpenedAvatar, PersonAvatars
- `pipeline-role-capability-checks.ts`: NewlyNamedRoles, PipelineRoleCapabilityChecks
- `pipeline-role-sources.ts`: PipelineRoleSource, PipelineRoleSources
- `role-cards.ts`: SessionRole, Consultant, RoleCards
- `role-history.ts`: RoleHistoryEntry, roleHistory
- `role-override-checks.ts`: RoleOverrideSave, RoleOverrideCheck, RoleOverrideChecks
- `role-override-moves.ts`: RoleOverrideMoves
- `role-service.ts`: RoleWithAssignments, RoleCardOptions, RoleService
- Tests: engine-cascade.test.ts, memory-service.test.ts, person-avatars.test.ts, pipeline-role-capability-checks.test.ts, role-cards.test.ts, role-override-engine-removal.test.ts

### domain/

- `avatar.ts`: AvatarMediaType, Avatar, AvatarNotFound
- `caretaker.ts`: CARETAKER_FIXED_PARTS, isBuiltIn, builtInCardProblems
- `engine-cascade.ts`: ENGINE_CASCADE_LEVELS, EngineCascadeLevel, EngineInCascade, ProjectCascadeLevels, movedProjectLevels, EngineCascadeLevels, engineInCascade, ProjectWithCascadeLevels, RoleEngineCascade, roleEngineCascade
- `hard-switches.ts`: HARD_SWITCH_KEYS, HardSwitchKey, HARD_SWITCH_LABELS, HardSwitchEnforcement, HARD_SWITCH_ENFORCEMENT, HardSwitchValue, HardSwitches, ALLOWED, ASK_ME, NEVER, consult, hardSwitchesProblems, hardSwitchInEffect, switchesAskingYouUntilHired, sameHardSwitchValue
- `known-roles.ts`: OFFICE_MANAGER, CTO, DEVOPS, CARETAKER, KNOWN_ROLES
- `mcp-tool-settings.ts`: McpToolSettings, MCP_TOOL_DEFAULT, mcpToolKey, mcpToolSetting, mcpToolSettingsFor, mcpToolSettingsProblems, noWiderThan, narrowedMcpToolSetting
- `memory-note-not-found.ts`: MemoryNoteNotFound
- `memory-note.ts`: MEMORY_NOTE_LENGTH, MemoryNoteSource, MemoryNote, MemoryNoteDraft, writeMemoryNote
- `permission-profile.ts`: RUN_PERMISSIONS, RunPermission, PermissionProfile, PermissionNarrowing, narrowedPermissionProfile, permissionNarrowingProblems
- `pipeline-role-capabilities.ts`: PIPELINE_ROLE_CAPABILITIES, PipelineRoleCapability, PipelineRole, RoleOnIncapableEngine, rolesOnIncapableEngines, newlyOnIncapableEngines, IncapableEngineNames, incapableEngineProblems
- `pipeline-roles-named.ts`: PipelineRolesNamed, NO_PIPELINE_ROLES, rolesNamedIn, rolesNamedAnywhere, rolesNamedWhere, onlyRole, mergedRolesNamed
- `presets.ts`: Preset, PRESETS, presetFor
- `role-card-changes.ts`: RoleCardField, RoleCardValue, RoleCardFieldChange, roleCardChanges
- `role-card-version-not-found.ts`: RoleCardVersionNotFound
- `role-card.ts`: EFFORTS, Effort, SESSION_DEFAULTS, SessionDefault, Capabilities, RoleCard, NAME_LENGTH, TITLE_LENGTH, RESPONSIBILITIES_LENGTH, INSTRUCTIONS_LENGTH, trimmedRoleCard, ModelsOffered, roleCardProblems, personNameProblems
- `role-changes.ts`: RoleChange, hire, hireFromScratch, letGo, hireBack, changeRoleCard, moveRoleOverride, changeAvatar
- `role-events.ts`: RoleHired, RoleLetGo, RoleHiredBack, RoleMemoryChanged, RoleCardChanged, RoleAvatarChanged
- `role-key.ts`: roleKeyFor
- `role-not-found.ts`: RoleNotFound
- `role-refused.ts`: RoleRefused
- `role.fixtures.ts`: OFFERED_MODELS, aRoleCard, aRole
- `role.ts`: Role, RoleCardVersion
- `task-limit.ts`: TaskLimit, LOWEST_TASK_LIMIT, HIGHEST_TASK_LIMIT, taskLimitProblem
- Tests: caretaker.test.ts, engine-cascade.test.ts, hard-switches.test.ts, mcp-tool-settings.test.ts, memory-note.test.ts, permission-profile.test.ts, pipeline-role-capabilities.test.ts, presets.test.ts, role-card-changes.test.ts, role-card.test.ts, role-changes.test.ts, role-key.test.ts, task-limit.test.ts

### ports/

- `avatar-files.ts`: AvatarFiles
- `known-project-levels.ts`: KnownProjectLevels
- `memory-repository.ts`: MemoryRepository
- `project-levels-saves.ts`: ProjectLevelsSave, ProjectLevelsSaves
- `role-repository.ts`: RoleUpdate, RoleRepository
