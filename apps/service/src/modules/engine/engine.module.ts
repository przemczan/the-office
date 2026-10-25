import { Module } from "@nestjs/common";
import { AgentSdkEngine } from "./adapters/agent-sdk/agent-sdk-engine.js";
import { EngineSessions } from "./application/engine-sessions.js";
import { OfficeToolRegistry } from "./application/office-tool-registry.js";
import { UsageWindowState } from "./application/usage-window-state.js";
import { AgentEngine } from "./ports/agent-engine.js";

@Module({
  providers: [
    { provide: AgentEngine, useClass: AgentSdkEngine },
    OfficeToolRegistry,
    UsageWindowState,
    EngineSessions,
  ],
  exports: [EngineSessions, OfficeToolRegistry, UsageWindowState],
})
export class EngineModule {}
