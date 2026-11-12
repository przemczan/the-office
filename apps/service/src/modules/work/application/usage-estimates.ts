import { Injectable } from "@nestjs/common";
import { EngineModels, hasUsageWindows, type EngineId } from "../../engine/index.js";
import { hasPipeline, type Task } from "../domain/task.js";
import {
  HISTORY_WINS_AT,
  historyUsage,
  plannerUsage,
  tasksInHistory,
  type EngineWindowRatios,
  type EstimatedStage,
  type StageUsages,
  type UsageEstimate,
  type UsageMeasure,
} from "../domain/usage-estimate.js";
import { AccountWindowRatios } from "../ports/account-window-ratios.js";
import { KnownEngineCascade } from "../ports/known-engine-cascade.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { ModelPrices } from "../ports/model-prices.js";
import { TaskRepository } from "../ports/task-repository.js";
import { UsageHistory } from "../ports/usage-history.js";
import { WorkSettings } from "../ports/work-settings.js";

/** A Ready Task's Usage estimate, queued ones' too. */
export interface TaskUsageEstimate {
  readonly taskId: string;
  readonly usageEstimate: UsageEstimate;
}

/**
 * Usage estimates (spec §2.1): from the done Tasks of the same Project and Pipeline once there are
 * 3, else from the Planner's token estimate in the Plan; none with no measure ticked.
 */
@Injectable()
export class UsageEstimates {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly pipelines: KnownPipelines,
    private readonly people: KnownPeople,
    private readonly engineCascade: KnownEngineCascade,
    private readonly history: UsageHistory,
    private readonly prices: ModelPrices,
    private readonly settings: WorkSettings,
    private readonly windowRatios: AccountWindowRatios,
    private readonly engineModels: EngineModels,
  ) {}

  /** The Task's, its done Tasks found among `everyTask`; undefined with no measure ticked. */
  async of(task: Task, everyTask: readonly Task[]): Promise<UsageEstimate | undefined> {
    const measures = await this.tickedMeasures();
    return measures.length === 0 ? undefined : this.estimating(everyTask, measures)(task);
  }

  /** Every Ready Task's, queued ones too; none with no measure ticked. */
  async ofReadyTasks(): Promise<readonly TaskUsageEstimate[]> {
    const measures = await this.tickedMeasures();
    if (measures.length === 0) return [];
    const everyTask = await this.tasks.list();
    const estimate = this.estimating(everyTask, measures);
    const ready = everyTask.filter(({ state }) => state === "ready");
    return Promise.all(
      ready.map(async (task) => ({ taskId: task.id, usageEstimate: await estimate(task) })),
    );
  }

  /** The engine ids the Task's Pipeline's Agent Stages spend on, estimated or not. */
  async engineIdsOf(task: Task): Promise<readonly EngineId[]> {
    const stages = await this.estimatedStages(task);
    return [...new Set(stages.map(({ engineId }) => engineId))];
  }

  private async tickedMeasures(): Promise<readonly UsageMeasure[]> {
    return (await this.settings.usageSettings()).measures;
  }

  /**
   * Estimates Tasks among `everyTask`, reading each Project and Pipeline's history, and the
   * Office-wide ratios, once.
   */
  private estimating(
    everyTask: readonly Task[],
    measures: readonly UsageMeasure[],
  ): (task: Task) => Promise<UsageEstimate> {
    const done = everyTask.filter(({ state }) => state === "done");
    const histories = new Map<string, Promise<StageUsages>>();
    let windowRatios: Promise<EngineWindowRatios> | undefined;
    let dollarsPerToken: Promise<number | undefined> | undefined;
    const historyOf = ({ projectId, pipelineId }: Task): Promise<StageUsages> => {
      const key = JSON.stringify([projectId, pipelineId]);
      const ids = done
        .filter((task) => task.projectId === projectId && task.pipelineId === pipelineId)
        .map(({ id }) => id);
      const history = histories.get(key) ?? this.history.of(ids);
      histories.set(key, history);
      return history;
    };
    const officeWindowRatios = (): Promise<EngineWindowRatios> =>
      (windowRatios ??= this.engineWindowRatios());
    const officeDollarsPerToken = (): Promise<number | undefined> =>
      (dollarsPerToken ??= this.history.dollarsPerToken(done.map(({ id }) => id)));
    return async (task) => {
      const stages = await this.estimatedStages(task);
      const history = await historyOf(task);
      const tasks = tasksInHistory(stages, history);
      if (tasks >= HISTORY_WINS_AT) {
        const costs = await this.stageCosts(stages, history);
        const engines = historyUsage(stages, history, costs, await officeWindowRatios());
        return { basis: { source: "history", tasks }, engines, measures };
      }
      if (task.estimatedTokens !== undefined && stages.length > 0) {
        const engines = plannerUsage(
          stages,
          task.estimatedTokens,
          await officeWindowRatios(),
          await officeDollarsPerToken(),
        );
        return { basis: { source: "planner" }, engines, measures };
      }
      return { basis: { source: "none" }, engines: [], measures };
    };
  }

  /**
   * The Task's Pipeline's Agent Stages with the engine and model the cascade gives each in the
   * Task's Project; a vacant Role's are left out, and every Stage while no engine is listed. None
   * while the Task has no Pipeline.
   */
  private async estimatedStages(task: Task): Promise<readonly EstimatedStage[]> {
    if (!hasPipeline(task)) return [];
    const { projectId } = task;
    const pipeline = await this.pipelines.read(task.pipelineId);
    const stages = await Promise.all(
      (pipeline?.stages ?? []).map(async (stage) => {
        const person = stage.role === undefined ? undefined : await this.people.find(stage.role);
        if (!person) return [];
        const applying = await this.engineCascade.applying(person.roleKey, projectId);
        return applying
          ? [{ key: stage.key, engineId: applying.engineId, model: applying.model }]
          : [];
      }),
    );
    return stages.flat();
  }

  /** Each Stage's median tokens at the current Model prices, by Stage key. */
  private async stageCosts(
    stages: readonly EstimatedStage[],
    history: StageUsages,
  ): Promise<ReadonlyMap<string, number | undefined>> {
    const costs = await Promise.all(
      stages.map(async ({ key, engineId, model }) => {
        const usage = history.get(key);
        const cost = usage && (await this.prices.costOf({ engineId, model }, usage.tokens));
        return [key, cost] as const;
      }),
    );
    return new Map(costs);
  }

  /**
   * The window ratios of each engine whose account has usage windows; one whose sessions never read
   * them (on the `-p` fallback) has no samples, so no ratio.
   */
  private async engineWindowRatios(): Promise<EngineWindowRatios> {
    const engineIds = (await this.engineModels.engines())
      .filter(hasUsageWindows)
      .map(({ id }) => id);
    return new Map(
      await Promise.all(
        engineIds.map(
          async (engineId) => [engineId, await this.windowRatios.ratios(engineId)] as const,
        ),
      ),
    );
  }
}
