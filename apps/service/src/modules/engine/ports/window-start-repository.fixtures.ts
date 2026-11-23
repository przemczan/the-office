import type { EngineId } from "../domain/engines.js";
import {
  NO_WINDOW_START,
  type WindowStartRecord,
  type WindowStartSettings,
} from "../domain/window-starts.js";
import { WindowStartRepository, type KeptWindowStart } from "./window-start-repository.js";

/**
 * Window starts of the test's own: every test file shares the database, where another test's
 * engine could share an id.
 */
export class WindowStartsForTests extends WindowStartRepository {
  private readonly kept = new Map<EngineId, KeptWindowStart>();

  async all(): Promise<readonly KeptWindowStart[]> {
    return [...this.kept.values()];
  }

  async of(engineId: EngineId): Promise<KeptWindowStart | undefined> {
    return this.kept.get(engineId);
  }

  async saveSettings(engineId: EngineId, settings: WindowStartSettings): Promise<void> {
    const last = this.kept.get(engineId)?.last;
    this.kept.set(engineId, {
      engineId,
      startAtTimes: [...settings.startAtTimes],
      startAfterReset: settings.startAfterReset,
      last,
    });
  }

  async record(engineId: EngineId, record: WindowStartRecord): Promise<void> {
    const kept = this.kept.get(engineId) ?? { engineId, ...NO_WINDOW_START, last: undefined };
    this.kept.set(engineId, { ...kept, last: record });
  }

  /** Forgets `engineId`'s Window start, as removing the engine does. */
  forget(engineId: EngineId): void {
    this.kept.delete(engineId);
  }
}
