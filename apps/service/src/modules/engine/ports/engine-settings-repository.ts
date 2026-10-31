import type { EngineSettings } from "../domain/engine-settings.js";

/** Where the engines' Office-wide settings are kept, the API endpoints' keys with them. */
export abstract class EngineSettingsRepository {
  /** The settings kept, or the defaults until Settings saves them. */
  abstract read(): Promise<EngineSettings>;

  /** Keeps `settings` in place of the ones kept, all at once. */
  abstract replace(settings: EngineSettings): Promise<void>;
}
