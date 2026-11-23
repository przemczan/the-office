import { randomUUID } from "node:crypto";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import type { UsageWindowStart } from "../../ports/agent-engine.js";
import { EngineProcess, type EngineCommand } from "../claude-code/engine-process.js";
import {
  engineRead,
  READ_EXIT_GRACE_MS,
  type EngineReadLimits,
} from "../claude-code/engine-read.js";
import { userMessage } from "../claude-code/stream-events.js";
import { WINDOW_START_MODEL, windowStartOf } from "../claude-code/usage-window-start.js";
import { StreamJson } from "./stream-json.js";
import { claudeCodePReadArguments } from "./usage-window-read.js";

/**
 * The pinned binary's command line for a window start: an engine-level read's (no tools, no
 * settings, no MCP server, no session kept), on the cheapest model for one turn.
 */
export function claudeCodePWindowStartArguments(): string[] {
  return [...claudeCodePReadArguments(), `--model=${WINDOW_START_MODEL}`, "--max-turns=1"];
}

/**
 * Starts the account's 5-hour window with one turn of `prompt` on a binary started for it alone
 * (spec §5.4.6), the prompt sent on the binary's input as a session's message. The binary is
 * ended, with what it started, before it answers, however it went (`engineRead`).
 */
export async function startUsageWindowOnStreamJson(
  command: EngineCommand,
  prompt: string,
  processTrees: ProcessTrees,
  limits: EngineReadLimits,
): Promise<UsageWindowStart> {
  const engineProcess = new EngineProcess(processTrees);
  let stream: StreamJson | undefined;
  return engineRead(
    limits,
    async () => {
      const opened = new StreamJson(engineProcess.spawn(command));
      stream = opened;
      opened.send(userMessage({ id: randomUUID(), text: prompt }, undefined));
      return windowStartOf(opened.messages);
    },
    async () => {
      stream?.endInput();
      await engineProcess.endWithLeftovers(READ_EXIT_GRACE_MS);
    },
  );
}
