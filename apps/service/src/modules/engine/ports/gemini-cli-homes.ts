import type { EngineId } from "../domain/engines.js";

/**
 * The Gemini CLI engines' folders, each the CLI's home (`GEMINI_CLI_HOME`) where its sessions are
 * kept (spec §5.4.7). No sign-in lies there: the engine's API key is kept in the database and given
 * to the CLI only in its environment.
 */
export abstract class GeminiCliHomes {
  /** Makes the engine's folder when the engine is added. */
  abstract prepareHome(engineId: EngineId): Promise<void>;

  /** Removes the engine's folder, its sessions with it, when the engine is removed. */
  abstract removeHome(engineId: EngineId): Promise<void>;
}
