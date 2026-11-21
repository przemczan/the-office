import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Neighbours } from "../domain/manual-order.js";
import type { WorkFilter } from "../domain/person-tasks.js";
import type { ProjectFilter } from "../domain/project-filter.js";
import type { StateChange } from "../domain/state-change.js";
import type { Task, TaskMadeFor, TaskState, TaskSummary } from "../domain/task.js";
import type { TaskChange } from "../domain/task-changes.js";
import type { DependencyChanges } from "../domain/task-dependencies.js";
import type { TaskCreated, TaskReordered } from "../domain/task-events.js";

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
 * Which of a person's Tasks to read: those they created, those with a Thread with them and those
 * whose Pipeline has a Stage of theirs, by what other modules say of them, never archived ones.
 */
export interface PersonsTasksQuery {
  readonly roleKey: string;
  /** The Tasks with a Thread with the person. */
  readonly withThreads: readonly string[];
  /** The Pipelines with a Stage the person works. */
  readonly pipelineIds: readonly string[];
  /** The Tasks a Decision waiting on the user is open on, for Waiting on you. */
  readonly withOpenDecisions: readonly string[];
  readonly filter: WorkFilter;
  readonly projects: ProjectFilter;
  /** Only those created after the Task created at `at` with this id, the newest first. */
  readonly after: { readonly at: Date; readonly id: string } | undefined;
  readonly limit: number;
}

/** Some of the person's Tasks in the filter, with each filter's count and how many it hides. */
export interface PersonsTasksRead {
  readonly tasks: readonly Task[];
  /** In the Projects the Project filter shows. */
  readonly counts: Readonly<Record<WorkFilter, number>>;
  /** The person's Tasks the Project filter hides. */
  readonly elsewhere: number;
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

  /** Every Task without its long texts, in no particular order: for reads that never show them. */
  abstract summaries(): Promise<readonly TaskSummary[]>;

  /** The Tasks The Office made for `madeFor`, of the Project when one is given, in no order. */
  abstract madeFor(madeFor: TaskMadeFor, projectId?: string): Promise<readonly Task[]>;

  /** The Tasks in one of `states`, in no particular order. */
  abstract inStates(states: readonly TaskState[]): Promise<readonly Task[]>;

  /**
   * The Tasks `engineId`'s usage window holds Paused, in no particular order: none paused before
   * the engine was kept, nor one its Initiative's Pause took over.
   */
  abstract pausedByUsageWindowOn(engineId: string): Promise<readonly Task[]>;

  /** The ids of every Dropped Task, archived or not, in no particular order. */
  abstract droppedIds(): Promise<readonly string[]>;

  /** Those of the Tasks there are, by their ids, in no particular order. */
  abstract findAll(ids: readonly string[]): Promise<readonly Task[]>;

  /**
   * The person's Tasks in the filter, the newest created first, `limit` at most, filtered and
   * counted in the query, whatever the number of Tasks.
   */
  abstract personsTasks(query: PersonsTasksQuery): Promise<PersonsTasksRead>;

  /** The Task's kept state changes, oldest first; none for a Task The Office doesn't know. */
  abstract stateChangesOf(taskId: string): Promise<readonly StateChange[]>;

  /** The Tasks with a state change to Done at or after `since`, each once, archived ones too. */
  abstract doneSince(since: Date): Promise<readonly string[]>;

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
   * As `update`, with the Task's kept state changes read in the same hold, so no move slips in
   * between; `change` may ask other modules while the Task is held.
   */
  abstract updateWithStateChanges<Event extends DomainEvent>(
    id: string,
    change: (
      task: Task,
      stateChanges: readonly StateChange[],
    ) => Promise<TaskChange<Event> | undefined>,
  ): Promise<TaskUpdate<Event>>;

  /**
   * Applies `change` to every started Task as stored, holding Starts and those Tasks until the
   * results are saved, so no Task starts meanwhile. Returns the Tasks it changed, with their events.
   */
  abstract updateEveryStarted<Event extends DomainEvent>(
    change: (task: Task) => TaskChange<Event> | undefined,
  ): Promise<readonly TaskChange<Event>[]>;

  /**
   * As `update`, with every Task read in the same hold, which every change of dependencies takes,
   * so two changes at once can't close a cycle between them.
   */
  abstract changeDependencies<Event extends DomainEvent>(
    id: string,
    change: (task: Task, tasks: readonly Task[]) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>>;

  /**
   * As `changeDependencies`, for an added dependency that may change several Tasks
   * (dependencyChanges): saves every Task `change` changed in the one transaction, the Task held
   * and saved whole, the others' dependencies alone, and never those of a Task that has started
   * meanwhile. Answers the changes as saved.
   */
  abstract changeEveryDependency(
    id: string,
    change: (task: Task, tasks: readonly Task[]) => DependencyChanges,
  ): Promise<DependencyChanges>;

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
