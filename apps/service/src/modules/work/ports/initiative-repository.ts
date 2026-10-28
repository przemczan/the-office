import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Initiative } from "../domain/initiative.js";
import type { InitiativeChange } from "../domain/initiative-changes.js";
import type { Task } from "../domain/task.js";
import type { TaskChange } from "../domain/task-changes.js";
import type { TaskCreated } from "../domain/task-events.js";

/** The Initiative after an update, with the change's event, or undefined when nothing changed. */
export interface InitiativeUpdate<Event extends DomainEvent> {
  readonly initiative: Initiative;
  readonly event: Event | undefined;
}

/**
 * Where Initiatives are kept; one is made by shaping an Idea (IdeaRepository). Adding a Task and
 * every change hold the Initiative, so a Task can't join one that is becoming done.
 */
export abstract class InitiativeRepository {
  abstract find(id: string): Promise<Initiative | undefined>;

  /** Every Initiative, the newest first. */
  abstract list(): Promise<readonly Initiative[]>;

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
   * Saves the Task `create` makes in the Initiative from every key on the board, holding the
   * Initiative and the board's manual order meanwhile. Throws InitiativeNotFound as `update` does.
   */
  abstract addTask(
    id: string,
    create: (initiative: Initiative, takenOrders: readonly string[]) => TaskChange<TaskCreated>,
  ): Promise<TaskChange<TaskCreated>>;
}
