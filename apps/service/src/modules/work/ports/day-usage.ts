import type { EngineId } from "../../engine/index.js";
import type { StageTokens } from "../domain/usage-estimate.js";

/** What one model has used today on an engine id, kind by kind. */
export interface ModelDayUsage {
  readonly model: string;
  readonly tokens: StageTokens;
}

/** Each day's use, which the Engine module counts from every turn; the composition root binds it. */
export abstract class DayUsage {
  /** What each model on `engineId` has used since local midnight; a model unused today is left out. */
  abstract today(engineId: EngineId): Promise<readonly ModelDayUsage[]>;
}
