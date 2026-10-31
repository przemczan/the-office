import { Module, type DynamicModule } from "@nestjs/common";
import type { ScriptedEngine } from "./adapters/scripted/scripted-engine.js";
import { AgentEngines } from "./application/agent-engines.js";
import { EngineSessions } from "./application/engine-sessions.js";
import { OfficeToolRegistry } from "./application/office-tool-registry.js";
import { UsageWindowState } from "./application/usage-window-state.js";
import type { Engine } from "./domain/engines.js";
import { EngineSettingsModule } from "./engine-settings.module.js";
import { AgentEngine } from "./ports/agent-engine.js";

/**
 * EngineModule's services on scripted engines, for other modules' tests: sessions replay
 * scripts, so they run without model calls (docs/tasks/build-defaults.md).
 */
@Module({})
export class ScriptedEngineModule {
  /** One scripted engine stands in for every engine, or each engine has its own. */
  static register(
    engines: ScriptedEngine | Readonly<Record<Engine, ScriptedEngine>>,
  ): DynamicModule {
    return {
      module: ScriptedEngineModule,
      imports: [EngineSettingsModule],
      providers: [
        { provide: AgentEngines, useValue: new AgentEngines(perEngine(engines)) },
        OfficeToolRegistry,
        UsageWindowState,
        EngineSessions,
      ],
      exports: [EngineSessions, OfficeToolRegistry, UsageWindowState, EngineSettingsModule],
    };
  }
}

function perEngine(
  engines: ScriptedEngine | Readonly<Record<Engine, ScriptedEngine>>,
): Readonly<Record<Engine, ScriptedEngine>> {
  if (!(engines instanceof AgentEngine)) return engines;
  return { "agent-sdk": engines, "claude-code-p": engines, "openai-compatible-api": engines };
}
