import { Injectable } from "@nestjs/common";
import type { DailyCapsAtStart, UsageAtStart, WindowsAtStart } from "../domain/cap-waits.js";
import type { Task } from "../domain/task.js";
import { firstAgentStage, type StartConditions } from "../domain/task-start.js";
import type { UsageSettings } from "../domain/usage-settings.js";
import { AccountWindows } from "../ports/account-windows.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { TaskRepository } from "../ports/task-repository.js";
import { OfficeLimits } from "./office-limits.js";
import { DailyCaps } from "./daily-caps.js";
import { StartsSinceReading } from "./starts-since-reading.js";
import { UsageEstimates } from "./usage-estimates.js";

const NOTHING_SINCE_READING = { fiveHour: 0, sevenDay: 0 };

/**
 * Gathers what Start weighs from the other modules: the Task's Pipeline, its person, the limit,
 * and its Usage estimate against the windows and the Daily caps of the engines it spends on.
 */
@Injectable()
export class StartConditionsReader {
  constructor(
    private readonly pipelines: KnownPipelines,
    private readonly people: KnownPeople,
    private readonly limits: OfficeLimits,
    private readonly tasks: TaskRepository,
    private readonly estimates: UsageEstimates,
    private readonly windows: AccountWindows,
    private readonly startsSinceReading: StartsSinceReading,
    private readonly dailyCaps: DailyCaps,
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
    const [officeWideLimit, usageSettings, everyTask] = await Promise.all([
      this.limits.officeWideLimit(),
      this.limits.usageSettings(),
      this.tasks.list(),
    ]);
    const now = new Date();
    const daily = await this.dailyCaps.of(usageSettings.caps, everyTask);
    return async (task) => {
      const [pipeline, usage] = await Promise.all([
        this.pipelines.find(task.pipelineId),
        this.usageOf(task, everyTask, usageSettings, daily, now),
      ]);
      const stage = pipeline && firstAgentStage(pipeline.stages);
      const person = stage && (await this.people.find(stage.role));
      return { stages: pipeline?.stages, person: person?.card, officeWideLimit, usage };
    };
  }

  private async usageOf(
    task: Task,
    everyTask: readonly Task[],
    { measures, caps }: UsageSettings,
    daily: readonly DailyCapsAtStart[],
    now: Date,
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
    };
  }
}
