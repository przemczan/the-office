import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { THE_USER, type Author } from "../domain/author.js";
import { boardOrder, orderAfter } from "../domain/manual-order.js";
import type { StateChange } from "../domain/state-change.js";
import { newTaskProblems, type NewTask, type Priority, type Task } from "../domain/task.js";
import {
  changePriority,
  changeStartedTaskState,
  changeTaskState,
  createTask,
  pauseTask,
  pauseTaskForAlarm,
  reorderTask,
  resumeTask,
  stopTask,
  type TaskChange,
} from "../domain/task-changes.js";
import { archiveTask, restoreTask } from "../domain/task-archive.js";
import { addDependency, removeDependency } from "../domain/task-dependencies.js";
import { TaskResumed, type TaskMovedToProject } from "../domain/task-events.js";
import { moveProblems, moveTask, type MoveGrounds } from "../domain/task-move.js";
import { changeDescription } from "../domain/task-description.js";
import { changeTags } from "../domain/task-tags.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import { TaskRefused } from "../domain/task-refused.js";
import { STARTED_STATES } from "../domain/task-states.js";
import { FireAlarmRepository } from "../ports/fire-alarm-repository.js";
import { KnownProjects } from "../ports/known-projects.js";
import { ProjectWorktrees } from "../ports/project-worktrees.js";
import { TaskRepository, type NeighbourIds } from "../ports/task-repository.js";

/** The Tasks use cases. Each change is saved first and its event published after. */
@Injectable()
export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly projects: KnownProjects,
    private readonly fireAlarm: FireAlarmRepository,
    private readonly worktrees: ProjectWorktrees,
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
          initiativeId: undefined,
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

  /** Every Tag on a Task, each once, in alphabetical order. */
  async tagsInUse(): Promise<string[]> {
    const tags = new Set((await this.repository.list()).flatMap((task) => task.tags));
    return [...tags].toSorted();
  }

  async read(id: string): Promise<Task> {
    const task = await this.repository.find(id);
    if (!task) throw new TaskNotFound(id);
    return task;
  }

  /** The Task's kept state changes, oldest first, each with who or what made it. */
  async stateChangesOf(taskId: string): Promise<readonly StateChange[]> {
    return this.repository.stateChangesOf(taskId);
  }

  /** The Tasks it waits for, in the order they were added. */
  async blockersOf(task: Task): Promise<Task[]> {
    const tasks = new Map((await this.repository.list()).map((each) => [each.id, each]));
    return task.blockedBy.flatMap((id) => tasks.get(id) ?? []);
  }

  async changePriority(id: string, priority: Priority): Promise<Task> {
    return this.update(id, (task) => changePriority(task, priority));
  }

  /** The user's Description, until the Task starts. */
  async changeDescription(id: string, description: string): Promise<Task> {
    return this.update(id, (task) => changeDescription(task, description));
  }

  /** Sets the Task's Tags, in any state: the user's or the Planner's. */
  async changeTags(id: string, tags: readonly string[]): Promise<Task> {
    return this.update(id, (task) => changeTags(task, tags));
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

  /** Every reason the Task can't move to another Project now; empty when it can. */
  async moveProblems(id: string): Promise<readonly string[]> {
    const task = await this.read(id);
    return moveProblems(task, await this.moveGrounds(task, await this.stateChangesOf(id)));
  }

  /**
   * Move, by the user: the Task goes to another Project and its default Pipeline, refused with
   * every reason it can't. Its history and worktree are read holding the Task, so a planning or a
   * person's Thread that opens meanwhile either refuses the Move or finds the Task moved. A Ready
   * Task leaves Ready in the same save, published after the Move, as a changing Save publishes it.
   */
  async move(id: string, projectId: string): Promise<Task> {
    const project = await this.projects.find(projectId);
    if (!project) throw new TaskRefused([`There is no Project "${projectId}".`]);
    const destination = { projectId, defaultPipeline: project.defaultPipeline };
    const { task, event } = await this.repository.updateWithStateChanges(
      id,
      async (held, stateChanges) =>
        moveTask(held, destination, await this.moveGrounds(held, stateChanges), THE_USER),
    );
    await this.publishMove(event);
    return task;
  }

  /**
   * Whether the Task is in the Project, read holding it: a Move holds it while it reads the
   * worktree, so one that found none has saved before this reads, or reads after a worktree made
   * before this call.
   */
  async isInProject(id: string, projectId: string): Promise<boolean> {
    const { task } = await this.repository.update(id, () => undefined);
    return task.projectId === projectId;
  }

  /** Drops the Task, by the user: on its page, or by their answer to a Decision. */
  async drop(id: string): Promise<Task> {
    return this.update(id, (task) => changeTaskState(task, "dropped", THE_USER));
  }

  /** Takes a Done or Dropped Task off the board into the Archive, its state as it was. */
  async archive(id: string): Promise<Task> {
    return this.update(id, (task) => archiveTask(task, new Date()));
  }

  /** Returns an archived Task to the board in the state it had. */
  async restore(id: string): Promise<Task> {
    return this.update(id, (task) => restoreTask(task, new Date()));
  }

  /**
   * The user's Pause; TaskPaused tells Pipelines to hold its running Stage once the turn ends.
   */
  async pause(id: string): Promise<Task> {
    return this.update(id, (task) => pauseTask(task, THE_USER));
  }

  /**
   * Holds the Task Paused as the user's Pause does, but by The Office, for a reason the walk can't
   * go on with, which its record gives.
   */
  async hold(id: string, reason: string): Promise<Task> {
    return this.update(id, (task) => pauseTask(task, { kind: "office", reason }));
  }

  /** Holds the Task now; TaskStopped tells Pipelines to interrupt the Stage running. */
  async stop(id: string): Promise<Task> {
    return this.update(id, stopTask);
  }

  /**
   * TaskResumed tells Pipelines to walk the Task's Stages on from where they were held. While the
   * fire alarm is on, the alarm holds the Task instead, until the all clear.
   */
  async resume(id: string): Promise<Task> {
    const fireAlarmOn = await this.fireAlarmOn();
    const { task, event } = await this.repository.update(id, (held) =>
      resumeTask(held, { fireAlarmOn }),
    );
    // Read again after the save: an alarm sounded meanwhile may have passed the Task by as Paused.
    if (event instanceof TaskResumed && (await this.fireAlarmOn())) {
      return this.update(id, pauseTaskForAlarm);
    }
    if (event) await this.events.publish(event);
    return task;
  }

  /**
   * Pauses a Task In progress or Waiting on you as the fire alarm does, if it is on: as The Office
   * starts again, for a sounding it stopped during. Whether the alarm is on.
   */
  async holdForFireAlarm(id: string): Promise<boolean> {
    if (!(await this.fireAlarmOn())) return false;
    await this.update(id, pauseTaskForAlarm);
    return true;
  }

  /** Moves a started Task along its Pipeline: Pipelines' interpreter calls it, Start never does. */
  async changeState(id: string, state: Task["state"]): Promise<Task> {
    return this.update(id, (task) => changeStartedTaskState(task, state));
  }

  private async moveGrounds(
    task: Task,
    stateChanges: MoveGrounds["stateChanges"],
  ): Promise<MoveGrounds> {
    return { stateChanges, hasWorktree: await this.worktrees.exists(task.projectId, task.id) };
  }

  private async publishMove(event: TaskMovedToProject | undefined): Promise<void> {
    if (!event) return;
    await this.events.publish(event);
    if (event.leftReady) await this.events.publish(event.leftReady);
  }

  private async fireAlarmOn(): Promise<boolean> {
    return (await this.fireAlarm.read()).on;
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
