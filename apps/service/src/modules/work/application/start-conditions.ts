import { Injectable } from "@nestjs/common";
import { OFFICE_UPDATE_SCHEDULED, OfficeUpdateHold } from "../../office-updates/index.js";
import { EngineModels, type EngineId } from "../../engine/index.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { DailyCapsAtStart, UsageAtStart, WindowsAtStart } from "../domain/cap-waits.js";
import type { Task } from "../domain/task.js";
import { firstAgentStage, type StartConditions } from "../domain/task-start.js";
import type { UsageSettings } from "../domain/usage-settings.js";
import { AccountWindows } from "../ports/account-windows.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownProjects } from "../ports/known-projects.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { TaskRepository } from "../ports/task-repository.js";
import { OfficeLimits } from "./office-limits.js";
import { DailyCaps } from "./daily-caps.js";
import { StartsSinceReading } from "./starts-since-reading.js";
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
 * and its Usage estimate against the windows and the Daily caps of the engines it spends on.
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
    private readonly updateHold: OfficeUpdateHold,
    private readonly schedule: Schedule,
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
    const officeUpdateHold = this.updateHold.isScheduled() ? OFFICE_UPDATE_SCHEDULED : undefined;
    return async (task) => {
      const [pipeline, project, usage] = await Promise.all([
        this.pipelines.find(task.pipelineId),
        this.projects.find(task.projectId),
        this.usageOf(task, everyTask, usageSettings, { daily, engineNames, now }),
      ]);
      const stage = pipeline && firstAgentStage(pipeline.stages);
      const person = stage && (await this.people.find(stage.role));
      return {
        stages: pipeline?.stages,
        person: person?.card,
        officeWideLimit,
        project: project && { name: project.name, projectLimit: project.projectLimit },
        usage,
        officeUpdateHold,
      };
    };
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
    return {
      now,
      measures,
      estimate: estimate?.engines ?? [],
      windows,
      daily: daily.filter(({ engineId }) => engineIds.includes(engineId)),
      engineNames,
    };
  }
}
