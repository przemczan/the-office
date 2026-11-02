import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { Module } from "@nestjs/common";
import { McpClientModule } from "../../platform/mcp/mcp-client.module.js";
import { AgentSdkEngine } from "./adapters/agent-sdk/agent-sdk-engine.js";
import { ClaudeCodePEngine } from "./adapters/claude-code-p/claude-code-p-engine.js";
import { SessionEndpoints } from "./adapters/claude-code-p/session-endpoints.js";
import { SessionEndpointsController } from "./adapters/http/session-endpoints.controller.js";
import { OpenAiCompatibleApiEngine } from "./adapters/openai-compatible-api/openai-compatible-api-engine.js";
import { PostgresDayUsage } from "./adapters/postgres/postgres-day-usage.js";
import { PostgresUsageWindowSamples } from "./adapters/postgres/postgres-usage-window-samples.js";
import { AgentEngines } from "./application/agent-engines.js";
import { DayUsage } from "./application/day-usage.js";
import { EngineSessions } from "./application/engine-sessions.js";
import { OfficeToolRegistry } from "./application/office-tool-registry.js";
import { UsageWindowSamples } from "./application/usage-window-samples.js";
import { UsageWindowState } from "./application/usage-window-state.js";
import { EngineSettingsModule } from "./engine-settings.module.js";
import { DayUsageRepository } from "./ports/day-usage-repository.js";
import { UsageWindowSampleRepository } from "./ports/usage-window-sample-repository.js";

@Module({
  imports: [EngineSettingsModule, ScheduleModule, McpClientModule],
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
})
export class EngineModule {}
