import type { EngineSettings } from "./engine-settings.js";
import { offeredModels, type EngineId, type EngineModel } from "./engines.js";

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
