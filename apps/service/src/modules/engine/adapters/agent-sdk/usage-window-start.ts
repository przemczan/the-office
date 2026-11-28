import { query, type Options, type Query } from "@anthropic-ai/claude-agent-sdk";
import type { UsageWindowStart } from "../../ports/agent-engine.js";
import { EngineProcess } from "../shared/engine-process.js";
import { engineRead, READ_EXIT_GRACE_MS, type EngineReadLimits } from "../shared/engine-read.js";
import { WINDOW_START_MODEL, windowStartOf } from "../claude-code/usage-window-start.js";
import { sdkUsageReadOptions, type SdkUsageRead } from "./usage-window-read.js";

/**
 * The query's options: an engine-level read's (no tools, no settings, no MCP server, no session
 * kept, so no transcript), on the cheapest model for one turn.
 */
export function sdkWindowStartOptions(
  configFolder: string,
  environment: Readonly<Record<string, string>>,
  spawnProcess: NonNullable<Options["spawnClaudeCodeProcess"]>,
): Options {
  return {
    ...sdkUsageReadOptions(configFolder, environment, spawnProcess),
    model: WINDOW_START_MODEL,
    maxTurns: 1,
  };
}

/**
 * Starts the account's 5-hour window with one turn of `prompt` on a query opened for it alone
 * (spec §5.4.6). The query and its process end before it answers, however it went (`engineRead`).
 */
export async function startUsageWindowOnSdk(
  { configFolder, environment, processTrees, command }: SdkUsageRead,
  prompt: string,
  limits: EngineReadLimits,
): Promise<UsageWindowStart> {
  const engineProcess = new EngineProcess(processTrees);
  let engine: Query | undefined;
  return engineRead(
    limits,
    async () => {
      const opened = query({
        prompt,
        options: sdkWindowStartOptions(configFolder, environment, (asked) =>
          engineProcess.spawn(command === undefined ? asked : command(asked)),
        ),
      });
      engine = opened;
      return windowStartOf(opened);
    },
    async () => {
      engine?.close();
      await engineProcess.endWithLeftovers(READ_EXIT_GRACE_MS);
    },
  );
}
