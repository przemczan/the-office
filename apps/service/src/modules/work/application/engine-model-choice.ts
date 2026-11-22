import { offeredModels, type EngineModel, type EngineModels } from "../../engine/index.js";

/**
 * Why a Task's or an Initiative's engine and model can't be saved, in Projects' words: an engine
 * Settings › Engines doesn't list, or a model it doesn't offer. None for no engine.
 */
export async function engineModelProblems(
  engines: EngineModels,
  engine: EngineModel | null,
): Promise<string[]> {
  if (engine === null) return [];
  const listed = await engines.find(engine.engineId);
  if (listed === undefined) return [`There is no engine "${engine.engineId}".`];
  return offeredModels(listed).includes(engine.model) ? [] : ["Choose a model the engine offers."];
}
