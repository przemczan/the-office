import type { EngineId } from "../domain/engines.js";
import type { EngineModelList } from "../domain/model-lists.js";
import { ModelListRepository } from "./model-list-repository.js";

/**
 * Model lists of the test's own: every test file shares the database, where another test's engine
 * could share an id.
 */
export class ModelListsForTests extends ModelListRepository {
  readonly kept = new Map<EngineId, EngineModelList>();
  /** Makes `save` fail with it, while set. */
  saveFailure: Error | undefined;

  constructor(lists: readonly EngineModelList[] = []) {
    super();
    for (const list of lists) this.kept.set(list.engineId, list);
  }

  async all(): Promise<readonly EngineModelList[]> {
    return [...this.kept.values()];
  }

  async save(list: EngineModelList): Promise<void> {
    if (this.saveFailure) throw this.saveFailure;
    this.kept.set(list.engineId, list);
  }

  async remove(engineId: EngineId): Promise<void> {
    this.kept.delete(engineId);
  }
}
