import type { EngineId, EngineModels } from "../../engine/index.js";

/**
 * Why a Task's or an Initiative's engine override can't be saved: an engine Settings › Engines
 * doesn't list. None for no override.
 */
export async function engineOverrideProblems(
  engines: EngineModels,
  engineId: EngineId | null,
): Promise<string[]> {
  if (engineId === null) return [];
  return (await engines.find(engineId)) === undefined ? [`There is no engine "${engineId}".`] : [];
}
