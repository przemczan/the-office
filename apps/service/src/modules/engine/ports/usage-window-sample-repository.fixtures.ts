import type { EngineId } from "../domain/engines.js";
import type { UsageWindowSample } from "../domain/usage-window-samples.js";
import { UsageWindowSampleRepository } from "./usage-window-sample-repository.js";

/**
 * Pairs of readings of the test's own: every test file shares the database, where every scripted
 * session's readings add pairs.
 */
export class UsageWindowSamplesForTests extends UsageWindowSampleRepository {
  private readonly samples = new Map<EngineId, readonly UsageWindowSample[]>();

  async add(engineId: EngineId, sample: UsageWindowSample, kept: number): Promise<void> {
    this.samples.set(engineId, [sample, ...(this.samples.get(engineId) ?? [])].slice(0, kept));
  }

  async latest(engineId: EngineId, limit: number): Promise<readonly UsageWindowSample[]> {
    return (this.samples.get(engineId) ?? []).slice(0, limit);
  }
}
