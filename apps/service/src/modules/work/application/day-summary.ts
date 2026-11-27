import { Injectable } from "@nestjs/common";
import { officeDayBounds, officeDayOf } from "../../../platform/office-day.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import {
  groupDay,
  taskDoneOf,
  type DayFacts,
  type DayFailedOrDropped,
  type DayGroups,
  type DayInitiative,
  type DayPullRequestMerged,
} from "../domain/day-summary.js";
import { initiativeProjectIds } from "../domain/initiative.js";
import type { ProjectFilter } from "../domain/project-filter.js";
import { DayOutcomes, type DayTokens } from "../ports/day-outcomes.js";
import { DayRecords, type DayRecordMoment } from "../ports/day-records.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { TaskRepository } from "../ports/task-repository.js";

/** One office day as the Days tab shows it. */
export interface DaySummary extends DayGroups {
  readonly day: string;
  /** The office day now by the service's clock. */
  readonly today: string;
  /** Office-wide, whatever the Project filter. */
  readonly tokens: DayTokens;
}

/**
 * What The Office did on an office day (spec 2.1, Days): Work's records of the day joined to their
 * Tasks, Initiatives and Ideas, and what Notifications counted (the day's tokens and the Tasks that
 * failed) through `DayOutcomes`, by ids and figures. No model call.
 */
@Injectable()
export class DaySummaries {
  constructor(
    private readonly records: DayRecords,
    private readonly outcomes: DayOutcomes,
    private readonly tasks: TaskRepository,
    private readonly initiatives: InitiativeRepository,
    private readonly ideas: IdeaRepository,
    private readonly schedule: Schedule,
  ) {}

  /** The service's office day now. */
  today(): string {
    return officeDayOf(this.schedule.now());
  }

  /** The day's summary; `day` is an office day that is real and no later than `today()`. */
  async read(day: string, projects: ProjectFilter): Promise<DaySummary> {
    const range = officeDayBounds(day);
    if (!range) throw new Error(`${day} is not an office day.`);
    const [done, dropped, started, merged, initiativesDone, captured, failed, tokens] =
      await Promise.all([
        this.records.tasksDone(range),
        this.records.tasksDropped(range),
        this.records.tasksStarted(range),
        this.records.pullRequestsMerged(range),
        this.records.initiativesDone(range),
        this.records.ideasCaptured(range),
        this.outcomes.failedTasks(day),
        this.outcomes.tokens(day),
      ]);
    const taskIds = new Set([
      ...[...done, ...dropped, ...started, ...merged].map(({ id }) => id),
      ...failed.map(({ taskId }) => taskId),
    ]);
    const known = new Map(
      (await this.tasks.findAll([...taskIds])).map((task) => [task.id, task] as const),
    );
    const facts: DayFacts = {
      initiativesDone: await this.initiativesOf(initiativesDone),
      tasksDone: moments(done, known).map(({ task, at }) => taskDoneOf(task, at)),
      pullRequestsMerged: moments(merged, known).flatMap(({ task }): DayPullRequestMerged[] => {
        const { pullRequestEnd } = task;
        if (pullRequestEnd?.outcome !== "merged") return [];
        return [
          {
            taskId: task.id,
            title: task.title,
            projectId: task.projectId,
            number: pullRequestEnd.number,
            url: pullRequestEnd.url,
            by: pullRequestEnd.by,
            at: pullRequestEnd.at,
          },
        ];
      }),
      failedOrDropped: [
        ...moments(dropped, known).map(({ task, at }): DayFailedOrDropped => ({
          outcome: "dropped",
          taskId: task.id,
          title: task.title,
          projectId: task.projectId,
          stageName: undefined,
          dropReason: task.dropReason,
          at,
        })),
        ...failed.flatMap(({ taskId, stageName, at }): DayFailedOrDropped[] => {
          const task = known.get(taskId);
          return task
            ? [
                {
                  outcome: "failed",
                  taskId,
                  title: task.title,
                  projectId: task.projectId,
                  stageName,
                  dropReason: undefined,
                  at,
                },
              ]
            : [];
        }),
      ],
      ideasCaptured: await this.ideasOf(captured),
      tasksStarted: moments(started, known).map(({ task, at }) => ({
        id: task.id,
        title: task.title,
        projectId: task.projectId,
        at,
      })),
    };
    return { day, today: this.today(), ...groupDay(facts, projects), tokens };
  }

  private async initiativesOf(done: readonly DayRecordMoment[]): Promise<DayInitiative[]> {
    if (done.length === 0) return [];
    const found = await Promise.all(
      done.map(async ({ id, at }) => ({ initiative: await this.initiatives.find(id), at })),
    );
    const tasksOf = await this.tasks.inInitiatives(done.map(({ id }) => id));
    return found.flatMap(({ initiative, at }) => {
      if (!initiative) return [];
      const tasks = tasksOf.filter(({ initiativeId }) => initiativeId === initiative.id);
      return [
        {
          id: initiative.id,
          name: initiative.name,
          projectIds: initiativeProjectIds(tasks),
          taskCount: tasks.length,
          at,
        },
      ];
    });
  }

  private async ideasOf(captured: readonly DayRecordMoment[]) {
    const found = await Promise.all(
      captured.map(async ({ id, at }) => ({ idea: await this.ideas.find(id), at })),
    );
    return found.flatMap(({ idea, at }) =>
      idea ? [{ id: idea.id, title: idea.title, projectId: idea.projectId, at }] : [],
    );
  }
}

/** The moments whose Task is known, each with it. */
function moments<TaskRecord>(
  found: readonly DayRecordMoment[],
  known: ReadonlyMap<string, TaskRecord>,
): { task: TaskRecord; at: Date }[] {
  return found.flatMap(({ id, at }) => {
    const task = known.get(id);
    return task ? [{ task, at }] : [];
  });
}
