import { Module } from "@nestjs/common";
import { AgentSdkEngine } from "./adapters/agent-sdk/agent-sdk-engine.js";
import { EngineSessions } from "./application/engine-sessions.js";
import { UsageWindowState } from "./application/usage-window-state.js";
import { AgentEngine } from "./ports/agent-engine.js";

@Module({
  providers: [{ provide: AgentEngine, useClass: AgentSdkEngine }, UsageWindowState, EngineSessions],
  exports: [EngineSessions, UsageWindowState],
})
export class EngineModule {}
