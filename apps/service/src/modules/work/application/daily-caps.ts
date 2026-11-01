import { Injectable } from "@nestjs/common";
import type { EngineId } from "../../engine/index.js";
import {
  leftOfEstimate,
  NO_DAY_USE,
  plusDayUse,
  type DailyCapsAtStart,
  type DayUse,
} from "../domain/cap-waits.js";
import type { Task } from "../domain/task.js";
import { STARTED_STATES } from "../domain/task-states.js";
import { countedTokens } from "../domain/usage-estimate.js";
import type { EngineCaps } from "../domain/usage-settings.js";
import { DayUsage } from "../ports/day-usage.js";
import { ModelPrices } from "../ports/model-prices.js";
import { TaskTokens } from "../ports/task-tokens.js";
import { UsageEstimates } from "./usage-estimates.js";

/**
 * What the Daily caps weigh a Start against (spec §2.1, "Usage estimates"): each engine id's use
 * today, priced by the Model prices, and what is left of the estimates of the Tasks in progress.
 */
@Injectable()
export class DailyCaps {
  constructor(
    private readonly dayUsage: DayUsage,
    private readonly prices: ModelPrices,
    private readonly taskTokens: TaskTokens,
    private readonly estimates: UsageEstimates,
  ) {}

  /** Each engine id with a Daily cap set, as a Start weighs it; read once for every Start. */
  async of(caps: readonly EngineCaps[], everyTask: readonly Task[]): Promise<DailyCapsAtStart[]> {
    const capped = caps.filter(
      ({ dailyTokens, dailyDollars }) => dailyTokens !== undefined || dailyDollars !== undefined,
    );
    if (capped.length === 0) return [];
    const inProgress = await this.leftInProgress(everyTask);
    return Promise.all(
      capped.map(async ({ engineId, dailyTokens, dailyDollars }) => ({
        engineId,
        caps: { tokens: dailyTokens, dollars: dailyDollars },
        today: await this.today(engineId),
        inProgress: inProgress.get(engineId) ?? NO_DAY_USE,
      })),
    );
  }

  /** Today's use on `engineId`; a model with no price adds no dollars, as "no cost" holds nothing. */
  private async today(engineId: EngineId): Promise<DayUse> {
    const models = await this.dayUsage.today(engineId);
    const used = await Promise.all(
      models.map(async ({ model, tokens }) => ({
        tokens: countedTokens(tokens),
        dollars: (await this.prices.costOf(engineId, model, tokens)) ?? 0,
      })),
    );
    return used.reduce(plusDayUse, NO_DAY_USE);
  }

  /** What is left of every started Task's estimate, by engine id: each less its use so far. */
  private async leftInProgress(everyTask: readonly Task[]): Promise<Map<EngineId, DayUse>> {
    const started = everyTask.filter(({ state }) => STARTED_STATES.includes(state));
    const left = new Map<EngineId, DayUse>();
    for (const task of started) {
      const [estimate, soFar] = await Promise.all([
        this.estimates.of(task, everyTask),
        this.taskTokens.stageTokensSoFar(task.id),
      ]);
      for (const usage of estimate?.engines ?? []) {
        const used = soFar.find(({ engineId }) => engineId === usage.engineId)?.tokens ?? 0;
        const before = left.get(usage.engineId) ?? NO_DAY_USE;
        left.set(usage.engineId, plusDayUse(before, leftOfEstimate(usage, used)));
      }
    }
    return left;
  }
}
