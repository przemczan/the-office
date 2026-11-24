import { BusyWorkModule } from "../office-updates/index.js";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { Module, type DynamicModule } from "@nestjs/common";
import type { ScriptedEngine } from "./adapters/scripted/scripted-engine.js";
import { NoLanguageServers } from "./adapters/scripted/no-language-servers.js";
import { PostgresDayUsage } from "./adapters/postgres/postgres-day-usage.js";
import { PostgresUsageWindowSamples } from "./adapters/postgres/postgres-usage-window-samples.js";
import { AgentEngines, type EngineAdapter } from "./application/agent-engines.js";
import { DayUsage } from "./application/day-usage.js";
import { EngineModelLists } from "./application/engine-model-lists.js";
import { EngineModelListsController } from "./adapters/http/engine-model-lists.controller.js";
import { PostgresModelLists } from "./adapters/postgres/postgres-model-lists.js";
import { ModelListRepository } from "./ports/model-list-repository.js";
import { EngineSessions } from "./application/engine-sessions.js";
import { OfficeToolRegistry } from "./application/office-tool-registry.js";
import { ChangedAccountUsage } from "./application/changed-account-usage.js";
import { RemovedEngineUsage } from "./application/removed-engine-usage.js";
import { UsageWindowSamples } from "./application/usage-window-samples.js";
import { UsageWindowChecks } from "./application/usage-window-checks.js";
import { WindowStarts } from "./application/window-starts.js";
import { UsageWindowReadings } from "./application/usage-window-readings.js";
import { UsageWindowState } from "./application/usage-window-state.js";
import { UsageWindowTelemetry } from "./application/usage-window-telemetry.js";
import { UsageWindowsNow } from "./application/usage-windows-now.js";
import { EngineSettingsModule } from "./engine-settings.module.js";
import { DayUsageRepository } from "./ports/day-usage-repository.js";
import { SessionLanguageServers } from "./ports/session-language-servers.js";
import { UsageWindowSampleRepository } from "./ports/usage-window-sample-repository.js";
import { AgentEngine } from "./ports/agent-engine.js";

/**
 * EngineModule's services on scripted engines, for other modules' tests: sessions replay
 * scripts, so they run without model calls (AGENTS.md, Project layout and defaults).
 */
@Module({})
export class ScriptedEngineModule {
  /**
   * One scripted engine stands in for every adapter, or each adapter has its own: a scripted one, or
   * an engine's own on a fake server (`apiEngineOnFakeServer`).
   */
  static register(
    engines: ScriptedEngine | Readonly<Record<EngineAdapter, AgentEngine>>,
  ): DynamicModule {
    return {
      module: ScriptedEngineModule,
      imports: [EngineSettingsModule, ScheduleModule, BusyWorkModule],
      controllers: [EngineModelListsController],
      providers: [
        { provide: AgentEngines, useValue: new AgentEngines(perEngine(engines)) },
        OfficeToolRegistry,
        UsageWindowState,
        { provide: DayUsageRepository, useClass: PostgresDayUsage },
        DayUsage,
        { provide: UsageWindowSampleRepository, useClass: PostgresUsageWindowSamples },
        UsageWindowSamples,
        UsageWindowReadings,
        UsageWindowChecks,
        { provide: ModelListRepository, useClass: PostgresModelLists },
        EngineModelLists,
        WindowStarts,
        RemovedEngineUsage,
        ChangedAccountUsage,
        UsageWindowTelemetry,
        UsageWindowsNow,
        { provide: SessionLanguageServers, useClass: NoLanguageServers },
        EngineSessions,
      ],
      exports: [
        EngineSessions,
        OfficeToolRegistry,
        UsageWindowState,
        UsageWindowSamples,
        UsageWindowsNow,
        DayUsage,
        EngineModelLists,
        EngineSettingsModule,
      ],
    };
  }
}

function perEngine(
  engines: ScriptedEngine | Readonly<Record<EngineAdapter, AgentEngine>>,
): Readonly<Record<EngineAdapter, AgentEngine>> {
  if (!(engines instanceof AgentEngine)) return engines;
  return {
    "agent-sdk": engines,
    "claude-code-p": engines,
    "openai-compatible-api": engines,
    codex: engines,
    "copilot-cli": engines,
    "gemini-cli": engines,
  };
}
