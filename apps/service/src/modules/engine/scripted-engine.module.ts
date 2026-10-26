import { Module, type DynamicModule } from "@nestjs/common";
import type { ScriptedEngine } from "./adapters/scripted/scripted-engine.js";
import { EngineSessions } from "./application/engine-sessions.js";
import { OfficeToolRegistry } from "./application/office-tool-registry.js";
import { UsageWindowState } from "./application/usage-window-state.js";
import { AgentEngine } from "./ports/agent-engine.js";

/**
 * EngineModule's services on a scripted engine, for other modules' tests: sessions replay
 * scripts, so they run without model calls (docs/tasks/build-defaults.md).
 */
@Module({})
export class ScriptedEngineModule {
  static register(engine: ScriptedEngine): DynamicModule {
    return {
      module: ScriptedEngineModule,
      providers: [
        { provide: AgentEngine, useValue: engine },
        OfficeToolRegistry,
        UsageWindowState,
        EngineSessions,
      ],
      exports: [EngineSessions, OfficeToolRegistry, UsageWindowState],
    };
  }
}
