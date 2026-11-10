import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Initiative } from "../domain/initiative.js";
import type { ArchivePage, ArchiveSearch } from "../domain/initiative-archive.js";
import type { InitiativeChange, InitiativeTasksChange } from "../domain/initiative-changes.js";
import type { Task } from "../domain/task.js";
import type { TaskChange } from "../domain/task-changes.js";
import type { TaskCreated, TaskStateChanged } from "../domain/task-events.js";
import type { TaskUpdate } from "./task-repository.js";

/** The Initiative after an update, with the change's event, or undefined when nothing changed. */
export interface InitiativeUpdate<Event extends DomainEvent> {
  readonly initiative: Initiative;
  readonly event: Event | undefined;
}

/** As InitiativeUpdate, with the changes saved on its Tasks: none when nothing changed. */
export interface InitiativeTasksUpdate<Event extends DomainEvent> extends InitiativeUpdate<Event> {
  readonly taskChanges: readonly TaskChange<TaskStateChanged>[];
}

/**
 * Where Initiatives are kept; one is made by shaping an Idea (IdeaRepository). Adding a Task and
 * every change hold the Initiative, so a Task can't join one that is becoming done, and what a
 * change may do is decided from the Initiative as held.
 */
export abstract class InitiativeRepository {
  abstract find(id: string): Promise<Initiative | undefined>;

  /** Every Initiative, archived ones too, the newest first. */
  abstract list(): Promise<readonly Initiative[]>;

  /** A page of the Archive, searched, filtered and counted in the store. */
  abstract archived(search: ArchiveSearch): Promise<ArchivePage>;

  /**
   * Applies `change` to the Initiative as stored, with its Tasks, holding it until the result is
   * saved. Saves nothing when `change` returns undefined; throws InitiativeNotFound when there is
   * no such Initiative.
   */
  abstract update<Event extends DomainEvent>(
    id: string,
    change: (initiative: Initiative, tasks: readonly Task[]) => InitiativeChange<Event> | undefined,
  ): Promise<InitiativeUpdate<Event>>;

  /**
   * As `update`, holding the rows of its Tasks too, and saving the Initiative and each of its
   * Tasks' changes in one transaction, every move kept in their records.
   */
  abstract updateWithTasks<Event extends DomainEvent>(
    id: string,
    change: (
      initiative: Initiative,
      tasks: readonly Task[],
    ) => InitiativeTasksChange<Event> | undefined,
  ): Promise<InitiativeTasksUpdate<Event>>;

  /**
   * Saves the Task `create` makes in the Initiative from every key on the board and every Task,
   * holding the board's manual order, the Initiative and every change of dependencies meanwhile, so
   * the Tasks it waits for are judged as they stay. Throws InitiativeNotFound as `update` does.
   */
  abstract addTask(
    id: string,
    create: (
      initiative: Initiative,
      takenOrders: readonly string[],
      tasks: readonly Task[],
    ) => TaskChange<TaskCreated>,
  ): Promise<TaskChange<TaskCreated>>;

  /**
   * Applies `change` to the Task's dependencies as TaskRepository.changeDependencies does, holding
   * the Initiative first and then taking that lock, every Task read in the hold. Throws
   * InitiativeNotFound as `update` does, and TaskNotFound when there is no such Task.
   */
  abstract changeDependencies<Event extends DomainEvent>(
    id: string,
    taskId: string,
    change: (
      initiative: Initiative,
      task: Task,
      tasks: readonly Task[],
    ) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>>;

  /**
   * Applies `change` to one Task as stored, holding the Initiative first and then the Task's row,
   * so whether it has started and whether the Initiative is shaping are both read as they stay.
   * Saves nothing when `change` returns undefined. Throws InitiativeNotFound as `update` does, and
   * TaskNotFound when there is no such Task.
   */
  abstract changeTask<Event extends DomainEvent>(
    id: string,
    taskId: string,
    change: (initiative: Initiative, task: Task) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>>;
}
