import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { Module, type DynamicModule } from "@nestjs/common";
import type { ScriptedEngine } from "./adapters/scripted/scripted-engine.js";
import { PostgresDayUsage } from "./adapters/postgres/postgres-day-usage.js";
import { PostgresUsageWindowSamples } from "./adapters/postgres/postgres-usage-window-samples.js";
import { AgentEngines, type EngineAdapter } from "./application/agent-engines.js";
import { DayUsage } from "./application/day-usage.js";
import { EngineSessions } from "./application/engine-sessions.js";
import { OfficeToolRegistry } from "./application/office-tool-registry.js";
import { UsageWindowSamples } from "./application/usage-window-samples.js";
import { UsageWindowState } from "./application/usage-window-state.js";
import { EngineSettingsModule } from "./engine-settings.module.js";
import { DayUsageRepository } from "./ports/day-usage-repository.js";
import { UsageWindowSampleRepository } from "./ports/usage-window-sample-repository.js";
import { AgentEngine } from "./ports/agent-engine.js";

/**
 * EngineModule's services on scripted engines, for other modules' tests: sessions replay
 * scripts, so they run without model calls (docs/tasks/build-defaults.md).
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
      imports: [EngineSettingsModule, ScheduleModule],
      providers: [
        { provide: AgentEngines, useValue: new AgentEngines(perEngine(engines)) },
        OfficeToolRegistry,
        UsageWindowState,
        { provide: DayUsageRepository, useClass: PostgresDayUsage },
        DayUsage,
        { provide: UsageWindowSampleRepository, useClass: PostgresUsageWindowSamples },
        UsageWindowSamples,
        EngineSessions,
      ],
      exports: [
        EngineSessions,
        OfficeToolRegistry,
        UsageWindowState,
        UsageWindowSamples,
        DayUsage,
        EngineSettingsModule,
      ],
    };
  }
}

function perEngine(
  engines: ScriptedEngine | Readonly<Record<EngineAdapter, AgentEngine>>,
): Readonly<Record<EngineAdapter, AgentEngine>> {
  if (!(engines instanceof AgentEngine)) return engines;
  return { "agent-sdk": engines, "claude-code-p": engines, "openai-compatible-api": engines };
}
