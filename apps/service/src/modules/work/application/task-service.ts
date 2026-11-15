import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Author } from "../domain/author.js";
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
  pauseTaskForUsageWindow,
  reorderTask,
  resumeTask,
  resumeTaskAtReset,
  stopTask,
  type TaskChange,
} from "../domain/task-changes.js";
import { archiveTask, restoreTask } from "../domain/task-archive.js";
import { unfinishedPublishingTask } from "../domain/publishing-task.js";
import {
  addDependency,
  blockingTasks,
  blockPublishingTask,
  removeDependency,
} from "../domain/task-dependencies.js";
import {
  TaskResumed,
  type TaskMovedToProject,
  type TaskPaused,
  type UsageWindowRefusal,
} from "../domain/task-events.js";
import { isInitiativePaused } from "../domain/initiative-pause.js";
import { moveProblems, moveTask, type MoveGrounds } from "../domain/task-move.js";
import { changeCommitMessage, publishCommitMessage } from "../domain/task-commit-message.js";
import { changeDescription } from "../domain/task-description.js";
import { changeTags } from "../domain/task-tags.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import { TaskRefused } from "../domain/task-refused.js";
import { STARTED_STATES } from "../domain/task-states.js";
import { writtenParts, type WrittenPlanAndDefinitionOfDone } from "../domain/written-parts.js";
import { FireAlarmRepository } from "../ports/fire-alarm-repository.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { KnownProjects } from "../ports/known-projects.js";
import { ProjectWorktrees } from "../ports/project-worktrees.js";
import { TaskRepository, type NeighbourIds, type TaskUpdate } from "../ports/task-repository.js";
import { InitiativeBranching } from "./initiative-branching.js";

/** The Tasks use cases. Each change is saved first and its event published after. */
@Injectable()
export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly projects: KnownProjects,
    private readonly fireAlarm: FireAlarmRepository,
    private readonly worktrees: ProjectWorktrees,
    private readonly initiativeBranching: InitiativeBranching,
    private readonly initiatives: InitiativeRepository,
    private readonly events: EventBus,
  ) {}

  /**
   * A new Task in Backlog, with no Pipeline yet, last on the board, with a Plan and a Definition of
   * Done, unconfirmed, when its creator writes both.
   */
  async create(
    given: NewTask,
    createdBy: Author,
    written?: WrittenPlanAndDefinitionOfDone,
  ): Promise<Task> {
    if (!(await this.projects.find(given.projectId))) {
      const problems = [...newTaskProblems(given), ...writtenParts(written).problems];
      throw new TaskRefused([...problems, `There is no Project "${given.projectId}".`]);
    }
    const { task, event } = await this.repository.create((takenOrders) =>
      createTask(
        randomUUID(),
        given,
        {
          order: orderAfter(takenOrders),
          originIdeaId: undefined,
          initiativeId: undefined,
          createdBy,
        },
        new Date(),
        "backlog",
        written,
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

  /** The Task, archived ones too, or undefined when there is none of that id. */
  async find(id: string): Promise<Task | undefined> {
    return this.repository.find(id);
  }

  /** Those of the Tasks there are, archived ones too, by their ids, in one read. */
  async findAll(ids: readonly string[]): Promise<readonly Task[]> {
    return ids.length === 0 ? [] : this.repository.findAll(ids);
  }

  /** The Task's kept state changes, oldest first, each with who or what made it. */
  async stateChangesOf(taskId: string): Promise<readonly StateChange[]> {
    return this.repository.stateChangesOf(taskId);
  }

  /**
   * The Tasks it waits for, in the order they were added, and the Tasks that wait for it, in the
   * board's order; archived ones too.
   */
  async dependenciesOf(
    task: Task,
  ): Promise<{ readonly waitsFor: readonly Task[]; readonly waitingForIt: readonly Task[] }> {
    const board = await this.repository.list();
    const byId = new Map(board.map((each) => [each.id, each]));
    return {
      waitsFor: task.blockedBy.flatMap((id) => byId.get(id) ?? []),
      waitingForIt: board.filter((each) => each.blockedBy.includes(task.id)).toSorted(boardOrder),
    };
  }

  async changePriority(id: string, priority: Priority): Promise<Task> {
    return this.update(id, (task) => changePriority(task, priority));
  }

  /** The user's Description, until the Task starts. */
  async changeDescription(id: string, description: string): Promise<Task> {
    return this.update(id, (task) => changeDescription(task, description));
  }

  /**
   * The commit message Publish lands the Task as: the Planner's suggestion, an Agent Stage's update
   * or the user's, until the Task ends or Publish lands it.
   */
  async changeCommitMessage(id: string, message: string): Promise<Task> {
    return this.update(id, (task) => changeCommitMessage(task, message));
  }

  /** Publish landed the Task's commit message, which no longer changes from now on. */
  async markCommitMessagePublished(id: string): Promise<Task> {
    return this.update(id, (task) => publishCommitMessage(task, new Date()));
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

  /**
   * Every reason the Task can't move to another Project now, and with `projectId`, to that one,
   * as its Initiative's Pipeline weighs it; empty when it can.
   */
  async moveProblems(id: string, projectId?: string): Promise<readonly string[]> {
    const task = await this.read(id);
    const problems = moveProblems(
      task,
      await this.moveGrounds(task, await this.stateChangesOf(id)),
    );
    if (projectId === undefined || task.initiativeId === undefined) return problems;
    return [
      ...problems,
      ...(await this.initiativeBranching.newProjectProblems(task.initiativeId, projectId)),
    ];
  }

  /**
   * Move, by `by`, the user: the Task goes to another Project, with no Pipeline there yet, refused with
   * every reason it can't. Its history and worktree are read holding the Task, so a planning or a
   * person's Thread that opens meanwhile either refuses the Move or finds the Task moved. A Ready
   * Task leaves Ready in the same save, published after the Move, as a changing Save publishes it.
   */
  async move(id: string, projectId: string, by: Author): Promise<Task> {
    if (!(await this.projects.find(projectId))) {
      throw new TaskRefused([`There is no Project "${projectId}".`]);
    }
    const { initiativeId } = await this.read(id);
    if (initiativeId !== undefined) {
      // Refused here before any branch is made; the hold below judges the Move again.
      const problems = await this.moveProblems(id);
      if (problems.length > 0) throw new TaskRefused([...problems]);
      await this.initiativeBranching.forNewProject(initiativeId, projectId);
    }
    const { task, event } = await this.repository.updateWithStateChanges(
      id,
      async (held, stateChanges) =>
        moveTask(held, projectId, await this.moveGrounds(held, stateChanges), by),
    );
    await this.publishMove(event);
    if (event && task.initiativeId !== undefined) {
      await this.blockPublishingTaskIn(task.initiativeId, projectId, task.id);
    }
    return task;
  }

  /**
   * A Task moved into a Project whose Publishing Task isn't Done or Dropped becomes its blocker
   * (spec 2.1, "Publishing Tasks"), judged again holding the Initiative and the dependencies.
   */
  private async blockPublishingTaskIn(
    initiativeId: string,
    projectId: string,
    blockerId: string,
  ): Promise<void> {
    const publishing = unfinishedPublishingTask(
      (await this.repository.list()).filter((task) => task.initiativeId === initiativeId),
      projectId,
    );
    if (!publishing) return;
    const { event } = await this.initiatives.changeDependencies(
      initiativeId,
      publishing.id,
      (_, held, tasks) =>
        held.projectId === projectId && unfinishedPublishingTask([held], projectId)
          ? blockPublishingTask(held, blockerId, tasks)
          : undefined,
    );
    if (event) await this.events.publish(event);
  }

  /** The Tasks still holding the Task back: its blockers neither Done nor Dropped, in order. */
  async waitingFor(id: string): Promise<readonly Task[]> {
    const task = await this.read(id);
    if (task.blockedBy.length === 0) return [];
    const board = new Map((await this.repository.list()).map((each) => [each.id, each]));
    return blockingTasks(task.blockedBy.flatMap((blockerId) => board.get(blockerId) ?? []));
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
  async drop(id: string, by: Author): Promise<Task> {
    return this.update(id, (task) => changeTaskState(task, "dropped", by));
  }

  /** Takes a Done or Dropped Task off the board into the Archive, its state as it was. */
  async archive(id: string, by: Author): Promise<Task> {
    return this.update(id, (task) => archiveTask(task, new Date(), by));
  }

  /** Returns an archived Task to the board in the state it had. */
  async restore(id: string, by: Author): Promise<Task> {
    return this.update(id, (task) => restoreTask(task, new Date(), by));
  }

  /**
   * The user's Pause; TaskPaused tells Pipelines to hold its running Stage once the turn ends.
   */
  async pause(id: string, by: Author): Promise<Task> {
    return this.update(id, (task) => pauseTask(task, by));
  }

  /**
   * Holds the Task Paused as the user's Pause does, but by The Office, for a reason the walk can't
   * go on with, which its record gives.
   */
  async hold(id: string, reason: string): Promise<Task> {
    return this.update(id, (task) => pauseTask(task, { kind: "office", reason }));
  }

  /**
   * A pause by the usage window (spec §2.1): the Stage runner ended the run held as the engine
   * refused its turn, so TaskPaused by the usage window asks Pipelines for nothing; the Task resumes
   * at the window's reset (UsageWindowResumes). One paused by it already has its resume moved on.
   */
  async pauseForUsageWindow(id: string, refusal: UsageWindowRefusal): Promise<Task> {
    return this.update(id, (task) => pauseTaskForUsageWindow(task, refusal));
  }

  /**
   * The usage window's reset, for a Task it paused: resumed, so its Pipeline walks on where it was
   * held; while the fire alarm is on the alarm holds it instead, until the all clear. A Task the
   * user, the alarm or its Initiative holds by now, or whose reset moved on, stays as it is.
   */
  async resumeAtReset(id: string, now: Date): Promise<Task> {
    const fireAlarmOn = await this.fireAlarmOn();
    const { task, event } = await this.repository.update(id, (held) =>
      resumeTaskAtReset(held, { fireAlarmOn, now }),
    );
    // Read again after the save, as a Resume does: an alarm sounded meanwhile passed it by as Paused.
    if (event instanceof TaskResumed && (await this.fireAlarmOn())) {
      return this.update(id, pauseTaskForAlarm);
    }
    if (event) await this.events.publish(event);
    return task;
  }

  /** Holds the Task now; TaskStopped tells Pipelines to interrupt the Stage running. */
  async stop(id: string, by: Author): Promise<Task> {
    return this.update(id, (task) => stopTask(task, by));
  }

  /**
   * TaskResumed tells Pipelines to walk the Task's Stages on from where they were held. While the
   * fire alarm is on, the alarm holds the Task instead, until the all clear; while its Initiative
   * is paused, it is refused.
   */
  async resume(id: string, by: Author): Promise<Task> {
    const fireAlarmOn = await this.fireAlarmOn();
    const { task, event } = await this.resumeHeld(id, fireAlarmOn, by);
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

  /** Whether its Initiative is paused is read holding the Initiative, then the Task. */
  private async resumeHeld(
    id: string,
    fireAlarmOn: boolean,
    by: Author,
  ): Promise<TaskUpdate<TaskResumed | TaskPaused>> {
    const { initiativeId } = await this.read(id);
    if (initiativeId === undefined) {
      return this.repository.update(id, (held) =>
        resumeTask(held, { fireAlarmOn, initiativePaused: false }, by),
      );
    }
    return this.initiatives.changeTask(initiativeId, id, (initiative, held) =>
      resumeTask(held, { fireAlarmOn, initiativePaused: isInitiativePaused(initiative) }, by),
    );
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
