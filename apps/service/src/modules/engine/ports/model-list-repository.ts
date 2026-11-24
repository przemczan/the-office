import type { EngineId } from "../domain/engines.js";
import type { EngineModelList } from "../domain/model-lists.js";

/** Each engine's kept model list (`engine_model_lists`), one per engine id. */
export abstract class ModelListRepository {
  /** Every kept list, whatever engine is listed now. */
  abstract all(): Promise<readonly EngineModelList[]>;

  /** Keeps `list` in place of its engine's previous one. */
  abstract save(list: EngineModelList): Promise<void>;

  /** Forgets the engine's list; nothing when it has none. */
  abstract remove(engineId: EngineId): Promise<void>;
}
