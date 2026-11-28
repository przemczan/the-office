import type { SDKControlGetUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import type { UsageWindows } from "../../domain/usage-windows.js";
import { EngineProcess, type EngineCommand } from "../shared/engine-process.js";
import { engineRead, READ_EXIT_GRACE_MS, type EngineReadLimits } from "../shared/engine-read.js";
import { usageWindows } from "../claude-code/sdk-events.js";
import { StreamJson } from "./stream-json.js";

/**
 * The pinned binary's command line for an engine-level read: stream-json each way as a session's,
 * but no tools, no settings, no MCP server and no session kept, so it leaves no transcript.
 */
export function claudeCodePReadArguments(): string[] {
  return [
    "--print",
    "--input-format=stream-json",
    "--output-format=stream-json",
    "--verbose",
    "--tools=",
    "--setting-sources=",
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
}

/**
 * Reads the account's usage windows on a binary started for it alone (spec §5.4): the `get_usage`
 * control request a session sends, before any message, so with no model call.
 */
export function readUsageWindowsOnStreamJson(
  command: EngineCommand,
  processTrees: ProcessTrees,
  limits: EngineReadLimits,
): Promise<UsageWindows | undefined> {
  return readOnStreamJson(command, processTrees, limits, async (stream) =>
    usageWindows(
      await stream.request<SDKControlGetUsageResponse>("get_usage", { skip_behaviors: true }),
    ),
  );
}

/**
 * Asks `ask` of the binary started for it alone with `command`, before any message, so with no
 * model call. The binary is ended, with what it started, before the read answers, however it went
 * (`engineRead`). Shared by the `-p` fallback's engine-level reads.
 */
export async function readOnStreamJson<T>(
  command: EngineCommand,
  processTrees: ProcessTrees,
  limits: EngineReadLimits,
  ask: (stream: StreamJson) => Promise<T>,
): Promise<T> {
  const engineProcess = new EngineProcess(processTrees);
  let stream: StreamJson | undefined;
  return engineRead(
    limits,
    async () => {
      stream = new StreamJson(engineProcess.spawn(command));
      return ask(stream);
    },
    async () => {
      stream?.endInput();
      await engineProcess.endWithLeftovers(READ_EXIT_GRACE_MS);
    },
  );
}
