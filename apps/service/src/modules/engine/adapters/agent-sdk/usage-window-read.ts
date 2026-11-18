import {
  query,
  type Options,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import type { UsageWindows } from "../../domain/usage-windows.js";
import { EngineProcess, type EngineCommand } from "../claude-code/engine-process.js";
import {
  engineRead,
  READ_EXIT_GRACE_MS,
  type EngineReadLimits,
} from "../claude-code/engine-read.js";
import { usageWindows } from "../claude-code/sdk-events.js";
import { sessionEnvironment } from "../claude-code/session-settings.js";

/** What a usage read on the Agent SDK runs on. */
export interface SdkUsageRead {
  /** The engine's config folder, which holds its account (`engineConfigFolder`). */
  readonly configFolder: string;
  /** The variables it starts from, dropped as a session's are. */
  readonly environment: Readonly<Record<string, string>>;
  readonly processTrees: ProcessTrees;
  /** How the engine's process starts: as the SDK asks, unless a test starts a stand-in. */
  readonly command?: ((asked: EngineCommand) => EngineCommand) | undefined;
}

/**
 * The query's options: the engine's config folder as a session's, but no tools, no settings, no MCP
 * server and no session kept (`persistSession: false`), so it leaves no transcript.
 */
export function sdkUsageReadOptions(
  configFolder: string,
  environment: Readonly<Record<string, string>>,
  spawnProcess: NonNullable<Options["spawnClaudeCodeProcess"]>,
): Options {
  return {
    cwd: configFolder,
    env: sessionEnvironment(environment, configFolder),
    tools: [],
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    spawnClaudeCodeProcess: spawnProcess,
  };
}

/**
 * Reads the account's usage windows on a query opened for it alone (spec §5.4): the usage query a
 * session makes, with its prompt sending no message, so with no model call. The query and its
 * process end before the read answers, however it went (`engineRead`).
 */
export async function readUsageWindowsOnSdk(
  { configFolder, environment, processTrees, command }: SdkUsageRead,
  limits: EngineReadLimits,
): Promise<UsageWindows | undefined> {
  const engineProcess = new EngineProcess(processTrees);
  const prompt = new AsyncChannel<SDKUserMessage>();
  let engine: Query | undefined;
  return engineRead(
    limits,
    async () => {
      const opened = query({
        prompt,
        options: sdkUsageReadOptions(configFolder, environment, (asked) =>
          engineProcess.spawn(command === undefined ? asked : command(asked)),
        ),
      });
      engine = opened;
      void drained(opened);
      return usageWindows(
        await opened.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
          skipBehaviors: true,
        }),
      );
    },
    async () => {
      prompt.close();
      engine?.close();
      await engineProcess.endWithLeftovers(READ_EXIT_GRACE_MS);
    },
  );
}

/** Reads the query's messages, which a read has none of its own to take, until it ends. */
async function drained(engine: Query): Promise<void> {
  try {
    for await (const message of engine) void message;
  } catch {
    // Its failure reaches the read through the usage query.
  }
}
