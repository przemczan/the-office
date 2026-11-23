import { Injectable } from "@nestjs/common";
import { onceByKey, readEach } from "../../../platform/database/fan-out.js";
import { ScheduledExitHold } from "../../office-updates/index.js";
import {
  EngineModels,
  EngineSessions,
  usageWindowWords,
  type EngineCapability,
  type EngineId,
  type StandInEngineSettings,
} from "../../engine/index.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type {
  DailyCapsAtStart,
  UsageAtStart,
  UsedUpAtStart,
  WindowsAtStart,
} from "../domain/cap-waits.js";
import type { StandInEngineAtStart, StandInsAtStart } from "../domain/stand-ins-at-start.js";
import type { Initiative } from "../domain/initiative.js";
import { hasPipeline, type Task } from "../domain/task.js";
import { taskBranchBase } from "../domain/task-branch-base.js";
import { TaskRefused } from "../domain/task-refused.js";
import { STATES_A_START_WEIGHS } from "../domain/task-states.js";
import {
  firstAgentStage,
  type BrokenPipelineAtStart,
  type InitiativeBranchProblem,
  type StartConditions,
} from "../domain/task-start.js";
import type { PipelineStage } from "../domain/usage-estimate.js";
import type { EngineCaps, UsageSettings } from "../domain/usage-settings.js";
import { AccountWindows } from "../ports/account-windows.js";
import { KnownPeople, type KnownPerson } from "../ports/known-people.js";
import { KnownProjects, type KnownProject } from "../ports/known-projects.js";
import { KnownPipelines, type KnownPipeline } from "../ports/known-pipelines.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { ProjectInitiativeBranches } from "../ports/project-initiative-branches.js";
import { TaskRepository } from "../ports/task-repository.js";
import { OfficeLimits } from "./office-limits.js";
import { DailyCaps } from "./daily-caps.js";
import { withDutiesHeld } from "./duty-holders.js";
import { StartsSinceReading } from "./starts-since-reading.js";
import { TaskStageEdits } from "./task-stage-edits.js";
import { UsageEstimates, type TaskCascade, type TaskEstimator } from "./usage-estimates.js";

const NOTHING_SINCE_READING = { fiveHour: 0, sevenDay: 0 };

/**
 * What a Stand-in Engine needs to take on a Task's Agent Stages (spec §5.4.5): each gives its
 * session Office tools and holds its answer to the Stage result's schema.
 */
const AGENT_STAGE_NEEDS = [
  "officeTools",
  "outputSchema",
] as const satisfies readonly EngineCapability[];

/** What every Task's Start weighs alike, read once for them all. */
interface OfficeUsageAtStart {
  readonly daily: readonly DailyCapsAtStart[];
  readonly engineNames: ReadonlyMap<EngineId, string>;
  readonly now: Date;
  /** The engines listed and the Office's Stand-in Engine list. */
  readonly standIns: StandInEngineSettings;
  /**
   * A listed engine as a Start weighs it as a Stand-in Engine, but for the Task's estimate; read
   * once whichever lists (the Office's, the Projects' own) name it.
   */
  readonly standInEngineOf: (engineId: EngineId) => Promise<StandInEngineAtStart>;
  /** Whether an engine has every capability an Agent Stage needs. */
  readonly capable: (engineId: EngineId) => boolean;
}

/** What the Tasks weighed together share, each read once for them all. */
interface StartReads {
  readonly pipelineOf: (pipelineId: string) => Promise<KnownPipeline | undefined>;
  readonly heldStagesOf: (pipeline: KnownPipeline) => Promise<PipelineStage[]>;
  readonly projectOf: (projectId: string) => Promise<KnownProject | undefined>;
  readonly initiativeOf: (initiativeId: string) => Promise<Initiative | undefined>;
  readonly personOf: (roleKey: string) => Promise<KnownPerson | undefined>;
  readonly cascadeOf: (task: Task) => Promise<TaskCascade>;
}

/**
 * Gathers what Start weighs from the other modules: the Task's Pipeline, its person, the limits,
 * its Initiative's branch when it starts from one, and its Usage estimate against the windows and
 * the Daily caps of the engines it spends on and of the Stand-in Engines that may take it on.
 */
@Injectable()
export class StartConditionsReader {
  constructor(
    private readonly pipelines: KnownPipelines,
    private readonly people: KnownPeople,
    private readonly projects: KnownProjects,
    private readonly limits: OfficeLimits,
    private readonly tasks: TaskRepository,
    private readonly estimates: UsageEstimates,
    private readonly windows: AccountWindows,
    private readonly startsSinceReading: StartsSinceReading,
    private readonly dailyCaps: DailyCaps,
    private readonly engineModels: EngineModels,
    private readonly exitHold: ScheduledExitHold,
    private readonly schedule: Schedule,
    private readonly initiatives: InitiativeRepository,
    private readonly initiativeBranches: ProjectInitiativeBranches,
    private readonly stageEdits: TaskStageEdits,
    private readonly engineSessions: EngineSessions,
  ) {}

  async of(task: Task): Promise<StartConditions> {
    return (await this.reading())(task);
  }

  /** What each of `tasks` weighs, the Office's settings and Tasks read once for them all. */
  async ofEach(tasks: readonly Task[]): Promise<Map<string, StartConditions>> {
    if (tasks.length === 0) return new Map();
    const conditionsOf = await this.reading();
    return new Map(
      await readEach(tasks, async (task) => [task.id, await conditionsOf(task)] as const),
    );
  }

  private async reading(): Promise<(task: Task) => Promise<StartConditions>> {
    const [officeWideLimit, usageSettings, weighed, standIns] = await Promise.all([
      this.limits.officeWideLimit(),
      this.limits.usageSettings(),
      this.tasks.summariesIn(STATES_A_START_WEIGHS),
      this.engineModels.standIns(),
    ]);
    const now = this.schedule.now();
    const estimateOf = await this.estimates.estimator(weighed);
    const daily = await this.dailyCaps.of(usageSettings.caps, weighed, estimateOf);
    const engineNames = new Map(standIns.engines.map(({ id, name }) => [id, name] as const));
    const scheduledExitWait = this.exitHold.waitWords();
    const standInEngineOf = onceByKey(
      (engineId: EngineId) => this.standInEngine(engineId, usageSettings.caps, daily),
      (engineId) => engineId,
    );
    const capable = this.engineSessions.capableOf(standIns.engines, AGENT_STAGE_NEEDS);
    const office = { daily, engineNames, now, standIns, standInEngineOf, capable };
    const reads = this.sharedReads();
    return async (task) => {
      const [pipeline, project, { usage, standIns: taskStandIns }] = await Promise.all([
        this.pipelineOf(task, reads),
        reads.projectOf(task.projectId),
        this.usageOf(task, estimateOf, usageSettings, office, reads),
      ]);
      const initiativeBranch = await this.initiativeBranchProblem(
        task,
        project?.name ?? task.projectId,
        reads,
      );
      const stages = pipeline && (await reads.heldStagesOf(pipeline));
      const role = stages && firstAgentStage(stages)?.role;
      const person = role === undefined ? undefined : await reads.personOf(role);
      return {
        stages,
        person: person?.card,
        officeWideLimit,
        project: project && { name: project.name, projectLimit: project.projectLimit },
        usage,
        standIns: taskStandIns,
        scheduledExitWait,
        initiativeBranch,
        brokenPipeline: pipeline && (await this.brokenPipeline(task, pipeline)),
      };
    };
  }

  /**
   * A Pipeline, its Stages with their duties' holders, a Project, an Initiative, a person and the
   * cascade's engines a Task's Stages run on, with the Stand-in Engine list that applies.
   */
  private sharedReads(): StartReads {
    return {
      pipelineOf: onceByKey(
        (pipelineId: string) => this.pipelines.read(pipelineId),
        (pipelineId) => pipelineId,
      ),
      heldStagesOf: onceByKey(
        (pipeline: KnownPipeline) => withDutiesHeld(pipeline.stages, this.people),
        (pipeline) => pipeline.id,
      ),
      projectOf: onceByKey(
        (projectId: string) => this.projects.find(projectId),
        (projectId) => projectId,
      ),
      initiativeOf: onceByKey(
        (initiativeId: string) => this.initiatives.find(initiativeId),
        (initiativeId) => initiativeId,
      ),
      personOf: onceByKey(
        (roleKey: string) => this.people.find(roleKey),
        (roleKey) => roleKey,
      ),
      cascadeOf: this.estimates.cascadeReader(),
    };
  }

  /** The Task's Pipeline: office-wide, or a Project Pipeline of its own Project, as another's is unknown. */
  private async pipelineOf(task: Task, reads: StartReads): Promise<KnownPipeline | undefined> {
    if (!hasPipeline(task)) return undefined;
    const pipeline = await reads.pipelineOf(task.pipelineId);
    return pipeline?.projectId === undefined || pipeline.projectId === task.projectId
      ? pipeline
      : undefined;
  }

  /** A Broken Pipeline holds Start unless the user edited the Task's own Stages for it. */
  private async brokenPipeline(
    task: Task,
    { name, broken = [] }: KnownPipeline,
  ): Promise<BrokenPipelineAtStart | undefined> {
    if (broken.length === 0 || (await this.stageEdits.editedForTask(task.id))) return undefined;
    return { name, reasons: broken };
  }

  /** Whether the Task's Initiative's branch, when it starts from one, is there in its Project. */
  private async initiativeBranchProblem(
    task: Task,
    projectName: string,
    reads: StartReads,
  ): Promise<InitiativeBranchProblem | undefined> {
    if (task.initiativeId === undefined) return undefined;
    const initiative = await reads.initiativeOf(task.initiativeId);
    let base;
    try {
      base = taskBranchBase(task, initiative, task.projectId, projectName);
    } catch (error) {
      if (!(error instanceof TaskRefused)) throw error;
      return { kind: "not-made", reason: error.message };
    }
    if (base.kind === "base-branch" || base.kind === "pull-request") return undefined;
    return (await this.initiativeBranches.exists(task.projectId, base.branch))
      ? undefined
      : { kind: "gone", branch: base.branch };
  }

  private async usageOf(
    task: Task,
    estimateOf: TaskEstimator,
    { measures, caps }: UsageSettings,
    { daily, engineNames, now, standIns, standInEngineOf, capable }: OfficeUsageAtStart,
    reads: StartReads,
  ): Promise<{ readonly usage: UsageAtStart; readonly standIns: StandInsAtStart }> {
    const [estimate, cascade] = await Promise.all([estimateOf(task), reads.cascadeOf(task)]);
    const engineIds = cascade.cascadeEngines;
    // With no Agent Stage on an engine nothing is handed on, so the Office's list stands in.
    const order = cascade.standIns ?? standIns.standInEngines;
    const listed = order.filter((engineId) => standIns.engines.some(({ id }) => id === engineId));
    const usage = {
      now,
      measures,
      estimate: estimate?.engines ?? [],
      windows: engineIds.flatMap((engineId) => this.windowsOf(engineId, caps) ?? []),
      daily: daily.filter(({ engineId }) => engineIds.includes(engineId)),
      engineNames,
      usedUp: engineIds.flatMap((engineId) => this.usedUpOf(engineId) ?? []),
    };
    return {
      usage,
      standIns: {
        engines: standIns.engines,
        order,
        cascadeEngines: engineIds,
        ...(engineIds.length > 0 && { capable }),
        standIns: engineIds.length === 0 ? [] : await readEach(listed, standInEngineOf),
      },
    };
  }

  /** A listed Stand-in Engine's windows, Daily caps, used-up windows and window ratios. */
  private async standInEngine(
    engineId: EngineId,
    caps: readonly EngineCaps[],
    daily: readonly DailyCapsAtStart[],
  ): Promise<StandInEngineAtStart> {
    return {
      engineId,
      windows: this.windowsOf(engineId, caps),
      daily: daily.find((engineDaily) => engineDaily.engineId === engineId),
      usedUp: this.usedUpOf(engineId),
      windowRatios: await this.estimates.windowRatiosOf(engineId),
    };
  }

  /** The engine id's windows as a Start weighs them; undefined while no Window cap is set for it. */
  private windowsOf(engineId: EngineId, caps: readonly EngineCaps[]): WindowsAtStart | undefined {
    const windowCaps = caps.find((engineCaps) => engineCaps.engineId === engineId)?.windows;
    if (!windowCaps) return undefined;
    const reading = this.windows.of(engineId);
    const startedSinceReading = reading
      ? this.startsSinceReading.expectedOf(engineId, reading.readAt)
      : NOTHING_SINCE_READING;
    return { engineId, caps: windowCaps, reading, startedSinceReading };
  }

  private usedUpOf(engineId: EngineId): UsedUpAtStart | undefined {
    const window = this.windows.usedUpUntil(engineId);
    return window === undefined
      ? undefined
      : { engineId, windowWords: usageWindowWords(window.window), until: window.until };
  }
}
