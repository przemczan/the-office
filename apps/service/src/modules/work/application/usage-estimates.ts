import { Injectable } from "@nestjs/common";
import {
  EngineModels,
  engineThroughStandIns,
  hasUsageWindows,
  type Engine,
  type EngineId,
} from "../../engine/index.js";
import { hasPipeline, type Task } from "../domain/task.js";
import { STARTED_STATES } from "../domain/task-states.js";
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
  type WindowRatios,
} from "../domain/usage-estimate.js";
import { AccountWindowRatios } from "../ports/account-window-ratios.js";
import { KnownEngineCascade } from "../ports/known-engine-cascade.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { ModelPrices } from "../ports/model-prices.js";
import { TaskRepository } from "../ports/task-repository.js";
import { UsageHistory } from "../ports/usage-history.js";
import { WorkSettings } from "../ports/work-settings.js";
import { withDutiesHeld } from "./duty-holders.js";

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

  /**
   * The models the Task's Pipeline's Agent Stages use on each engine id they spend on, estimated or
   * not, in the Stages' order.
   */
  async modelsOf(task: Task): Promise<ReadonlyMap<EngineId, readonly string[]>> {
    const models = new Map<EngineId, string[]>();
    for (const { engineId, model } of await this.estimatedStages(task)) {
      const onEngine = models.get(engineId) ?? [];
      if (!onEngine.includes(model)) models.set(engineId, [...onEngine, model]);
    }
    return models;
  }

  /** The window % per token of `engineId`; none for an engine whose account has no usage windows. */
  async windowRatiosOf(engineId: EngineId): Promise<WindowRatios | undefined> {
    const engine = await this.engineModels.find(engineId);
    return engine && hasUsageWindows(engine) ? this.windowRatios.ratios(engineId) : undefined;
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
   * Task's Project, a started Task's on the Stand-in Engines its Start chose, as its Stage Threads
   * open on them (`engineThroughStandIns`); a vacant Role's and an unheld duty's are left out, and
   * every Stage while no engine is listed. None while the Task has no Pipeline.
   */
  private async estimatedStages(task: Task): Promise<readonly EstimatedStage[]> {
    if (!hasPipeline(task)) return [];
    const { projectId } = task;
    const pipeline = await this.pipelines.read(task.pipelineId);
    const held = await withDutiesHeld(pipeline?.stages ?? [], this.people);
    const engines = await this.enginesForStandIns(task);
    const stages = await Promise.all(
      held.map(async (stage) => {
        const person = stage.role === undefined ? undefined : await this.people.find(stage.role);
        if (!person) return [];
        const applying = await this.engineCascade.applying(person.roleKey, projectId);
        if (!applying) return [];
        const { engineId, model } = engines
          ? engineThroughStandIns(applying, task.engineStandIns, engines)
          : applying;
        return [{ key: stage.key, engineId, model }];
      }),
    );
    return stages.flat();
  }

  /** The engines listed now, for a started Task with Stand-in Engines; none for any other. */
  private async enginesForStandIns(task: Task): Promise<readonly Engine[] | undefined> {
    if (!STARTED_STATES.includes(task.state) || task.engineStandIns.length === 0) return undefined;
    return this.engineModels.engines();
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
