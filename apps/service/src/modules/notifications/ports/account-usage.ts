import type { EngineUsageWindows } from "../domain/now.js";

/** Each engine's account's usage windows as the Engine last read them; the composition root binds it. */
export abstract class AccountUsage {
  /** By engine id, in the order each was first read; an engine not read yet is missing. */
  abstract readonly readingsByEngine: ReadonlyMap<string, Omit<EngineUsageWindows, "engineId">>;
}
