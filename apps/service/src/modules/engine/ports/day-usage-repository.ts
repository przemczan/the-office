import type { EngineId } from "../domain/engines.js";
import type { TokenUsage } from "./session-events.js";

/** What one model used on one engine in one day, kind by kind. */
export interface ModelDayUsage {
  readonly model: string;
  readonly tokens: TokenUsage;
}

/** Where each day's use is kept, by engine and model. */
export abstract class DayUsageRepository {
  /** Adds `tokens` to what `model` on `engineId` used on `day` (`YYYY-MM-DD`). */
  abstract add(day: string, engineId: EngineId, model: string, tokens: TokenUsage): Promise<void>;

  /** What each model on `engineId` used on `day`; a model with no use there is left out. */
  abstract on(day: string, engineId: EngineId): Promise<readonly ModelDayUsage[]>;
}
