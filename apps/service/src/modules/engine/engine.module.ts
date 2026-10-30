import { Module } from "@nestjs/common";
import { AgentSdkEngine } from "./adapters/agent-sdk/agent-sdk-engine.js";
import { ClaudeCodePEngine } from "./adapters/claude-code-p/claude-code-p-engine.js";
import { AgentEngines } from "./application/agent-engines.js";
import { EngineSessions } from "./application/engine-sessions.js";
import { OfficeToolRegistry } from "./application/office-tool-registry.js";
import { UsageWindowState } from "./application/usage-window-state.js";

@Module({
  providers: [
    AgentSdkEngine,
    ClaudeCodePEngine,
    {
      provide: AgentEngines,
      useFactory: (agentSdk: AgentSdkEngine, claudeCodeP: ClaudeCodePEngine) =>
        new AgentEngines({ "agent-sdk": agentSdk, "claude-code-p": claudeCodeP }),
      inject: [AgentSdkEngine, ClaudeCodePEngine],
    },
    OfficeToolRegistry,
    UsageWindowState,
    EngineSessions,
  ],
  exports: [EngineSessions, OfficeToolRegistry, UsageWindowState],
})
export class EngineModule {}
