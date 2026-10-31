import { Module } from "@nestjs/common";
import { AgentSdkEngine } from "./adapters/agent-sdk/agent-sdk-engine.js";
import { ClaudeCodePEngine } from "./adapters/claude-code-p/claude-code-p-engine.js";
import { SessionEndpoints } from "./adapters/claude-code-p/session-endpoints.js";
import { SessionEndpointsController } from "./adapters/http/session-endpoints.controller.js";
import { OpenAiCompatibleApiEngine } from "./adapters/openai-compatible-api/openai-compatible-api-engine.js";
import { AgentEngines } from "./application/agent-engines.js";
import { EngineSessions } from "./application/engine-sessions.js";
import { OfficeToolRegistry } from "./application/office-tool-registry.js";
import { UsageWindowState } from "./application/usage-window-state.js";
import { EngineSettingsModule } from "./engine-settings.module.js";

@Module({
  imports: [EngineSettingsModule],
  controllers: [SessionEndpointsController],
  providers: [
    AgentSdkEngine,
    SessionEndpoints,
    ClaudeCodePEngine,
    OpenAiCompatibleApiEngine,
    {
      provide: AgentEngines,
      useFactory: (
        agentSdk: AgentSdkEngine,
        claudeCodeP: ClaudeCodePEngine,
        openAiCompatibleApi: OpenAiCompatibleApiEngine,
      ) =>
        new AgentEngines({
          "agent-sdk": agentSdk,
          "claude-code-p": claudeCodeP,
          "openai-compatible-api": openAiCompatibleApi,
        }),
      inject: [AgentSdkEngine, ClaudeCodePEngine, OpenAiCompatibleApiEngine],
    },
    OfficeToolRegistry,
    UsageWindowState,
    EngineSessions,
  ],
  exports: [EngineSessions, OfficeToolRegistry, UsageWindowState, EngineSettingsModule],
})
export class EngineModule {}
