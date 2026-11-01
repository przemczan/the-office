import { Injectable } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { dayOf } from "../domain/day-usage.js";
import { engineIdOf, type Engine, type EngineId } from "../domain/engines.js";
import { DayUsageRepository, type ModelDayUsage } from "../ports/day-usage-repository.js";
import type { TokenUsage } from "../ports/session-events.js";

/**
 * Each day's tokens by engine and model, kind by kind, from every turn of every session; a day
 * starts at local midnight on the service (spec §2.7), which the Daily caps count from.
 */
@Injectable()
export class DayUsage {
  constructor(
    private readonly repository: DayUsageRepository,
    private readonly schedule: Schedule,
  ) {}

  /** Adds a turn's tokens on `model`, on the engine `engine`'s sessions spend on, to today's. */
  async add(engine: Engine, model: string, tokens: TokenUsage): Promise<void> {
    await this.repository.add(dayOf(this.schedule.now()), engineIdOf(engine), model, tokens);
  }

  /** What each model on `engineId` has used today; a model unused today is left out. */
  today(engineId: EngineId): Promise<readonly ModelDayUsage[]> {
    return this.repository.on(dayOf(this.schedule.now()), engineId);
  }
}
