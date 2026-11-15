import { Injectable } from "@nestjs/common";
import { ScheduledExitHold } from "../../office-updates/index.js";
import { EngineModels, usageWindowWords, type EngineId } from "../../engine/index.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type {
  DailyCapsAtStart,
  UsageAtStart,
  UsedUpAtStart,
  WindowsAtStart,
} from "../domain/cap-waits.js";
import { hasPipeline, type Task } from "../domain/task.js";
import { taskBranchBase } from "../domain/task-branch-base.js";
import { TaskRefused } from "../domain/task-refused.js";
import {
  firstAgentStage,
  type BrokenPipelineAtStart,
  type InitiativeBranchProblem,
  type StartConditions,
} from "../domain/task-start.js";
import type { UsageSettings } from "../domain/usage-settings.js";
import { AccountWindows } from "../ports/account-windows.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownProjects } from "../ports/known-projects.js";
import { KnownPipelines, type KnownPipeline } from "../ports/known-pipelines.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { ProjectInitiativeBranches } from "../ports/project-initiative-branches.js";
import { TaskRepository } from "../ports/task-repository.js";
import { OfficeLimits } from "./office-limits.js";
import { DailyCaps } from "./daily-caps.js";
import { withDutiesHeld } from "./duty-holders.js";
import { StartsSinceReading } from "./starts-since-reading.js";
import { TaskStageEdits } from "./task-stage-edits.js";
import { UsageEstimates } from "./usage-estimates.js";

const NOTHING_SINCE_READING = { fiveHour: 0, sevenDay: 0 };

/** What every Task's Start weighs alike, read once for them all. */
interface OfficeUsageAtStart {
  readonly daily: readonly DailyCapsAtStart[];
  readonly engineNames: ReadonlyMap<EngineId, string>;
  readonly now: Date;
}

/**
 * Gathers what Start weighs from the other modules: the Task's Pipeline, its person, the limits,
 * its Initiative's branch when it starts from one, and its Usage estimate against the windows and
 * the Daily caps of the engines it spends on.
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
  ) {}

  async of(task: Task): Promise<StartConditions> {
    return (await this.reading())(task);
  }

  /** What each of `tasks` weighs, the Office's settings and Tasks read once for them all. */
  async ofEach(tasks: readonly Task[]): Promise<Map<string, StartConditions>> {
    const conditionsOf = await this.reading();
    const read = await Promise.all(
      tasks.map(async (task) => [task.id, await conditionsOf(task)] as const),
    );
    return new Map(read);
  }

  private async reading(): Promise<(task: Task) => Promise<StartConditions>> {
    const [officeWideLimit, usageSettings, everyTask, engines] = await Promise.all([
      this.limits.officeWideLimit(),
      this.limits.usageSettings(),
      this.tasks.list(),
      this.engineModels.engines(),
    ]);
    const now = this.schedule.now();
    const daily = await this.dailyCaps.of(usageSettings.caps, everyTask);
    const engineNames = new Map(engines.map(({ id, name }) => [id, name] as const));
    const scheduledExitWait = this.exitHold.waitWords();
    return async (task) => {
      const [pipeline, project, usage] = await Promise.all([
        this.pipelineOf(task),
        this.projects.find(task.projectId),
        this.usageOf(task, everyTask, usageSettings, { daily, engineNames, now }),
      ]);
      const initiativeBranch = await this.initiativeBranchProblem(
        task,
        project?.name ?? task.projectId,
      );
      const stages = pipeline && (await withDutiesHeld(pipeline.stages, this.people));
      const role = stages && firstAgentStage(stages)?.role;
      const person = role === undefined ? undefined : await this.people.find(role);
      return {
        stages,
        person: person?.card,
        officeWideLimit,
        project: project && { name: project.name, projectLimit: project.projectLimit },
        usage,
        scheduledExitWait,
        initiativeBranch,
        brokenPipeline: pipeline && (await this.brokenPipeline(task, pipeline)),
      };
    };
  }

  /** The Task's Pipeline: office-wide, or a Project Pipeline of its own Project, as another's is unknown. */
  private async pipelineOf(task: Task): Promise<KnownPipeline | undefined> {
    if (!hasPipeline(task)) return undefined;
    const pipeline = await this.pipelines.read(task.pipelineId);
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
  ): Promise<InitiativeBranchProblem | undefined> {
    if (task.initiativeId === undefined) return undefined;
    const initiative = await this.initiatives.find(task.initiativeId);
    let base;
    try {
      base = taskBranchBase(task, initiative, task.projectId, projectName);
    } catch (error) {
      if (!(error instanceof TaskRefused)) throw error;
      return { kind: "not-made", reason: error.message };
    }
    if (base.kind === "base-branch") return undefined;
    return (await this.initiativeBranches.exists(task.projectId, base.branch))
      ? undefined
      : { kind: "gone", branch: base.branch };
  }

  private async usageOf(
    task: Task,
    everyTask: readonly Task[],
    { measures, caps }: UsageSettings,
    { daily, engineNames, now }: OfficeUsageAtStart,
  ): Promise<UsageAtStart> {
    const [estimate, engineIds] = await Promise.all([
      this.estimates.of(task, everyTask),
      this.estimates.engineIdsOf(task),
    ]);
    const windows = engineIds.flatMap((engineId): WindowsAtStart[] => {
      const windowCaps = caps.find((engineCaps) => engineCaps.engineId === engineId)?.windows;
      if (!windowCaps) return [];
      const reading = this.windows.of(engineId);
      const startedSinceReading = reading
        ? this.startsSinceReading.expectedOf(engineId, reading.readAt)
        : NOTHING_SINCE_READING;
      return [{ engineId, caps: windowCaps, reading, startedSinceReading }];
    });
    const usedUp = engineIds.flatMap((engineId): UsedUpAtStart[] => {
      const window = this.windows.usedUpUntil(engineId);
      return window === undefined
        ? []
        : [{ engineId, windowWords: usageWindowWords(window.window), until: window.until }];
    });
    return {
      now,
      measures,
      estimate: estimate?.engines ?? [],
      windows,
      daily: daily.filter(({ engineId }) => engineIds.includes(engineId)),
      engineNames,
      usedUp,
    };
  }
}
