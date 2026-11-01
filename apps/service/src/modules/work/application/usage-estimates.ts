import { Injectable } from "@nestjs/common";
import { ENGINES, EngineSessions, engineIdOf } from "../../engine/index.js";
import type { Task } from "../domain/task.js";
import {
  HISTORY_WINS_AT,
  historyUsage,
  plannerUsage,
  stageEngineAndModel,
  tasksInHistory,
  type EstimatedStage,
  type ReadsUsageWindows,
  type StageUsages,
  type UsageEstimate,
  type UsageMeasure,
  type UsageRatios,
} from "../domain/usage-estimate.js";
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
    private readonly history: UsageHistory,
    private readonly prices: ModelPrices,
    private readonly engines: EngineSessions,
    private readonly settings: WorkSettings,
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

  private async tickedMeasures(): Promise<readonly UsageMeasure[]> {
    return (await this.settings.usageSettings()).measures;
  }

  /** Estimates Tasks among `everyTask`, reading each Project and Pipeline's history once. */
  private estimating(
    everyTask: readonly Task[],
    measures: readonly UsageMeasure[],
  ): (task: Task) => Promise<UsageEstimate> {
    const done = everyTask.filter(({ state }) => state === "done");
    const histories = new Map<string, Promise<StageUsages>>();
    let ratios: Promise<UsageRatios> | undefined;
    const historyOf = ({ projectId, pipelineId }: Task): Promise<StageUsages> => {
      const key = JSON.stringify([projectId, pipelineId]);
      const ids = done
        .filter((task) => task.projectId === projectId && task.pipelineId === pipelineId)
        .map(({ id }) => id);
      const history = histories.get(key) ?? this.history.of(ids);
      histories.set(key, history);
      return history;
    };
    const officeRatios = (): Promise<UsageRatios> =>
      (ratios ??= this.history.ratios(done.map(({ id }) => id)));
    return async (task) => {
      const stages = await this.estimatedStages(task.pipelineId);
      const history = await historyOf(task);
      const tasks = tasksInHistory(stages, history);
      if (tasks >= HISTORY_WINS_AT) {
        const costs = await this.stageCosts(stages, history);
        const engines = historyUsage(stages, history, costs, this.readsUsageWindows);
        return { basis: { source: "history", tasks }, engines, measures };
      }
      if (task.estimatedTokens !== undefined && stages.length > 0) {
        const engines = plannerUsage(
          stages,
          task.estimatedTokens,
          await officeRatios(),
          this.readsUsageWindows,
        );
        return { basis: { source: "planner" }, engines, measures };
      }
      return { basis: { source: "none" }, engines: [], measures };
    };
  }

  /** The Pipeline's Agent Stages with their engine and model; a vacant Role's are left out. */
  private async estimatedStages(pipelineId: string): Promise<readonly EstimatedStage[]> {
    const pipeline = await this.pipelines.find(pipelineId);
    const stages = await Promise.all(
      (pipeline?.stages ?? []).map(async (stage) => {
        const person = stage.role === undefined ? undefined : await this.people.find(stage.role);
        if (!person) return [];
        const { engine, model } = stageEngineAndModel(stage, person.card);
        return [{ key: stage.key, engineId: engineIdOf(engine), model }];
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
        const cost = usage && (await this.prices.costOf(engineId, model, usage.tokens));
        return [key, cost] as const;
      }),
    );
    return new Map(costs);
  }

  private readonly readsUsageWindows: ReadsUsageWindows = (engineId) =>
    ENGINES.some(
      (engine) =>
        engineIdOf(engine) === engineId && this.engines.capabilitiesOf(engine).usageWindows,
    );
}
