import { Module } from "@nestjs/common";
import { EngineModule } from "../engine/index.js";
import { PromptTemplatesModule } from "../prompt-templates/index.js";
import { PostgresStageRunRepository } from "./adapters/postgres/postgres-stage-run-repository.js";
import { PostgresTaskStagesRepository } from "./adapters/postgres/postgres-task-stages-repository.js";
import { RunningStageRuns } from "./application/running-stage-runs.js";
import { StageRunTotals } from "./application/stage-run-totals.js";
import { StageResultWords } from "./application/stage-result-words.js";
import { TaskGateRuns } from "./application/task-gate-runs.js";
import { UsageHistory } from "./application/usage-history.js";
import { StageRunRepository } from "./ports/stage-run-repository.js";
import { TaskStagesRepository } from "./ports/task-stages-repository.js";

/**
 * The Stage runs' history alone, for Work's Usage estimates, the Briefs of people's Threads on
 * Tasks and the Gate an Agent's Attachment is replaced until: the rest of Pipelines calls Work, so Work must not import PipelinesModule. PipelinesModule
 * writes its runs and each Task's Stages through the repositories exported here.
 */
@Module({
  imports: [EngineModule, PromptTemplatesModule],
  providers: [
    { provide: StageRunRepository, useClass: PostgresStageRunRepository },
    { provide: TaskStagesRepository, useClass: PostgresTaskStagesRepository },
    StageResultWords,
    TaskGateRuns,
    UsageHistory,
    StageRunTotals,
    RunningStageRuns,
  ],
  exports: [
    StageResultWords,
    TaskGateRuns,
    StageRunRepository,
    TaskStagesRepository,
    UsageHistory,
    StageRunTotals,
    RunningStageRuns,
  ],
})
export class UsageHistoryModule {}
