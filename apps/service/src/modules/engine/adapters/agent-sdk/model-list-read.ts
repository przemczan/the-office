import type { EngineReadLimits } from "../shared/engine-read.js";
import { listedClaudeModels } from "../claude-code/listed-models.js";
import { readOnSdk, type SdkUsageRead } from "./usage-window-read.js";

/**
 * Lists the models the account offers on a query opened for it alone (spec §5.4.5, "Models an
 * engine lists"): the models the binary's `initialize` answers (`supportedModels()`), before any
 * message, so with no model call, by their full ids (`listedClaudeModels`).
 */
export function listModelsOnSdk(
  read: SdkUsageRead,
  limits: EngineReadLimits,
): Promise<readonly string[] | undefined> {
  return readOnSdk(read, limits, async (engine) =>
    listedClaudeModels(await engine.supportedModels()),
  );
}
