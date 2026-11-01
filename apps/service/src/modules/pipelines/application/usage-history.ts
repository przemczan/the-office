import { Injectable } from "@nestjs/common";
import { ENGINES, engineIdOf, ModelPrices, type Engine } from "../../engine/index.js";
import {
  latestTasksRuns,
  stageUsages,
  tokensByModel,
  usageRatios,
  type ModelTokens,
  type PricedTokens,
  type StageUsages,
  type UsageRatios,
} from "../domain/usage-history.js";
import type { StageRun } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";

/**
 * What done Tasks' Stage runs used, for Work's Usage estimates (spec §2.1). Work knows which Tasks
 * are done and where, so it names them; this keeps the latest of them by their last run.
 */
@Injectable()
export class UsageHistory {
  constructor(
    private readonly runs: StageRunRepository,
    private readonly prices: ModelPrices,
  ) {}

  /** Each Stage's median tokens and window changes over the latest of `doneTaskIds`. */
  async of(doneTaskIds: readonly string[]): Promise<StageUsages> {
    return stageUsages(await this.latestRuns(doneTaskIds));
  }

  /**
   * Window % and dollars per token over the latest of `doneTaskIds`: the Office's done Tasks, for
   * ratios that hold Office-wide. A run is priced by its own engine and model.
   */
  async ratios(doneTaskIds: readonly string[]): Promise<UsageRatios> {
    const runs = await this.latestRuns(doneTaskIds);
    const priced = await Promise.all(tokensByModel(runs).map((each) => this.priced(each)));
    return usageRatios(runs, priced);
  }

  private async latestRuns(doneTaskIds: readonly string[]): Promise<readonly StageRun[]> {
    return latestTasksRuns(await this.runs.listOfTasks(doneTaskIds));
  }

  // Cost is linear in tokens, so one price per engine and model covers all its runs.
  private async priced({ engine, model, tokens }: ModelTokens): Promise<PricedTokens> {
    const dollars = isEngine(engine)
      ? await this.prices.costOf(engineIdOf(engine), model, tokens)
      : undefined;
    return { tokens, dollars };
  }
}

function isEngine(engine: string): engine is Engine {
  return (ENGINES as readonly string[]).includes(engine);
}
