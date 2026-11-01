import { Module } from "@nestjs/common";
import { EngineModule } from "../engine/index.js";
import { PostgresStageRunRepository } from "./adapters/postgres/postgres-stage-run-repository.js";
import { UsageHistory } from "./application/usage-history.js";
import { StageRunRepository } from "./ports/stage-run-repository.js";

/**
 * The Stage runs' history alone, for Work's Usage estimates: the rest of Pipelines calls Work, so
 * Work must not import PipelinesModule. PipelinesModule writes its runs through the repository
 * exported here.
 */
@Module({
  imports: [EngineModule],
  providers: [{ provide: StageRunRepository, useClass: PostgresStageRunRepository }, UsageHistory],
  exports: [UsageHistory, StageRunRepository],
})
export class UsageHistoryModule {}
