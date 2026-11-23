import type { EngineId } from "../domain/engines.js";
import type { WindowStartRecord, WindowStartSettings } from "../domain/window-starts.js";

/** An engine's Window start as kept: its settings and its last start, skip or failure. */
export interface KeptWindowStart extends WindowStartSettings {
  readonly engineId: EngineId;
  readonly last: WindowStartRecord | undefined;
}

/**
 * Where each engine's Window start is kept (`engine_window_starts`), by engine id. A removed
 * engine's row goes with the engine, in the same transaction (`EngineSettingsRepository`).
 */
export abstract class WindowStartRepository {
  /** Every engine's kept Window start; an engine never set has none. */
  abstract all(): Promise<readonly KeptWindowStart[]>;

  /** `engineId`'s kept Window start; undefined when it was never set. */
  abstract of(engineId: EngineId): Promise<KeptWindowStart | undefined>;

  /** Keeps `engineId`'s settings, its last record left as it was. */
  abstract saveSettings(engineId: EngineId, settings: WindowStartSettings): Promise<void>;

  /** Keeps `record` as `engineId`'s last start, skip or failure, its settings left as they were. */
  abstract record(engineId: EngineId, record: WindowStartRecord): Promise<void>;
}
