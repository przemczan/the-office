import { Module } from "@nestjs/common";
import { EngineSettingsController } from "./adapters/http/engine-settings.controller.js";
import { PostgresEngineSettings } from "./adapters/postgres/postgres-engine-settings.js";
import { PostgresWindowStarts } from "./adapters/postgres/postgres-window-starts.js";
import { EngineModels } from "./application/engine-models.js";
import { EngineReferenceLock } from "./application/engine-reference-lock.js";
import { EngineReferenceMoves } from "./application/engine-reference-moves.js";
import { EngineSettingsChecks } from "./application/engine-settings-checks.js";
import { EngineSettingsService } from "./application/engine-settings-service.js";
import { ModelPrices } from "./application/model-prices.js";
import { NextWindowStarts } from "./application/next-window-starts.js";
import { RunningEngineSessions } from "./application/running-engine-sessions.js";
import { StaleModelLists } from "./application/stale-model-lists.js";
import { EngineSettingsRepository } from "./ports/engine-settings-repository.js";
import { WindowStartRepository } from "./ports/window-start-repository.js";

/**
 * The engines' Office-wide settings, the models they make each engine offer and what tokens on
 * them cost (`ModelPrices`), and the sessions running on each (`RunningEngineSessions`), one count
 * for both the sessions and the accounts. Both `EngineModule` and `ScriptedEngineModule` hold it, so a test on
 * scripted engines keeps them; the OpenAI-compatible API engine reads its API endpoints, keys included, from the repository.
 * Each engine's Window start is kept beside them (`WindowStartRepository`), as a removal deletes it
 * with the engine, and its next start (`NextWindowStarts`), which the scheduler keeps. Showing the
 * models asks for the stale model lists (`StaleModelLists`), which `EngineModelLists` registers.
 */
@Module({
  controllers: [EngineSettingsController],
  providers: [
    { provide: EngineSettingsRepository, useClass: PostgresEngineSettings },
    { provide: WindowStartRepository, useClass: PostgresWindowStarts },
    EngineSettingsService,
    EngineSettingsChecks,
    EngineReferenceMoves,
    EngineReferenceLock,
    EngineModels,
    ModelPrices,
    RunningEngineSessions,
    NextWindowStarts,
    StaleModelLists,
  ],
  exports: [
    EngineSettingsService,
    EngineSettingsChecks,
    EngineReferenceMoves,
    EngineReferenceLock,
    EngineModels,
    ModelPrices,
    EngineSettingsRepository,
    WindowStartRepository,
    RunningEngineSessions,
    NextWindowStarts,
    StaleModelLists,
  ],
})
export class EngineSettingsModule {}
