import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { StatsController } from "./adapters/http/stats.controller.js";
import { BasicStats } from "./application/basic-stats.js";
import { DayTokens } from "./ports/day-tokens.js";
import { EngineWindows } from "./ports/engine-windows.js";
import { OfficeTasks } from "./ports/office-tasks.js";
import { StageRunTotals } from "./ports/stage-run-totals.js";

export interface StatsModuleOptions {
  /** The modules that provide the ports below: Notifications, the Engine, Pipelines and Work. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly dayTokens: Type<DayTokens>;
  readonly engineWindows: Type<EngineWindows>;
  readonly stageRunTotals: Type<StageRunTotals>;
  readonly officeTasks: Type<OfficeTasks>;
}

/**
 * Stats (spec 2.11), owned by Telemetry: the basic stats, read from what other modules keep through
 * ports the composition root binds. No module calls it, and it keeps no table.
 */
@Module({})
export class StatsModule {
  static register({
    imports,
    dayTokens,
    engineWindows,
    stageRunTotals,
    officeTasks,
  }: StatsModuleOptions): DynamicModule {
    return {
      module: StatsModule,
      imports: [ScheduleModule, ...imports],
      controllers: [StatsController],
      providers: [
        { provide: DayTokens, useExisting: dayTokens },
        { provide: EngineWindows, useExisting: engineWindows },
        { provide: StageRunTotals, useExisting: stageRunTotals },
        { provide: OfficeTasks, useExisting: officeTasks },
        BasicStats,
      ],
    };
  }
}
