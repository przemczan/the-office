import { Injectable } from "@nestjs/common";
import { pageOf, type Page, type PageRequest } from "../../../platform/paging/page.js";
import {
  partIn,
  stagesWorkedBy,
  UNTITLED_THREAD,
  type PipelineWithStages,
  type WorkFilter,
} from "../domain/person-tasks.js";
import type { ProjectFilter } from "../domain/project-filter.js";
import type { Task } from "../domain/task.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { TaskDecisions } from "../ports/task-decisions.js";
import { TaskRepository } from "../ports/task-repository.js";
import { TaskThreads, type TaskThreadTitle } from "../ports/task-threads.js";

/** A Task the person has a part in, and that part in a few words. */
export interface PersonTask {
  readonly task: Task;
  readonly part: string;
}

/** A page of the person's Tasks, with each Work filter's count and how many the Project filter hides. */
export interface PersonTaskPage extends Page<PersonTask> {
  readonly counts: Readonly<Record<WorkFilter, number>>;
  readonly elsewhere: number;
}

/** Which page of the person's Tasks: in the Work filter and the Projects the Project filter shows. */
export interface PersonTasksRequest {
  readonly roleKey: string;
  readonly filter: WorkFilter;
  readonly projects: ProjectFilter;
  readonly page: PageRequest;
}

/**
 * A person's Work tab (prototypes/app/people.js): the Tasks they have a part in, a page at a time,
 * filtered and counted in the query. What other modules know, their Thread titles, the Pipelines'
 * Stages and the open Decisions, is read once each, whatever the number of Tasks and Threads.
 */
@Injectable()
export class PersonTasks {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly threads: TaskThreads,
    private readonly pipelines: KnownPipelines,
    private readonly decisions: TaskDecisions,
    private readonly people: KnownPeople,
  ) {}

  async page({ roleKey, filter, projects, page }: PersonTasksRequest): Promise<PersonTaskPage> {
    const [titles, pipelines, withOpenDecisions] = await Promise.all([
      this.threads.titlesOnTasksWith(roleKey),
      this.pipelines.every(),
      this.decisions.tasksWithOpenDecisions(),
    ]);
    const stagesWorked = stagesWorkedBy(
      pipelines,
      roleKey,
      await this.dutiesHeld(roleKey, pipelines),
    );
    const titlesByTask = titlesOf(titles);
    const found = await this.tasks.personsTasks({
      roleKey,
      withThreads: [...titlesByTask.keys()],
      pipelineIds: [...stagesWorked.keys()],
      withOpenDecisions,
      filter,
      projects,
      // One past the page, which tells whether another follows.
      after: page.after,
      limit: page.size + 1,
    });
    const tasks = pageOf(found.tasks, page, found.counts[filter], ({ createdAt, id }) => ({
      at: createdAt,
      id,
    }));
    return {
      ...tasks,
      rows: tasks.rows.map((task) => ({
        task,
        part: partIn(task, roleKey, titlesByTask.get(task.id) ?? [], stagesWorked),
      })),
      counts: found.counts,
      elsewhere: found.elsewhere,
    };
  }

  /** Those of the duties the Pipelines' Stages name that the person holds now. */
  private async dutiesHeld(
    roleKey: string,
    pipelines: readonly PipelineWithStages[],
  ): Promise<ReadonlySet<string>> {
    const named = new Set(
      pipelines.flatMap(({ stages }) => stages.flatMap(({ duty }) => (duty ? [duty] : []))),
    );
    if (named.size === 0) return new Set();
    const holders = await this.people.dutyHolders();
    return new Set([...named].filter((duty) => holders.get(duty) === roleKey));
  }
}

/** The person's Thread titles by their Task, in the order they came. */
function titlesOf(titles: readonly TaskThreadTitle[]): ReadonlyMap<string, readonly string[]> {
  const byTask = new Map<string, string[]>();
  for (const { taskId, title } of titles) {
    byTask.set(taskId, [...(byTask.get(taskId) ?? []), title ?? UNTITLED_THREAD]);
  }
  return byTask;
}
