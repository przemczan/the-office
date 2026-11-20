import { Module } from "@nestjs/common";
import { OfficeDataDirectory } from "../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../platform/os/current-operating-system.js";
import { ClaudeCodeCliAccounts } from "./adapters/claude-code/claude-code-cli-accounts.js";
import { pinnedBinaryPath } from "./adapters/claude-code-p/pinned-binary.js";
import { pinnedCodexPath } from "./adapters/codex/codex-binary.js";
import { CodexCliAccounts } from "./adapters/codex/codex-cli-accounts.js";
import { CopilotSdkAccounts } from "./adapters/copilot-cli/copilot-sdk-accounts.js";
import { sdkSignInRuntimes } from "./adapters/copilot-cli/copilot-sign-in-runtime.js";
import { EngineAccountsController } from "./adapters/http/engine-accounts.controller.js";
import { EngineWebEvents } from "./adapters/websocket/engine-web-events.js";
import { EngineAccounts } from "./application/engine-accounts.js";
import { EngineSettingsModule } from "./engine-settings.module.js";
import { ClaudeCodeAccounts } from "./ports/claude-code-accounts.js";
import { CodexAccounts } from "./ports/codex-accounts.js";
import { CopilotCliAccounts } from "./ports/copilot-cli-accounts.js";

/**
 * The Claude Code, Codex and Copilot CLI engines' accounts and their Sign in, on the pinned binaries
 * and the pinned Copilot SDK. The service holds it beside `EngineModule`; the end-to-end service
 * puts `StandInClaudeCodeAccounts`, `StandInCodexAccounts` and `StandInCopilotCliAccounts` in their
 * place, so no test runs a login.
 */
@Module({
  imports: [EngineSettingsModule],
  controllers: [EngineAccountsController],
  providers: [
    {
      provide: ClaudeCodeAccounts,
      useFactory: (officeData: OfficeDataDirectory) => {
        const operatingSystem = currentOperatingSystem();
        return new ClaudeCodeCliAccounts(
          () => ({ command: pinnedBinaryPath(operatingSystem.claudeCodeBinaries), args: [] }),
          officeData,
          operatingSystem.processTrees,
          definedVariables(process.env),
        );
      },
      inject: [OfficeDataDirectory],
    },
    {
      provide: CodexAccounts,
      useFactory: (officeData: OfficeDataDirectory) => {
        const operatingSystem = currentOperatingSystem();
        return new CodexCliAccounts(
          () => ({ command: pinnedCodexPath(operatingSystem.codexBinary), args: [] }),
          officeData,
          operatingSystem.processTrees,
          definedVariables(process.env),
        );
      },
      inject: [OfficeDataDirectory],
    },
    {
      provide: CopilotCliAccounts,
      useFactory: (officeData: OfficeDataDirectory) =>
        new CopilotSdkAccounts(sdkSignInRuntimes(definedVariables(process.env)), officeData),
      inject: [OfficeDataDirectory],
    },
    EngineAccounts,
    EngineWebEvents,
  ],
})
export class EngineAccountsModule {}

function definedVariables(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
