import type { CodexApiKey } from "../domain/codex-api-key.js";
import type { CopilotCliToken } from "../domain/copilot-cli-token.js";
import { DEFAULT_ENGINE_SETTINGS, type EngineSettings } from "../domain/engine-settings.js";
import type { EngineId } from "../domain/engines.js";
import { EngineSettingsRepository } from "./engine-settings-repository.js";

/**
 * Settings of the test's own: every test file shares the database, whose settings every session
 * on the OpenAI-compatible API and every Role card check would read.
 */
export class EngineSettingsForTests extends EngineSettingsRepository {
  private settings: EngineSettings;

  /** The defaults with what `settings` gives. */
  constructor(settings: Partial<EngineSettings> = {}) {
    super();
    this.settings = { ...DEFAULT_ENGINE_SETTINGS, ...settings };
  }

  async read(): Promise<EngineSettings> {
    return this.settings;
  }

  async replace(settings: EngineSettings): Promise<void> {
    this.settings = settings;
  }

  async setCodexApiKey(engineId: EngineId, key: CodexApiKey | null): Promise<void> {
    this.settings = {
      ...this.settings,
      engines: this.settings.engines.map((engine) =>
        engine.id === engineId && engine.kind === "codex" ? { ...engine, apiKey: key } : engine,
      ),
    };
  }

  async setCopilotCliToken(engineId: EngineId, token: CopilotCliToken | null): Promise<void> {
    this.settings = {
      ...this.settings,
      engines: this.settings.engines.map((engine) =>
        engine.id === engineId && engine.kind === "copilot-cli" ? { ...engine, token } : engine,
      ),
    };
  }
}
