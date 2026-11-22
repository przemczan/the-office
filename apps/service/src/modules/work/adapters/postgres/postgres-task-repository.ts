import { Inject, Injectable } from "@nestjs/common";
import {
  and,
  arrayContains,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  not,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads, readKey, readOnce } from "../../../../platform/database/read-scope.js";
import { afterCursor, newestFirst } from "../../../../platform/database/page-sql.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import type { Neighbours } from "../../domain/manual-order.js";
import {
  WAITS_ON_YOU_IN_ITS_STATE,
  WORK_FILTER_STATES,
  WORK_FILTERS,
  type WorkFilter,
} from "../../domain/person-tasks.js";
import type { ProjectFilter } from "../../domain/project-filter.js";
import type { TaskMatch } from "../../domain/search.js";
import type { StateChange } from "../../domain/state-change.js";
import type { Task, TaskMadeFor, TaskState, TaskSummary } from "../../domain/task.js";
import type { TaskChange } from "../../domain/task-changes.js";
import type { DependencyChanges } from "../../domain/task-dependencies.js";
import type { TaskCreated, TaskReordered } from "../../domain/task-events.js";
import { STARTED_STATES } from "../../domain/task-states.js";
import {
  TaskRepository,
  type NeighbourIds,
  type PersonsTasksRead,
  type PersonsTasksQuery,
  type TaskUpdate,
} from "../../ports/task-repository.js";
import { boardOrderOf } from "./board-order.js";
import { idStartingWith } from "./id-prefix.js";
import { matching, taskSearchVector } from "./search-vector.js";
import { queue } from "./queue.schema.js";
import { tasks, taskStateChanges } from "./work.schema.js";
import {
  changeDependenciesHeld,
  changeEveryDependencyHeld,
  heldTask,
  canBeRowId,
  holdManualOrder,
  holdStarts,
  insertTask,
  saveTask,
  stateChangesOf,
  takenOrders,
  TASK_SUMMARY_COLUMNS,
  toTask,
  toTaskSummary,
} from "./work-rows.js";

@Injectable()
export class PostgresTaskRepository extends TaskRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async create(
    create: (takenOrders: readonly string[]) => TaskChange<TaskCreated>,
  ): Promise<TaskChange<TaskCreated>> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        await holdManualOrder(transaction);
        const created = create(await takenOrders(transaction));
        await insertTask(transaction, created);
        return created;
      }),
    );
  }

  async discardNeverStarted(id: string): Promise<boolean> {
    if (!canBeRowId(id)) return false;
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        const [held] = await transaction
          .select({ state: tasks.state })
          .from(tasks)
          .where(eq(tasks.id, id))
          .for("update");
        if (held?.state !== "ready") return false;
        const [queued] = await transaction
          .select({ taskId: queue.taskId })
          .from(queue)
          .where(eq(queue.taskId, id));
        if (queued) return false;
        await transaction.delete(taskStateChanges).where(eq(taskStateChanges.taskId, id));
        await transaction.delete(tasks).where(eq(tasks.id, id));
        return true;
      }),
    );
  }

  find(id: string): Promise<Task | undefined> {
    return readOnce(readKey("tasks.find", id), async () => {
      if (!canBeRowId(id)) return undefined;
      const [row] = await this.database.select().from(tasks).where(eq(tasks.id, id));
      return row && toTask(row);
    });
  }

  list(): Promise<readonly Task[]> {
    return readOnce(readKey("tasks.list"), async () =>
      (await this.database.select().from(tasks)).map(toTask),
    );
  }

  async onTheBoardIn(projectId: string): Promise<readonly TaskSummary[]> {
    const rows = await this.database
      .select(TASK_SUMMARY_COLUMNS)
      .from(tasks)
      .where(and(isNull(tasks.archivedAt), eq(tasks.projectId, projectId)))
      .orderBy(...boardOrderOf(tasks));
    return rows.map(toTaskSummary);
  }

  finishedOnTheBoard(): Promise<readonly TaskSummary[]> {
    return this.summariesWhere(
      and(isNull(tasks.archivedAt), inArray(tasks.state, ["done", "dropped"])),
    );
  }

  summariesIn(states: readonly TaskState[]): Promise<readonly TaskSummary[]> {
    return readOnce(readKey("tasks.summariesIn", [...states].toSorted()), async () => {
      const rows = await this.database
        .select(TASK_SUMMARY_COLUMNS)
        .from(tasks)
        .where(inArray(tasks.state, [...states]))
        .orderBy(...boardOrderOf(tasks));
      return rows.map(toTaskSummary);
    });
  }

  inProject(projectId: string): Promise<readonly TaskSummary[]> {
    return this.summariesWhere(eq(tasks.projectId, projectId));
  }

  inInitiatives(initiativeIds?: readonly string[]): Promise<readonly Task[]> {
    if (initiativeIds === undefined) {
      return readOnce(readKey("tasks.inInitiatives"), () =>
        this.tasksWhere(isNotNull(tasks.initiativeId)),
      );
    }
    const rowIds = [...new Set(initiativeIds.filter(canBeRowId))].toSorted();
    if (rowIds.length === 0) return Promise.resolve([]);
    return readOnce(readKey("tasks.inInitiatives", rowIds), () =>
      this.tasksWhere(inArray(tasks.initiativeId, rowIds)),
    );
  }

  async onPipelines(pipelineIds: readonly string[]): Promise<readonly TaskSummary[]> {
    if (pipelineIds.length === 0) return [];
    return this.summariesWhere(inArray(tasks.pipelineId, [...new Set(pipelineIds)]));
  }

  async linkedTo(taskId: string): Promise<readonly Task[]> {
    if (!canBeRowId(taskId)) return [];
    return this.tasksWhere(
      or(
        arrayContains(tasks.blockedBy, [taskId]),
        eq(tasks.resolvesTaskId, taskId),
        eq(tasks.causedByTaskId, taskId),
        eq(tasks.duplicateOfTaskId, taskId),
      ),
    );
  }

  async tagsInUse(): Promise<readonly string[]> {
    const rows = await this.database
      .selectDistinct({ tag: sql<string>`unnest(${tasks.tags})` })
      .from(tasks);
    return rows.map(({ tag }) => tag);
  }

  async onTheBoard(match?: TaskMatch): Promise<readonly TaskSummary[]> {
    const rows = await this.database
      .select(TASK_SUMMARY_COLUMNS)
      .from(tasks)
      .where(and(isNull(tasks.archivedAt), match && matchingTask(match)))
      .orderBy(...boardOrderOf(tasks));
    return rows.map(toTaskSummary);
  }

  async archived(): Promise<readonly TaskSummary[]> {
    const rows = await this.database
      .select(TASK_SUMMARY_COLUMNS)
      .from(tasks)
      .where(isNotNull(tasks.archivedAt))
      .orderBy(desc(tasks.archivedAt), asc(tasks.id));
    return rows.map(toTaskSummary);
  }

  madeFor(madeFor: TaskMadeFor, projectId?: string): Promise<readonly Task[]> {
    return readOnce(readKey("tasks.madeFor", madeFor, projectId), () =>
      this.tasksWhere(
        and(
          eq(tasks.madeFor, madeFor),
          projectId === undefined ? undefined : eq(tasks.projectId, projectId),
        ),
      ),
    );
  }

  inStates(states: readonly TaskState[]): Promise<readonly Task[]> {
    return readOnce(readKey("tasks.inStates", [...states].toSorted()), () =>
      this.tasksWhere(inArray(tasks.state, [...states])),
    );
  }

  pausedByUsageWindowOn(engineId: string): Promise<readonly Task[]> {
    return this.tasksWhere(
      and(
        eq(tasks.state, "paused"),
        eq(tasks.pausedBy, "usage-window"),
        eq(tasks.usageWindowEngineId, engineId),
      ),
    );
  }

  pausedByUsageWindow(): Promise<readonly TaskSummary[]> {
    return this.summariesWhere(and(eq(tasks.state, "paused"), eq(tasks.pausedBy, "usage-window")));
  }

  async droppedIds(): Promise<readonly string[]> {
    const rows = await this.database
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.state, "dropped"));
    return rows.map(({ id }) => id);
  }

  findAll(ids: readonly string[]): Promise<readonly Task[]> {
    const rowIds = [...new Set(ids.filter(canBeRowId))].toSorted();
    return readOnce(readKey("tasks.findAll", rowIds), () =>
      this.tasksWhere(inArray(tasks.id, rowIds)),
    );
  }

  private async tasksWhere(condition: SQL | undefined): Promise<readonly Task[]> {
    return (await this.database.select().from(tasks).where(condition)).map(toTask);
  }

  private async summariesWhere(condition: SQL | undefined): Promise<readonly TaskSummary[]> {
    const rows = await this.database.select(TASK_SUMMARY_COLUMNS).from(tasks).where(condition);
    return rows.map(toTaskSummary);
  }

  async personsTasks(query: PersonsTasksQuery): Promise<PersonsTasksRead> {
    const theirs = personsTasks(query);
    const shown = inProjects(query.projects);
    const inFilter = (filter: WorkFilter): SQL | undefined =>
      inWorkFilter(filter, query.withOpenDecisions);
    const counts = Object.fromEntries(
      WORK_FILTERS.map((filter) => [filter, countWhere(and(shown, inFilter(filter)))]),
    ) as Record<WorkFilter, SQL<number>>;
    const [rows, [counted]] = await Promise.all([
      this.database
        .select()
        .from(tasks)
        .where(
          and(
            theirs,
            shown,
            inFilter(query.filter),
            afterCursor(query.after, tasks.createdAt, tasks.id),
          ),
        )
        .orderBy(...newestFirst(tasks.createdAt, tasks.id))
        .limit(query.limit),
      this.database
        .select({
          ...counts,
          elsewhere: shown ? countWhere(not(shown)) : sql<number>`0`.mapWith(Number),
        })
        .from(tasks)
        .where(theirs),
    ]);
    const { elsewhere, ...filterCounts } = counted ?? { ...ZERO_COUNTS, elsewhere: 0 };
    return { tasks: rows.map(toTask), counts: filterCounts, elsewhere };
  }

  async stateChangesOf(taskId: string): Promise<readonly StateChange[]> {
    return stateChangesOf(this.database, taskId);
  }

  async doneSince(since: Date): Promise<readonly string[]> {
    const rows = await this.database
      .selectDistinct({ taskId: taskStateChanges.taskId })
      .from(taskStateChanges)
      .where(and(eq(taskStateChanges.toState, "done"), gte(taskStateChanges.changedAt, since)));
    return rows.map(({ taskId }) => taskId);
  }

  async update<Event extends DomainEvent>(
    id: string,
    change: (task: Task) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        const task = await heldTask(transaction, id);
        return saveTask(transaction, task, change(task));
      }),
    );
  }

  async updateWithStateChanges<Event extends DomainEvent>(
    id: string,
    change: (
      task: Task,
      stateChanges: readonly StateChange[],
    ) => Promise<TaskChange<Event> | undefined>,
  ): Promise<TaskUpdate<Event>> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        const task = await heldTask(transaction, id);
        const changed = await change(task, await stateChangesOf(transaction, id));
        return saveTask(transaction, task, changed);
      }),
    );
  }

  async updateEveryStarted<Event extends DomainEvent>(
    change: (task: Task) => TaskChange<Event> | undefined,
  ): Promise<readonly TaskChange<Event>[]> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        await holdStarts(transaction);
        const started = await transaction
          .select()
          .from(tasks)
          .where(inArray(tasks.state, [...STARTED_STATES]))
          .for("update");
        const changes: TaskChange<Event>[] = [];
        for (const task of started.map(toTask)) {
          const changed = change(task);
          await saveTask(transaction, task, changed);
          if (changed) changes.push(changed);
        }
        return changes;
      }),
    );
  }

  async changeDependencies<Event extends DomainEvent>(
    id: string,
    change: (task: Task, tasks: readonly Task[]) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>> {
    return forgettingReads(() =>
      this.database.transaction((transaction) => changeDependenciesHeld(transaction, id, change)),
    );
  }

  async changeEveryDependency(
    id: string,
    change: (task: Task, tasks: readonly Task[]) => DependencyChanges,
  ): Promise<DependencyChanges> {
    return forgettingReads(() =>
      this.database.transaction((transaction) =>
        changeEveryDependencyHeld(transaction, id, change),
      ),
    );
  }

  async reorder(
    id: string,
    { above, below }: NeighbourIds,
    change: (
      task: Task,
      neighbours: Neighbours,
      takenOrders: readonly string[],
    ) => TaskChange<TaskReordered> | undefined,
  ): Promise<TaskUpdate<TaskReordered>> {
    return forgettingReads(() =>
      this.database.transaction(async (transaction) => {
        await holdManualOrder(transaction);
        const task = await heldTask(transaction, id);
        const neighbours = {
          above: above === undefined ? undefined : await heldTask(transaction, above),
          below: below === undefined ? undefined : await heldTask(transaction, below),
        };
        return saveTask(
          transaction,
          task,
          change(task, neighbours, await takenOrders(transaction, id)),
        );
      }),
    );
  }
}

const ZERO_COUNTS = Object.fromEntries(WORK_FILTERS.map((filter) => [filter, 0])) as Record<
  WorkFilter,
  number
>;

/** A Task matching all the words, or whose ID starts as the query does. */
function matchingTask({ words, idPrefix }: TaskMatch): SQL | undefined {
  return or(
    matching(taskSearchVector(tasks), words),
    idPrefix === undefined ? undefined : idStartingWith(tasks.id, idPrefix),
  );
}

/** The person's Tasks off the Archive: created by them, with a Thread with them, or a Stage. */
function personsTasks({ roleKey, withThreads, pipelineIds }: PersonsTasksQuery): SQL | undefined {
  return and(
    isNull(tasks.archivedAt),
    or(
      sql`${tasks.createdBy}->>'kind' = 'person' and ${tasks.createdBy}->>'roleKey' = ${roleKey}`,
      inArray(tasks.id, withThreads.filter(canBeRowId)),
      inArray(tasks.pipelineId, [...pipelineIds]),
    ),
  );
}

/** The Project filter's rule in the query; undefined while it shows every Project. */
function inProjects(projects: ProjectFilter): SQL | undefined {
  return projects === "all" ? undefined : inArray(tasks.projectId, [...projects]);
}

/** The Work filter's rule in the query (`WORK_FILTER_STATES`); undefined for All. */
function inWorkFilter(filter: WorkFilter, withOpenDecisions: readonly string[]): SQL | undefined {
  const states = WORK_FILTER_STATES[filter];
  if (states === undefined) return undefined;
  const inStates = inArray(tasks.state, [...states]);
  if (filter !== "waiting-on-you") return inStates;
  return or(
    inStates,
    and(
      inArray(tasks.state, [...WAITS_ON_YOU_IN_ITS_STATE]),
      inArray(tasks.id, withOpenDecisions.filter(canBeRowId)),
    ),
  );
}

function countWhere(condition: SQL | undefined): SQL<number> {
  return sql<number>`count(*) filter (where ${condition ?? sql`true`})`.mapWith(Number);
}
