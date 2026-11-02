import { Module } from "@nestjs/common";
import { EngineSettingsController } from "./adapters/http/engine-settings.controller.js";
import { PostgresEngineSettings } from "./adapters/postgres/postgres-engine-settings.js";
import { EngineModels } from "./application/engine-models.js";
import { EngineReferenceLock } from "./application/engine-reference-lock.js";
import { EngineReferenceMoves } from "./application/engine-reference-moves.js";
import { EngineSettingsChecks } from "./application/engine-settings-checks.js";
import { EngineSettingsService } from "./application/engine-settings-service.js";
import { ModelPrices } from "./application/model-prices.js";
import { RunningEngineSessions } from "./application/running-engine-sessions.js";
import { EngineSettingsRepository } from "./ports/engine-settings-repository.js";

/**
 * The engines' Office-wide settings, the models they make each engine offer and what tokens on
 * them cost (`ModelPrices`), and the sessions running on each (`RunningEngineSessions`), one count
 * for both the sessions and the accounts. Both `EngineModule` and `ScriptedEngineModule` hold it, so a test on
 * scripted engines keeps them; the OpenAI-compatible API engine reads its API endpoints, keys included, from the repository.
 */
@Module({
  controllers: [EngineSettingsController],
  providers: [
    { provide: EngineSettingsRepository, useClass: PostgresEngineSettings },
    EngineSettingsService,
    EngineSettingsChecks,
    EngineReferenceMoves,
    EngineReferenceLock,
    EngineModels,
    ModelPrices,
    RunningEngineSessions,
  ],
  exports: [
    EngineSettingsService,
    EngineSettingsChecks,
    EngineReferenceMoves,
    EngineReferenceLock,
    EngineModels,
    ModelPrices,
    EngineSettingsRepository,
    RunningEngineSessions,
  ],
})
export class EngineSettingsModule {}
