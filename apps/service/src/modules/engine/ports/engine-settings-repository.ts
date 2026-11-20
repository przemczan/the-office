import type { CodexApiKey } from "../domain/codex-api-key.js";
import type { CopilotCliToken } from "../domain/copilot-cli-token.js";
import type { EngineSettings } from "../domain/engine-settings.js";
import type { EngineId } from "../domain/engines.js";

/** Where the engines' Office-wide settings are kept, the API endpoints' keys with them. */
export abstract class EngineSettingsRepository {
  /** The settings kept, or the defaults until Settings saves them. */
  abstract read(): Promise<EngineSettings>;

  /** Keeps `settings` in place of the ones kept, all at once. */
  abstract replace(settings: EngineSettings): Promise<void>;

  /**
   * Keeps `key` as the Codex engine's API key, or none, changing nothing else: a Save of
   * Settings › Engines never sets it.
   */
  abstract setCodexApiKey(engineId: EngineId, key: CodexApiKey | null): Promise<void>;

  /**
   * Keeps `token` as the Copilot CLI engine's pasted token, or none, changing nothing else: a Save
   * of Settings › Engines never sets it.
   */
  abstract setCopilotCliToken(engineId: EngineId, token: CopilotCliToken | null): Promise<void>;
}
