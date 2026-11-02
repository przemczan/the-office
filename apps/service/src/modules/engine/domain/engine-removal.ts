import { EngineSettingsRefused } from "./engine-settings-refused.js";
import { offeredModels, type Engine, type EngineId, type EngineModel } from "./engines.js";

/** An engine being removed and the one that takes over everything naming it (spec §5.4). */
export interface EngineRemoval {
  readonly engineId: EngineId;
  readonly replacement: Engine;
}

/**
 * Where `reference` stands once the removal is done: on the replacement when it named the removed
 * engine, keeping its model when the replacement offers it and else taking the replacement's
 * default model; as it was otherwise.
 */
export function movedEngineModel(reference: EngineModel, removal: EngineRemoval): EngineModel {
  if (reference.engineId !== removal.engineId) return reference;
  const { replacement } = removal;
  return {
    engineId: replacement.id,
    model: offeredModels(replacement).includes(reference.model)
      ? reference.model
      : replacement.defaultModel,
  };
}

/**
 * The removal of the engine `engineId` with `replacementId` taking over, among the engines listed;
 * refused in words when either isn't listed, or when the engine is the only one (until removing
 * the only engine moves its references to none, step 3a2 of task 47).
 */
export function engineRemovalAmong(
  engines: readonly Engine[],
  engineId: EngineId,
  replacementId: EngineId,
): EngineRemoval {
  const removed = engines.find(({ id }) => id === engineId);
  if (removed === undefined) {
    throw new EngineSettingsRefused([
      "The engines changed meanwhile; open Settings › Engines again.",
    ]);
  }
  if (engines.length === 1) {
    throw new EngineSettingsRefused([
      `"${removed.name}" is the only engine; add another before removing it.`,
    ]);
  }
  const replacement = engines.find(({ id }) => id === replacementId && id !== engineId);
  if (replacement === undefined) {
    throw new EngineSettingsRefused([
      `Pick the engine that takes over from "${removed.name}" among the other engines.`,
    ]);
  }
  return { engineId, replacement };
}
