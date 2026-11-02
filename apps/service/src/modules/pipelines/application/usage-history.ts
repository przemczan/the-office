import { Injectable } from "@nestjs/common";
import { FIRST_CLAUDE_CODE_ENGINE, ModelPrices, type EngineModel } from "../../engine/index.js";
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
    return { tokens, dollars: await this.prices.costOf(engineModelOf(engine, model), tokens) };
  }
}

/**
 * The engine and model a Stage run kept. Until step 1d of task 47 moves them, runs from before
 * the Role card named an engine id keep the way it ran (`agent-sdk`, `claude-code-p`, both on the
 * first Claude Code engine, or `openai-compatible-api` with the model as `<endpoint>/<model>`).
 */
function engineModelOf(engine: string, model: string): EngineModel {
  if (engine === "agent-sdk" || engine === "claude-code-p") {
    return { engineId: FIRST_CLAUDE_CODE_ENGINE.id, model };
  }
  const at = model.indexOf("/");
  return engine === "openai-compatible-api" && at > 0
    ? { engineId: model.slice(0, at), model: model.slice(at + 1) }
    : { engineId: engine, model };
}
