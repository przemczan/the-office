import { Injectable } from "@nestjs/common";
import { onceByKey, readEach } from "../../../platform/database/fan-out.js";
import {
  EngineModels,
  engineThroughStandIns,
  hasUsageWindows,
  type Engine,
  type EngineId,
  type EngineModel,
} from "../../engine/index.js";
import { hasPipeline, type TaskSummary } from "../domain/task.js";
import { STARTED_STATES } from "../domain/task-states.js";
import {
  HISTORY_WINS_AT,
  historyUsage,
  plannerUsage,
  tasksInHistory,
  type EngineWindowRatios,
  type EstimatedStage,
  type PipelineStage,
  type StageTokens,
  type StageUsages,
  type UsageEstimate,
  type UsageMeasure,
  type WindowRatios,
} from "../domain/usage-estimate.js";
import { AccountWindowRatios } from "../ports/account-window-ratios.js";
import { KnownEngineCascade } from "../ports/known-engine-cascade.js";
import { KnownPeople, type KnownPerson } from "../ports/known-people.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { ModelPrices } from "../ports/model-prices.js";
import { TaskRepository } from "../ports/task-repository.js";
import { UsageHistory } from "../ports/usage-history.js";
import { WorkSettings } from "../ports/work-settings.js";
import { withDutiesHeld } from "./duty-holders.js";

/**
 * A Task's Stages are read one after another: Tasks are already estimated `READS_AT_ONCE` at a
 * time, and a fan-out within each would multiply that past the pool.
 */
const STAGES_AT_ONCE = 1;

/** A Ready Task's Usage estimate, queued ones' too. */
export interface TaskUsageEstimate {
  readonly taskId: string;
  readonly usageEstimate: UsageEstimate;
}

/** A Task's Usage estimate; undefined with no measure ticked. */
export type TaskEstimator = (task: TaskSummary) => Promise<UsageEstimate | undefined>;

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

  /**
   * The Task's, from the done Tasks among `weighed` (every done Task, as `STATES_A_START_WEIGHS`
   * reads them); undefined with no measure ticked.
   */
  async of(task: TaskSummary, weighed: readonly TaskSummary[]): Promise<UsageEstimate | undefined> {
    return (await this.estimator(weighed))(task);
  }

  /**
   * Estimates any Task, from the done Tasks among `weighed`, reading the history each Project and
   * Pipeline has, and the Office-wide ratios, once for them all; each estimate is undefined with
   * no measure ticked.
   */
  async estimator(weighed: readonly TaskSummary[]): Promise<TaskEstimator> {
    const measures = await this.tickedMeasures();
    return measures.length === 0 ? async () => undefined : this.estimating(weighed, measures);
  }

  /** Every Ready Task's, queued ones too; none with no measure ticked. */
  async ofReadyTasks(): Promise<readonly TaskUsageEstimate[]> {
    const measures = await this.tickedMeasures();
    if (measures.length === 0) return [];
    // The done Tasks are the history the estimates read.
    const readyAndDone = await this.tasks.summariesIn(["ready", "done"]);
    const estimate = this.estimating(readyAndDone, measures);
    const ready = readyAndDone.filter(({ state }) => state === "ready");
    return readEach(ready, async (task) => ({
      taskId: task.id,
      usageEstimate: await estimate(task),
    }));
  }

  /**
   * The models a Task's Pipeline's Agent Stages use on each engine id they spend on, estimated or
   * not, in the Stages' order; what the Tasks asked share is read once for them all.
   */
  modelsReader(): (task: TaskSummary) => Promise<ReadonlyMap<EngineId, readonly string[]>> {
    const reads = this.stageReads();
    return async (task) => {
      const models = new Map<EngineId, string[]>();
      for (const { engineId, model } of await this.estimatedStages(task, reads)) {
        const onEngine = models.get(engineId) ?? [];
        if (!onEngine.includes(model)) models.set(engineId, [...onEngine, model]);
      }
      return models;
    };
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
   * Estimates Tasks from the done Tasks among `weighed`, reading each Project and Pipeline's
   * history, and the Office-wide ratios, once.
   */
  private estimating(
    weighed: readonly TaskSummary[],
    measures: readonly UsageMeasure[],
  ): (task: TaskSummary) => Promise<UsageEstimate> {
    const done = weighed.filter(({ state }) => state === "done");
    const histories = new Map<string, Promise<StageUsages>>();
    let windowRatios: Promise<EngineWindowRatios> | undefined;
    let dollarsPerToken: Promise<number | undefined> | undefined;
    const historyOf = ({ projectId, pipelineId }: TaskSummary): Promise<StageUsages> => {
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
    const stageReads = this.stageReads();
    const costOf = onceByKey(({ spentOn, tokens }: { spentOn: EngineModel; tokens: StageTokens }) =>
      this.prices.costOf(spentOn, tokens),
    );
    return async (task) => {
      const stages = await this.estimatedStages(task, stageReads);
      const history = await historyOf(task);
      const tasks = tasksInHistory(stages, history);
      if (tasks >= HISTORY_WINS_AT) {
        const costs = await stageCosts(stages, history, costOf);
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
  private async estimatedStages(
    task: TaskSummary,
    reads: StageReads,
  ): Promise<readonly EstimatedStage[]> {
    if (!hasPipeline(task)) return [];
    const { projectId } = task;
    // A Task that sets no engine and is in no Initiative reads its Project's, shared by many Tasks.
    const taskId = task.engine !== null || task.initiativeId !== undefined ? task.id : undefined;
    const held = await reads.heldStagesOf(task.pipelineId);
    const engines = await this.enginesForStandIns(task, reads);
    const stages = await readEach(
      held,
      async (stage) => {
        const person = stage.role === undefined ? undefined : await reads.personOf(stage.role);
        if (!person) return [];
        const applying = await reads.engineOf({ roleKey: person.roleKey, projectId, taskId });
        if (!applying) return [];
        const { engineId, model } = engines
          ? engineThroughStandIns(applying, task.engineStandIns, engines)
          : applying;
        return [{ key: stage.key, engineId, model }];
      },
      STAGES_AT_ONCE,
    );
    return stages.flat();
  }

  /**
   * What the Tasks of one estimate share, each read once however many Tasks ask: a Pipeline's
   * Stages with their duties' holders, a person, the engine each Role gets in each Project and the
   * engines listed.
   */
  private stageReads(): StageReads {
    let engines: Promise<readonly Engine[]> | undefined;
    return {
      heldStagesOf: onceByKey(
        async (pipelineId: string) =>
          withDutiesHeld((await this.pipelines.read(pipelineId))?.stages ?? [], this.people),
        (pipelineId) => pipelineId,
      ),
      personOf: onceByKey(
        (roleKey: string) => this.people.find(roleKey),
        (roleKey) => roleKey,
      ),
      engineOf: onceByKey(({ roleKey, projectId, taskId }) =>
        this.engineCascade.applying(
          roleKey,
          taskId === undefined ? { projectId } : { projectId, taskId },
        ),
      ),
      engines: () => (engines ??= this.engineModels.engines()),
    };
  }

  /** The engines listed now, for a started Task with Stand-in Engines; none for any other. */
  private async enginesForStandIns(
    task: TaskSummary,
    reads: StageReads,
  ): Promise<readonly Engine[] | undefined> {
    if (!STARTED_STATES.includes(task.state) || task.engineStandIns.length === 0) return undefined;
    return reads.engines();
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
      await readEach(
        engineIds,
        async (engineId) => [engineId, await this.windowRatios.ratios(engineId)] as const,
      ),
    );
  }
}

/** The reads `stageReads` keeps for one estimate. */
interface StageReads {
  readonly heldStagesOf: (pipelineId: string) => Promise<PipelineStage[]>;
  readonly personOf: (roleKey: string) => Promise<KnownPerson | undefined>;
  readonly engineOf: (place: {
    readonly roleKey: string;
    readonly projectId: string;
    /** Only for a Task whose own or Initiative's engine may take the Project default's place. */
    readonly taskId: string | undefined;
  }) => Promise<EngineModel | null>;
  readonly engines: () => Promise<readonly Engine[]>;
}

/** Each Stage's median tokens at the current Model prices, by Stage key. */
async function stageCosts(
  stages: readonly EstimatedStage[],
  history: StageUsages,
  costOf: (spent: { spentOn: EngineModel; tokens: StageTokens }) => Promise<number | undefined>,
): Promise<ReadonlyMap<string, number | undefined>> {
  const costs = await readEach(
    stages,
    async ({ key, engineId, model }) => {
      const usage = history.get(key);
      const cost = usage && (await costOf({ spentOn: { engineId, model }, tokens: usage.tokens }));
      return [key, cost] as const;
    },
    STAGES_AT_ONCE,
  );
  return new Map(costs);
}
