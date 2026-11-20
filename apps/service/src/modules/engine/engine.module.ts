import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { BusyWorkModule } from "../office-updates/index.js";
import { Module } from "@nestjs/common";
import { PromptTemplatesModule } from "../prompt-templates/index.js";
import { EnginePromptTemplates } from "./adapters/prompt-templates/engine-prompt-templates.js";
import { McpClientModule } from "../../platform/mcp/mcp-client.module.js";
import { AgentSdkEngine } from "./adapters/agent-sdk/agent-sdk-engine.js";
import { ClaudeCodePEngine } from "./adapters/claude-code-p/claude-code-p-engine.js";
import { CodexAppServerEngine } from "./adapters/codex/codex-engine.js";
import { CopilotSdkEngine } from "./adapters/copilot-cli/copilot-cli-engine.js";
import { SessionEndpoints } from "./adapters/claude-code-p/session-endpoints.js";
import { GeminiCliHeadlessEngine } from "./adapters/gemini-cli/gemini-cli-engine.js";
import { SessionEndpointsController } from "./adapters/http/session-endpoints.controller.js";
import { WorkstationLanguageServers } from "./adapters/language-servers/workstation-language-servers.js";
import { OpenAiCompatibleApiEngine } from "./adapters/openai-compatible-api/openai-compatible-api-engine.js";
import { PostgresDayUsage } from "./adapters/postgres/postgres-day-usage.js";
import { PostgresUsageWindowSamples } from "./adapters/postgres/postgres-usage-window-samples.js";
import { AgentEngines } from "./application/agent-engines.js";
import { DayUsage } from "./application/day-usage.js";
import { EngineSessions } from "./application/engine-sessions.js";
import { OfficeToolRegistry } from "./application/office-tool-registry.js";
import { ChangedAccountUsage } from "./application/changed-account-usage.js";
import { RemovedEngineUsage } from "./application/removed-engine-usage.js";
import { UsageWindowSamples } from "./application/usage-window-samples.js";
import { UsageWindowChecks } from "./application/usage-window-checks.js";
import { UsageWindowReadings } from "./application/usage-window-readings.js";
import { UsageWindowState } from "./application/usage-window-state.js";
import { UsageWindowTelemetry } from "./application/usage-window-telemetry.js";
import { UsageWindowsNow } from "./application/usage-windows-now.js";
import { EngineSettingsModule } from "./engine-settings.module.js";
import { DayUsageRepository } from "./ports/day-usage-repository.js";
import { SessionLanguageServers } from "./ports/session-language-servers.js";
import { UsageWindowSampleRepository } from "./ports/usage-window-sample-repository.js";

@Module({
  imports: [
    EngineSettingsModule,
    PromptTemplatesModule,
    ScheduleModule,
    McpClientModule,
    BusyWorkModule,
  ],
  controllers: [SessionEndpointsController],
  providers: [
    AgentSdkEngine,
    SessionEndpoints,
    ClaudeCodePEngine,
    OpenAiCompatibleApiEngine,
    CodexAppServerEngine,
    CopilotSdkEngine,
    GeminiCliHeadlessEngine,
    {
      provide: AgentEngines,
      useFactory: (
        agentSdk: AgentSdkEngine,
        claudeCodeP: ClaudeCodePEngine,
        openAiCompatibleApi: OpenAiCompatibleApiEngine,
        codex: CodexAppServerEngine,
        copilotCli: CopilotSdkEngine,
        geminiCli: GeminiCliHeadlessEngine,
      ) =>
        new AgentEngines({
          "agent-sdk": agentSdk,
          "claude-code-p": claudeCodeP,
          "openai-compatible-api": openAiCompatibleApi,
          codex,
          "copilot-cli": copilotCli,
          "gemini-cli": geminiCli,
        }),
      inject: [
        AgentSdkEngine,
        ClaudeCodePEngine,
        OpenAiCompatibleApiEngine,
        CodexAppServerEngine,
        CopilotSdkEngine,
        GeminiCliHeadlessEngine,
      ],
    },
    OfficeToolRegistry,
    UsageWindowState,
    { provide: DayUsageRepository, useClass: PostgresDayUsage },
    DayUsage,
    { provide: UsageWindowSampleRepository, useClass: PostgresUsageWindowSamples },
    UsageWindowSamples,
    UsageWindowReadings,
    UsageWindowChecks,
    RemovedEngineUsage,
    ChangedAccountUsage,
    UsageWindowTelemetry,
    UsageWindowsNow,
    { provide: SessionLanguageServers, useClass: WorkstationLanguageServers },
    EngineSessions,
    EnginePromptTemplates,
  ],
  exports: [
    EngineSessions,
    OfficeToolRegistry,
    UsageWindowState,
    UsageWindowSamples,
    UsageWindowsNow,
    DayUsage,
    EngineSettingsModule,
  ],
})
export class EngineModule {}
