import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Neighbours } from "../domain/manual-order.js";
import type { Task } from "../domain/task.js";
import type { TaskChange } from "../domain/task-changes.js";
import type { TaskCreated, TaskReordered, TaskStarted } from "../domain/task-events.js";

/** The Task after an update, with the change's event, or undefined when nothing changed. */
export interface TaskUpdate<Event extends DomainEvent> {
  readonly task: Task;
  readonly event: Event | undefined;
}

/** The ids of the Tasks a moved Task lands between; undefined at either end of the column. */
export interface NeighbourIds {
  readonly above: string | undefined;
  readonly below: string | undefined;
}

/**
 * Where Tasks are kept. Whatever writes an order key holds the board's manual order until it is
 * saved, so two writes at once never take the same key.
 */
export abstract class TaskRepository {
  /** Saves the Task `create` makes from every key on the board. */
  abstract create(
    create: (takenOrders: readonly string[]) => TaskChange<TaskCreated>,
  ): Promise<TaskChange<TaskCreated>>;

  abstract find(id: string): Promise<Task | undefined>;

  /** Every Task, in no particular order. */
  abstract list(): Promise<readonly Task[]>;

  /**
   * Applies `change` to the Task as stored, holding it against other changes until the result is
   * saved. Saves nothing when `change` returns undefined; throws TaskNotFound when there is no
   * such Task.
   */
  abstract update<Event extends DomainEvent>(
    id: string,
    change: (task: Task) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>>;

  /**
   * As `update`, with every started Task (In progress, Waiting on you or Paused) read in the same
   * hold, so two Starts at once never both pass the limits. Throws TaskNotFound as `update` does.
   */
  abstract start(
    id: string,
    change: (task: Task, startedTasks: readonly Task[]) => TaskChange<TaskStarted>,
  ): Promise<TaskChange<TaskStarted>>;

  /**
   * As `update`, with the Task's neighbours and every other Task's key on the board read in the
   * same hold. Throws TaskNotFound when the Task or a neighbour isn't there.
   */
  abstract reorder(
    id: string,
    neighbourIds: NeighbourIds,
    change: (
      task: Task,
      neighbours: Neighbours,
      takenOrders: readonly string[],
    ) => TaskChange<TaskReordered> | undefined,
  ): Promise<TaskUpdate<TaskReordered>>;
}
