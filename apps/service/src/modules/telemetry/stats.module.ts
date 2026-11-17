import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { TelemetryHttpModule } from "../../platform/telemetry/telemetry-http.module.js";
import { StatsController } from "./adapters/http/stats.controller.js";
import { BundledGrafanaInUse } from "./adapters/platform/bundled-grafana-in-use.js";
import { BasicStats } from "./application/basic-stats.js";
import { FullStats } from "./application/full-stats.js";
import { DayTokens } from "./ports/day-tokens.js";
import { EngineWindows } from "./ports/engine-windows.js";
import { GrafanaInUse } from "./ports/grafana-in-use.js";
import { OfficeInitiatives } from "./ports/office-initiatives.js";
import { OfficeTasks } from "./ports/office-tasks.js";
import { ProjectNames } from "./ports/project-names.js";
import { RunningStageRuns } from "./ports/running-stage-runs.js";
import { StageRunTotals } from "./ports/stage-run-totals.js";
import { StatsSource } from "./ports/stats-source.js";

export interface StatsModuleOptions {
  /**
   * The modules that provide the ports below but `statsSource`: Notifications, the Engine,
   * Pipelines, Work and Projects.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly dayTokens: Type<DayTokens>;
  readonly engineWindows: Type<EngineWindows>;
  readonly stageRunTotals: Type<StageRunTotals>;
  readonly runningStageRuns: Type<RunningStageRuns>;
  readonly officeTasks: Type<OfficeTasks>;
  readonly officeInitiatives: Type<OfficeInitiatives>;
  readonly projectNames: Type<ProjectNames>;
  /** Where the full stats' data is read, made here: Grafana's adapter, or a scripted one. */
  readonly statsSource: Type<StatsSource>;
}

/**
 * Stats (spec 2.11), owned by Telemetry: the basic stats, read from what other modules keep, and
 * the full stats, read from the bundled Grafana (Settings › Telemetry, `TelemetryHttpModule`), each
 * through ports the composition root binds. No module calls it, and it keeps no table.
 */
@Module({})
export class StatsModule {
  static register({
    imports,
    dayTokens,
    engineWindows,
    stageRunTotals,
    runningStageRuns,
    officeTasks,
    officeInitiatives,
    projectNames,
    statsSource,
  }: StatsModuleOptions): DynamicModule {
    return {
      module: StatsModule,
      imports: [ScheduleModule, TelemetryHttpModule, ...imports],
      controllers: [StatsController],
      providers: [
        { provide: DayTokens, useExisting: dayTokens },
        { provide: EngineWindows, useExisting: engineWindows },
        { provide: StageRunTotals, useExisting: stageRunTotals },
        { provide: RunningStageRuns, useExisting: runningStageRuns },
        { provide: OfficeTasks, useExisting: officeTasks },
        { provide: OfficeInitiatives, useExisting: officeInitiatives },
        { provide: ProjectNames, useExisting: projectNames },
        { provide: StatsSource, useClass: statsSource },
        { provide: GrafanaInUse, useClass: BundledGrafanaInUse },
        BasicStats,
        FullStats,
      ],
    };
  }
}
