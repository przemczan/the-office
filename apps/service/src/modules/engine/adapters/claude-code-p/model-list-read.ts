import type { SDKControlInitializeResponse } from "@anthropic-ai/claude-agent-sdk";
import type { ProcessTrees } from "../../../../platform/os/process-trees.js";
import type { EngineCommand } from "../claude-code/engine-process.js";
import type { EngineReadLimits } from "../claude-code/engine-read.js";
import { listedClaudeModels } from "../claude-code/listed-models.js";
import { readOnStreamJson } from "./usage-window-read.js";

/**
 * Lists the models the account offers on a binary started for it alone (spec §5.4.5, "Models an
 * engine lists"): the models its answer to the `initialize` control request carries, the one the
 * Agent SDK's `supportedModels()` reads, before any message, so with no model call, by their full
 * ids (`listedClaudeModels`).
 */
export function listModelsOnStreamJson(
  command: EngineCommand,
  processTrees: ProcessTrees,
  limits: EngineReadLimits,
): Promise<readonly string[] | undefined> {
  return readOnStreamJson(command, processTrees, limits, async (stream) => {
    const answer = await stream.request<Partial<SDKControlInitializeResponse>>("initialize");
    return listedClaudeModels(answer.models);
  });
}
