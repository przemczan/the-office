import type { EngineId } from "../domain/engines.js";
import { DayUsageRepository, type ModelDayUsage } from "./day-usage-repository.js";
import { addedTokens, type TokenUsage } from "./session-events.js";

/**
 * Each day's use of the test's own: every test file shares the database, where every scripted
 * session's turns add to the day's use.
 */
export class DayUsageForTests extends DayUsageRepository {
  /** By engine id, then by day. */
  private readonly usage = new Map<EngineId, Map<string, readonly ModelDayUsage[]>>();

  async add(day: string, engineId: EngineId, model: string, tokens: TokenUsage): Promise<void> {
    const days = this.usage.get(engineId) ?? new Map<string, readonly ModelDayUsage[]>();
    const models = days.get(day) ?? [];
    const kept = models.find((usage) => usage.model === model);
    const others = models.filter((usage) => usage !== kept);
    const added = kept === undefined ? tokens : addedTokens(kept.tokens, tokens);
    days.set(day, [...others, { model, tokens: added }]);
    this.usage.set(engineId, days);
  }

  async on(day: string, engineId: EngineId): Promise<readonly ModelDayUsage[]> {
    return this.usage.get(engineId)?.get(day) ?? [];
  }

  async forget(engineId: EngineId): Promise<void> {
    this.usage.delete(engineId);
  }
}
