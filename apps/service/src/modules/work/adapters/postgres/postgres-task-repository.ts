import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, not, or, sql, type SQL } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
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
import type { StateChange } from "../../domain/state-change.js";
import type { Task } from "../../domain/task.js";
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
import { tasks } from "./work.schema.js";
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
  toTask,
} from "./work-rows.js";

@Injectable()
export class PostgresTaskRepository extends TaskRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async create(
    create: (takenOrders: readonly string[]) => TaskChange<TaskCreated>,
  ): Promise<TaskChange<TaskCreated>> {
    return this.database.transaction(async (transaction) => {
      await holdManualOrder(transaction);
      const created = create(await takenOrders(transaction));
      await insertTask(transaction, created);
      return created;
    });
  }

  async find(id: string): Promise<Task | undefined> {
    if (!canBeRowId(id)) return undefined;
    const [row] = await this.database.select().from(tasks).where(eq(tasks.id, id));
    return row && toTask(row);
  }

  async list(): Promise<readonly Task[]> {
    return (await this.database.select().from(tasks)).map(toTask);
  }

  async droppedIds(): Promise<readonly string[]> {
    const rows = await this.database
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.state, "dropped"));
    return rows.map(({ id }) => id);
  }

  async findAll(ids: readonly string[]): Promise<readonly Task[]> {
    const rows = await this.database
      .select()
      .from(tasks)
      .where(inArray(tasks.id, ids.filter(canBeRowId)));
    return rows.map(toTask);
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

  async update<Event extends DomainEvent>(
    id: string,
    change: (task: Task) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>> {
    return this.database.transaction(async (transaction) => {
      const task = await heldTask(transaction, id);
      return saveTask(transaction, task, change(task));
    });
  }

  async updateWithStateChanges<Event extends DomainEvent>(
    id: string,
    change: (
      task: Task,
      stateChanges: readonly StateChange[],
    ) => Promise<TaskChange<Event> | undefined>,
  ): Promise<TaskUpdate<Event>> {
    return this.database.transaction(async (transaction) => {
      const task = await heldTask(transaction, id);
      const changed = await change(task, await stateChangesOf(transaction, id));
      return saveTask(transaction, task, changed);
    });
  }

  async updateEveryStarted<Event extends DomainEvent>(
    change: (task: Task) => TaskChange<Event> | undefined,
  ): Promise<readonly TaskChange<Event>[]> {
    return this.database.transaction(async (transaction) => {
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
    });
  }

  async changeDependencies<Event extends DomainEvent>(
    id: string,
    change: (task: Task, tasks: readonly Task[]) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>> {
    return this.database.transaction((transaction) =>
      changeDependenciesHeld(transaction, id, change),
    );
  }

  async changeEveryDependency(
    id: string,
    change: (task: Task, tasks: readonly Task[]) => DependencyChanges,
  ): Promise<DependencyChanges> {
    return this.database.transaction((transaction) =>
      changeEveryDependencyHeld(transaction, id, change),
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
    return this.database.transaction(async (transaction) => {
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
    });
  }
}

const ZERO_COUNTS = Object.fromEntries(WORK_FILTERS.map((filter) => [filter, 0])) as Record<
  WorkFilter,
  number
>;

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
