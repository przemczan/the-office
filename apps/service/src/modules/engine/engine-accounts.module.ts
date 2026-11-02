import { Module } from "@nestjs/common";
import { OfficeDataDirectory } from "../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../platform/os/current-operating-system.js";
import { ClaudeCodeCliAccounts } from "./adapters/claude-code/claude-code-cli-accounts.js";
import { pinnedBinaryPath } from "./adapters/claude-code-p/pinned-binary.js";
import { EngineAccountsController } from "./adapters/http/engine-accounts.controller.js";
import { EngineWebEvents } from "./adapters/websocket/engine-web-events.js";
import { EngineAccounts } from "./application/engine-accounts.js";
import { EngineSettingsModule } from "./engine-settings.module.js";
import { ClaudeCodeAccounts } from "./ports/claude-code-accounts.js";

/**
 * The Claude Code engines' accounts and their Sign in, on the pinned binary. The service holds it
 * beside `EngineModule`; the end-to-end service puts `StandInClaudeCodeAccounts` in its place, so
 * no test runs the binary's login.
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
