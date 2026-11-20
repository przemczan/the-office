import { Injectable } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import { ModelPrices } from "../../engine/index.js";
import {
  dollarsPerToken,
  HISTORY_TASKS,
  stageUsages,
  tokensByModel,
  type ModelTokens,
  type PricedTokens,
  type StageRunUsage,
  type StageUsages,
} from "../domain/usage-history.js";
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

  /** Each Stage's median tokens over the latest of `doneTaskIds`. */
  async of(doneTaskIds: readonly string[]): Promise<StageUsages> {
    return stageUsages(await this.latestRuns(doneTaskIds));
  }

  /**
   * Dollars per counted token over the latest of `doneTaskIds`: the Office's done Tasks, for a
   * ratio that holds Office-wide. A run is priced by its own engine and model.
   */
  async dollarsPerToken(doneTaskIds: readonly string[]): Promise<number | undefined> {
    const runs = await this.latestRuns(doneTaskIds);
    return dollarsPerToken(await readEach(tokensByModel(runs), (each) => this.priced(each)));
  }

  private latestRuns(doneTaskIds: readonly string[]): Promise<readonly StageRunUsage[]> {
    return this.runs.latestTasksUsage(doneTaskIds, HISTORY_TASKS);
  }

  // Cost is linear in tokens, so one price per engine and model covers all its runs.
  private async priced({ engineId, model, tokens }: ModelTokens): Promise<PricedTokens> {
    return { tokens, dollars: await this.prices.costOf({ engineId, model }, tokens) };
  }
}
