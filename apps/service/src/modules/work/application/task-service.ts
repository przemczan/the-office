import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Author } from "../domain/author.js";
import { boardOrder, orderAfter } from "../domain/manual-order.js";
import { newTaskProblems, type NewTask, type Priority, type Task } from "../domain/task.js";
import {
  changePriority,
  changeStartedTaskState,
  changeTaskState,
  createTask,
  pauseTask,
  reorderTask,
  resumeTask,
  stopTask,
  type TaskChange,
} from "../domain/task-changes.js";
import { addDependency, removeDependency } from "../domain/task-dependencies.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import { TaskRefused } from "../domain/task-refused.js";
import { STARTED_STATES } from "../domain/task-states.js";
import { KnownProjects } from "../ports/known-projects.js";
import { TaskRepository, type NeighbourIds } from "../ports/task-repository.js";

/** The Tasks use cases. Each change is saved first and its event published after. */
@Injectable()
export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly projects: KnownProjects,
    private readonly events: EventBus,
  ) {}

  /** A new Task in Backlog, following the Project's default Pipeline, last on the board. */
  async create(given: NewTask, createdBy: Author): Promise<Task> {
    const project = await this.projects.find(given.projectId);
    if (!project) {
      const problems = newTaskProblems(given);
      throw new TaskRefused([...problems, `There is no Project "${given.projectId}".`]);
    }
    const { task, event } = await this.repository.create((takenOrders) =>
      createTask(
        randomUUID(),
        given,
        {
          pipelineId: project.defaultPipeline,
          order: orderAfter(takenOrders),
          originIdeaId: undefined,
          createdBy,
        },
        new Date(),
      ),
    );
    await this.events.publish(event);
    return task;
  }

  /** Every Task, in the board's order: by priority, then by manual order. */
  async list(): Promise<readonly Task[]> {
    return (await this.repository.list()).toSorted(boardOrder);
  }

  /** The Tasks at a desk: started and not yet Done or Dropped, each counting against the limits. */
  async listStarted(): Promise<readonly Task[]> {
    return (await this.list()).filter(({ state }) => STARTED_STATES.includes(state));
  }

  async read(id: string): Promise<Task> {
    const task = await this.repository.find(id);
    if (!task) throw new TaskNotFound(id);
    return task;
  }

  /** The Tasks it waits for, in the order they were added. */
  async blockersOf(task: Task): Promise<Task[]> {
    const tasks = new Map((await this.repository.list()).map((each) => [each.id, each]));
    return task.blockedBy.flatMap((id) => tasks.get(id) ?? []);
  }

  async changePriority(id: string, priority: Priority): Promise<Task> {
    return this.update(id, (task) => changePriority(task, priority));
  }

  /** Places a Task that hasn't started between its neighbours in its column of the board. */
  async reorder(id: string, neighbourIds: NeighbourIds): Promise<Task> {
    const { task, event } = await this.repository.reorder(id, neighbourIds, reorderTask);
    if (event) await this.events.publish(event);
    return task;
  }

  /** The Task waits for `blockerId` to be Done before it can start; any Task, in any Project. */
  async addDependency(id: string, blockerId: string): Promise<Task> {
    const { task, event } = await this.repository.changeDependencies(id, (held, tasks) =>
      addDependency(held, blockerId, tasks),
    );
    if (event) await this.events.publish(event);
    return task;
  }

  async removeDependency(id: string, blockerId: string): Promise<Task> {
    const { task, event } = await this.repository.changeDependencies(id, (held) =>
      removeDependency(held, blockerId),
    );
    if (event) await this.events.publish(event);
    return task;
  }

  async drop(id: string): Promise<Task> {
    return this.update(id, (task) => changeTaskState(task, "dropped"));
  }

  /** Holds the Task; TaskPaused tells Pipelines to hold its running Stage once the turn ends. */
  async pause(id: string): Promise<Task> {
    return this.update(id, pauseTask);
  }

  /** Holds the Task now; TaskStopped tells Pipelines to interrupt the Stage running. */
  async stop(id: string): Promise<Task> {
    return this.update(id, stopTask);
  }

  /** TaskResumed tells Pipelines to walk the Task's Stages on from where they were held. */
  async resume(id: string): Promise<Task> {
    return this.update(id, resumeTask);
  }

  /** Moves a started Task along its Pipeline: Pipelines' interpreter calls it, Start never does. */
  async changeState(id: string, state: Task["state"]): Promise<Task> {
    return this.update(id, (task) => changeStartedTaskState(task, state));
  }

  private async update<Event extends DomainEvent>(
    id: string,
    change: (task: Task) => TaskChange<Event> | undefined,
  ): Promise<Task> {
    const { task, event } = await this.repository.update(id, change);
    if (event) await this.events.publish(event);
    return task;
  }
}
