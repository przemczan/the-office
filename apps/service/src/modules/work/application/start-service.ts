import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Task } from "../domain/task.js";
import {
  firstAgentStage,
  startProblems,
  startTask,
  type StartConditions,
} from "../domain/task-start.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import { KnownPeople } from "../ports/known-people.js";
import { KnownPipelines } from "../ports/known-pipelines.js";
import { KnownProjects } from "../ports/known-projects.js";
import { TaskRepository } from "../ports/task-repository.js";
import { WorkSettings } from "../ports/work-settings.js";

/**
 * Start, the user's call on a Ready Task (spec §9): refused with the reasons, or the Task moves to
 * In progress and TaskStarted tells Pipelines to make its own Stages and run them.
 */
@Injectable()
export class StartService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly projects: KnownProjects,
    private readonly pipelines: KnownPipelines,
    private readonly people: KnownPeople,
    private readonly settings: WorkSettings,
    private readonly events: EventBus,
  ) {}

  async start(id: string): Promise<Task> {
    const conditions = await this.conditionsOf(await this.read(id));
    const { task, event } = await this.repository.start(id, (held, heldAtStart) =>
      startTask(held, conditions, heldAtStart),
    );
    await this.events.publish(event);
    return task;
  }

  /** Why the Task can't start now, for the Task page to show beside Start; empty when it can. */
  async startProblems(id: string): Promise<readonly string[]> {
    const task = await this.read(id);
    const tasks = await this.repository.list();
    const blockers = tasks.filter(({ id: other }) => task.blockedBy.includes(other));
    return startProblems(task, await this.conditionsOf(task), { startedTasks: tasks, blockers });
  }

  private async read(id: string): Promise<Task> {
    const task = await this.repository.find(id);
    if (!task) throw new TaskNotFound(id);
    return task;
  }

  private async conditionsOf(task: Task): Promise<StartConditions> {
    const [project, pipeline, officeWideLimit] = await Promise.all([
      this.projects.find(task.projectId),
      this.pipelines.find(task.pipelineId),
      this.settings.officeWideLimit(),
    ]);
    const stage = pipeline && firstAgentStage(pipeline.stages);
    const person = stage && (await this.people.find(stage.role));
    return {
      projectName: project?.name ?? task.projectId,
      stages: pipeline?.stages,
      person: person?.card,
      officeWideLimit,
    };
  }
}
