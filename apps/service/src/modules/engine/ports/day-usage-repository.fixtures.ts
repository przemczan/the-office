import type { EngineId } from "../domain/engines.js";
import { DayUsageRepository, type ModelDayUsage } from "./day-usage-repository.js";
import { addedTokens, type TokenUsage } from "./session-events.js";

/**
 * Each day's use of the test's own: every test file shares the database, where every scripted
 * session's turns add to the day's use.
 */
export class DayUsageForTests extends DayUsageRepository {
  private readonly usage = new Map<string, readonly ModelDayUsage[]>();

  async add(day: string, engineId: EngineId, model: string, tokens: TokenUsage): Promise<void> {
    const key = keyOf(day, engineId);
    const models = this.usage.get(key) ?? [];
    const kept = models.find((usage) => usage.model === model);
    const others = models.filter((usage) => usage !== kept);
    const added = kept === undefined ? tokens : addedTokens(kept.tokens, tokens);
    this.usage.set(key, [...others, { model, tokens: added }]);
  }

  async on(day: string, engineId: EngineId): Promise<readonly ModelDayUsage[]> {
    return this.usage.get(keyOf(day, engineId)) ?? [];
  }
}

function keyOf(day: string, engineId: EngineId): string {
  return `${day} ${engineId}`;
}
