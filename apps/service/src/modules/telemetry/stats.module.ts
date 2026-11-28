import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { TelemetrySettingModule } from "../../platform/telemetry/telemetry-setting.module.js";
import { TelemetryOfficeActionsController } from "./adapters/http/telemetry-office-actions.controller.js";
import { TelemetrySettingsController } from "./adapters/http/telemetry-settings.controller.js";
import { TelemetryOfficeActions } from "./adapters/office-actions/telemetry-office-actions.js";
import { StatsController } from "./adapters/http/stats.controller.js";
import { SettingsGrafanaInUse } from "./adapters/platform/settings-grafana-in-use.js";
import { BasicStats } from "./application/basic-stats.js";
import { FullStats } from "./application/full-stats.js";
import { GrafanaCheck } from "./application/grafana-check.js";
import { SystemHealth } from "./application/system-health.js";
import { BrowserConnections } from "./ports/browser-connections.js";
import { DayTokens } from "./ports/day-tokens.js";
import { EngineWindows } from "./ports/engine-windows.js";
import { GrafanaInUse } from "./ports/grafana-in-use.js";
import { HealthReadings } from "./ports/health-readings.js";
import { OfficeInitiatives } from "./ports/office-initiatives.js";
import { OfficeTasks } from "./ports/office-tasks.js";
import { ProjectNames } from "./ports/project-names.js";
import { RunningStageRuns } from "./ports/running-stage-runs.js";
import { SessionsRunning } from "./ports/sessions-running.js";
import { StageRunEngines } from "./ports/stage-run-engines.js";
import { StageRunTotals } from "./ports/stage-run-totals.js";
import { StageRunsRunning } from "./ports/stage-runs-running.js";
import { StatsSource } from "./ports/stats-source.js";

export interface StatsModuleOptions {
  /**
   * The modules that provide the ports below but `statsSource`: Notifications, the Engine,
   * Pipelines, Work, Projects and Conversations; the System health recorder and the event stream
   * are global.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly dayTokens: Type<DayTokens>;
  readonly engineWindows: Type<EngineWindows>;
  readonly stageRunTotals: Type<StageRunTotals>;
  readonly runningStageRuns: Type<RunningStageRuns>;
  readonly stageRunEngines: Type<StageRunEngines>;
  readonly officeTasks: Type<OfficeTasks>;
  readonly officeInitiatives: Type<OfficeInitiatives>;
  readonly projectNames: Type<ProjectNames>;
  /** System health's 1 h: the platform's recorder of Health readings. */
  readonly healthReadings: Type<HealthReadings>;
  /** System health's Load now: Conversations, Pipelines and the event stream. */
  readonly sessionsRunning: Type<SessionsRunning>;
  readonly stageRunsRunning: Type<StageRunsRunning>;
  readonly browserConnections: Type<BrowserConnections>;
  /** Where the full stats' and System health's data is read, made here: Grafana's adapter, or a scripted one. */
  readonly statsSource: Type<StatsSource>;
}

/**
 * Stats (spec 2.11), owned by Telemetry: the basic stats, read from what other modules keep, the
 * full stats, read from the Grafana in use (Settings › Telemetry, `TelemetrySettingModule`, its routes `TelemetrySettingsController`), and
 * System health, read from the platform's Health readings and that Grafana, each through ports the
 * composition root binds. No module calls it, and it keeps no table.
 */
@Module({})
export class StatsModule {
  static register({
    imports,
    dayTokens,
    engineWindows,
    stageRunTotals,
    runningStageRuns,
    stageRunEngines,
    officeTasks,
    officeInitiatives,
    projectNames,
    healthReadings,
    sessionsRunning,
    stageRunsRunning,
    browserConnections,
    statsSource,
  }: StatsModuleOptions): DynamicModule {
    return {
      module: StatsModule,
      imports: [ScheduleModule, TelemetrySettingModule, ...imports],
      controllers: [StatsController, TelemetryOfficeActionsController, TelemetrySettingsController],
      providers: [
        { provide: DayTokens, useExisting: dayTokens },
        { provide: EngineWindows, useExisting: engineWindows },
        { provide: StageRunTotals, useExisting: stageRunTotals },
        { provide: RunningStageRuns, useExisting: runningStageRuns },
        { provide: StageRunEngines, useExisting: stageRunEngines },
        { provide: OfficeTasks, useExisting: officeTasks },
        { provide: OfficeInitiatives, useExisting: officeInitiatives },
        { provide: ProjectNames, useExisting: projectNames },
        { provide: HealthReadings, useExisting: healthReadings },
        { provide: SessionsRunning, useExisting: sessionsRunning },
        { provide: StageRunsRunning, useExisting: stageRunsRunning },
        { provide: BrowserConnections, useExisting: browserConnections },
        { provide: StatsSource, useClass: statsSource },
        { provide: GrafanaInUse, useClass: SettingsGrafanaInUse },
        BasicStats,
        FullStats,
        GrafanaCheck,
        TelemetryOfficeActions,
        SystemHealth,
      ],
    };
  }
}
