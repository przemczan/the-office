import { EngineSettingsRefused } from "./engine-settings-refused.js";
import { offeredModels, type Engine, type EngineId, type EngineModel } from "./engines.js";

/**
 * An engine being removed and the one that takes over everything naming it, or none when it is
 * the only engine (spec §5.4).
 */
export interface EngineRemoval {
  readonly engineId: EngineId;
  readonly replacement: Engine | null;
}

/**
 * A level naming the engine being removed: where it stands and where the removal puts it. Which
 * level it is follows from what it belongs to: a Role and a Project for a Project's Role override,
 * a Project alone for its Project default, a Role alone for its Role override, neither for the
 * Office default.
 */
export interface MovedEngineReference {
  readonly roleKey: string | null;
  readonly project: { readonly id: string; readonly name: string } | null;
  readonly from: EngineModel;
  readonly to: EngineModel | null;
}

/** What `removal` does to `reference`, when it names the removed engine. */
export function movedEngineReference(
  reference: EngineModel,
  removal: EngineRemoval,
  where: Pick<MovedEngineReference, "roleKey" | "project">,
): MovedEngineReference[] {
  if (reference.engineId !== removal.engineId) return [];
  const from = { engineId: reference.engineId, model: reference.model };
  return [{ ...where, from, to: movedEngineModel(from, removal) }];
}

/**
 * Where `reference` stands once the removal is done: on the replacement when it named the removed
 * engine, keeping its model when the replacement offers it and else taking the replacement's
 * default model, or none with no replacement; as it was otherwise.
 */
export function movedEngineModel(
  reference: EngineModel,
  removal: EngineRemoval,
): EngineModel | null {
  if (reference.engineId !== removal.engineId) return reference;
  const { replacement } = removal;
  if (replacement === null) return null;
  return {
    engineId: replacement.id,
    model: offeredModels(replacement).includes(reference.model)
      ? reference.model
      : replacement.defaultModel,
  };
}

/**
 * The removal of the engine `engineId` with `replacementId` taking over, among the engines listed;
 * with no replacement only the only engine goes. Refused in words when either isn't listed, or
 * when no replacement is given while other engines are.
 */
export function engineRemovalAmong(
  engines: readonly Engine[],
  engineId: EngineId,
  replacementId: EngineId | null,
): EngineRemoval {
  const removed = engines.find(({ id }) => id === engineId);
  if (removed === undefined) {
    throw new EngineSettingsRefused(["The engines changed meanwhile."]);
  }
  if (replacementId === null && engines.length === 1) return { engineId, replacement: null };
  const replacement = engines.find(({ id }) => id === replacementId && id !== engineId);
  if (replacement === undefined) {
    throw new EngineSettingsRefused([
      `Pick the engine that takes over from "${removed.name}" among the other engines.`,
    ]);
  }
  return { engineId, replacement };
}
