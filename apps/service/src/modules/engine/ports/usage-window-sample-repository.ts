import type { EngineId } from "../domain/engines.js";
import type { UsageWindowSample } from "../domain/usage-window-samples.js";

/** Where the counted pairs of readings are kept, by engine id, so the ratios outlive a restart. */
export abstract class UsageWindowSampleRepository {
  /** Keeps `sample`, and of `engineId`'s only the latest `kept`. */
  abstract add(engineId: EngineId, sample: UsageWindowSample, kept: number): Promise<void>;

  /** The latest `limit` of `engineId`'s, newest first. */
  abstract latest(engineId: EngineId, limit: number): Promise<readonly UsageWindowSample[]>;
}
