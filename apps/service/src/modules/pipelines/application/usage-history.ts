import { Injectable } from "@nestjs/common";
import { engineModelOf, ModelPrices, ROLE_ENGINES, type RoleEngine } from "../../engine/index.js";
import {
  dollarsPerToken,
  latestTasksRuns,
  stageUsages,
  tokensByModel,
  type ModelTokens,
  type PricedTokens,
  type StageUsages,
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
    return dollarsPerToken(await Promise.all(tokensByModel(runs).map((each) => this.priced(each))));
  }

  private async latestRuns(doneTaskIds: readonly string[]): Promise<readonly StageRun[]> {
    return latestTasksRuns(await this.runs.listOfTasks(doneTaskIds));
  }

  // Cost is linear in tokens, so one price per engine and model covers all its runs.
  private async priced({ engine, model, tokens }: ModelTokens): Promise<PricedTokens> {
    const dollars = isRoleEngine(engine)
      ? await this.prices.costOf(engineModelOf(engine, model), tokens)
      : undefined;
    return { tokens, dollars };
  }
}

function isRoleEngine(engine: string): engine is RoleEngine {
  return (ROLE_ENGINES as readonly string[]).includes(engine);
}
