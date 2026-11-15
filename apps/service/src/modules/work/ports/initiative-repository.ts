import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Initiative } from "../domain/initiative.js";
import type { ArchivePage, ArchiveSearch } from "../domain/initiative-archive.js";
import type {
  InitiativeChange,
  InitiativeSettling,
  InitiativeTaskAdded,
  InitiativeTasksChange,
} from "../domain/initiative-changes.js";
import type { InitiativeCreated } from "../domain/initiative-events.js";
import type { InitiativeMembershipChange } from "../domain/initiative-membership.js";
import type { Task } from "../domain/task.js";
import type { TaskChange } from "../domain/task-changes.js";
import type { DependencyChanges } from "../domain/task-dependencies.js";
import type {
  TaskAddedToInitiative,
  TaskStateChanged,
  TaskTakenOutOfInitiative,
} from "../domain/task-events.js";
import type { TaskUpdate } from "./task-repository.js";

/** The Initiative after an update, with the change's event, or undefined when nothing changed. */
export interface InitiativeUpdate<Event extends DomainEvent> {
  readonly initiative: Initiative;
  readonly event: Event | undefined;
}

/** As InitiativeUpdate, with the changes saved on its Tasks: none when nothing changed. */
export interface InitiativeTasksUpdate<Event extends DomainEvent> extends InitiativeUpdate<Event> {
  readonly taskChanges: readonly TaskChange<DomainEvent>[];
}

/**
 * Where Initiatives are kept; one is made by shaping an Idea (IdeaRepository) or created from none
 * (`insert`). Adding a Task and every change hold the Initiative, so a Task can't join one that is
 * becoming done, and what a change may do is decided from the Initiative as held.
 */
export abstract class InitiativeRepository {
  abstract find(id: string): Promise<Initiative | undefined>;

  /** Saves a new Initiative that comes from no Idea. */
  abstract insert(change: InitiativeChange<InitiativeCreated>): Promise<void>;

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
   * As `updateWithTasks` for a change of its Tasks alone: the Initiative stays as it is, held so
   * its state is read as it stays. Saves `change`'s Task changes and answers them.
   */
  abstract changeTasks(
    id: string,
    change: (
      initiative: Initiative,
      tasks: readonly Task[],
    ) => readonly TaskChange<TaskStateChanged>[],
  ): Promise<readonly TaskChange<TaskStateChanged>[]>;

  /**
   * As `update`, holding every Initiative's Short name too and giving `change` those the other
   * Initiatives hold, so no two derive or write the same one.
   */
  abstract updateNaming<Event extends DomainEvent>(
    id: string,
    change: (
      initiative: Initiative,
      takenShortNames: ReadonlySet<string>,
    ) => InitiativeChange<Event> | undefined,
  ): Promise<InitiativeUpdate<Event>>;

  /**
   * Saves the Task `create` makes in the Initiative from every key on the board and every Task,
   * and the Publishing Task it blocks, holding the board's manual order, the Initiative, every
   * change of dependencies and the Initiative's Tasks meanwhile, so the Tasks it waits for are
   * judged as they stay. Throws InitiativeNotFound as `update` does.
   */
  abstract addTask(
    id: string,
    create: (
      initiative: Initiative,
      takenOrders: readonly string[],
      tasks: readonly Task[],
    ) => InitiativeTaskAdded,
  ): Promise<InitiativeTaskAdded>;

  /**
   * The Initiative's done check (settleInitiative): `settle` judges it from the Initiative and its
   * Tasks as held, holding the board's manual order, the Initiative and every change of
   * dependencies in that order, the one every hold of them takes, and saves the Publishing Tasks it
   * adds and the Initiative's move in one transaction. Throws InitiativeNotFound as `update` does.
   */
  abstract settle(
    id: string,
    settle: (
      initiative: Initiative,
      tasks: readonly Task[],
      takenOrders: readonly string[],
    ) => InitiativeSettling,
  ): Promise<InitiativeSettling>;

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
   * As `changeDependencies`, for an added dependency that may change several Tasks, saved as
   * TaskRepository.changeEveryDependency saves them, holding the Initiative first.
   */
  abstract changeEveryDependency(
    id: string,
    taskId: string,
    change: (initiative: Initiative, task: Task, tasks: readonly Task[]) => DependencyChanges,
  ): Promise<DependencyChanges>;

  /**
   * Applies `change`, a Task joining or leaving the Initiative, holding the Initiative, every change
   * of dependencies, the Initiative's Tasks and the Task's row, in that order, so its state, its
   * Initiative and the Publishing Task it waits in are read as they stay; `change` is given every
   * Task and may read what else it needs, such as the worktree, in the hold. Saves the Task and the
   * Publishing Task's change in one transaction, every move kept in the Task's record, and nothing
   * when `change` answers undefined. Throws InitiativeNotFound as `update` does, and TaskNotFound
   * when there is no such Task.
   */
  abstract changeMembership<Event extends TaskAddedToInitiative | TaskTakenOutOfInitiative>(
    id: string,
    taskId: string,
    change: (
      initiative: Initiative,
      task: Task,
      tasks: readonly Task[],
    ) => Promise<InitiativeMembershipChange<Event> | undefined>,
  ): Promise<InitiativeMembershipChange<Event> | undefined>;

  /**
   * Applies `change` to one Task as stored, holding the Initiative first and then the Task's row,
   * so whether it has started and whether the Initiative is shaping are both read as they stay; the
   * Initiative's Tasks are read in the hold, the Task among them as it was before the change.
   * Saves nothing when `change` returns undefined. Throws InitiativeNotFound as `update` does, and
   * TaskNotFound when there is no such Task.
   */
  abstract changeTask<Event extends DomainEvent>(
    id: string,
    taskId: string,
    change: (
      initiative: Initiative,
      task: Task,
      tasks: readonly Task[],
    ) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>>;
}
