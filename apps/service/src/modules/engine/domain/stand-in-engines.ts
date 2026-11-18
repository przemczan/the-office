import type { EngineSettings } from "./engine-settings.js";
import { offeredModels, type Engine, type EngineId, type EngineModel } from "./engines.js";

/** A Stand-in Engine chosen for a cascade's engine: `standInId` runs what `engineId` would. */
export interface EngineStandInChoice {
  readonly engineId: EngineId;
  readonly standInId: EngineId;
}

/**
 * The engine and model a session runs on, given the cascade's and the Stand-in Engines chosen for
 * the run: the stand-in recorded for the cascade's engine while it is still listed and serves the
 * model, else the cascade's. The usage estimates of a started Task and the Stage Threads both map
 * through this alone, so what is counted and where a session runs can't drift apart.
 */
export function engineThroughStandIns(
  cascade: EngineModel,
  standIns: readonly EngineStandInChoice[],
  engines: readonly Engine[],
): EngineModel {
  const standInId = standIns.find(({ engineId }) => engineId === cascade.engineId)?.standInId;
  const standIn = engines.find(({ id }) => id === standInId);
  return standIn !== undefined && offeredModels(standIn).includes(cascade.model)
    ? { engineId: standIn.id, model: cascade.model }
    : cascade;
}

/**
 * The engine a session runs on, given the engine and model the cascade picked (spec §5.4): the
 * cascade's while it has room, else the first Stand-in Engine in order that serves the same model
 * and has room, else none. A switch keeps the model, so an engine that doesn't serve it never takes
 * over. What "room" means is the caller's: Start weighs the Window caps, a running Stage the
 * windows not used up.
 */
export function engineToRunOn(
  cascade: EngineModel,
  settings: Pick<EngineSettings, "engines" | "standInEngines">,
  hasRoom: (engineId: EngineId) => boolean,
): EngineModel | null {
  if (hasRoom(cascade.engineId)) return cascade;
  const standIn = settings.standInEngines.find((engineId) => {
    if (engineId === cascade.engineId) return false;
    const engine = settings.engines.find(({ id }) => id === engineId);
    return (
      engine !== undefined && offeredModels(engine).includes(cascade.model) && hasRoom(engineId)
    );
  });
  return standIn === undefined ? null : { engineId: standIn, model: cascade.model };
}
