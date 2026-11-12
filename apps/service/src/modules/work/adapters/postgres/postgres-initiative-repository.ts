import { Inject, Injectable } from "@nestjs/common";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  ne,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import type { Initiative } from "../../domain/initiative.js";
import {
  ARCHIVE_PAGE_SIZE,
  type ArchivePage,
  type ArchiveSearch,
} from "../../domain/initiative-archive.js";
import type {
  InitiativeChange,
  InitiativeSettling,
  InitiativeTaskAdded,
  InitiativeTasksChange,
} from "../../domain/initiative-changes.js";
import type { InitiativeCreated } from "../../domain/initiative-events.js";
import { InitiativeNotFound } from "../../domain/initiative-not-found.js";
import type { Task } from "../../domain/task.js";
import type { TaskChange } from "../../domain/task-changes.js";
import type { TaskStateChanged } from "../../domain/task-events.js";
import {
  InitiativeRepository,
  type InitiativeTasksUpdate,
  type InitiativeUpdate,
} from "../../ports/initiative-repository.js";
import type { TaskUpdate } from "../../ports/task-repository.js";
import { initiativeVector } from "./postgres-work-search.js";
import { matching } from "./search-vector.js";
import { initiatives, tasks } from "./work.schema.js";
import {
  changeDependenciesHeld,
  everyTaskHoldingDependencies,
  canBeRowId,
  heldTask,
  holdManualOrder,
  holdShortNames,
  insertTask,
  saveTask,
  takenOrders,
  toInitiative,
  toInitiativeRow,
  toTask,
  type Transaction,
} from "./work-rows.js";

@Injectable()
export class PostgresInitiativeRepository extends InitiativeRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async find(id: string): Promise<Initiative | undefined> {
    if (!canBeRowId(id)) return undefined;
    const [row] = await this.database.select().from(initiatives).where(eq(initiatives.id, id));
    return row && toInitiative(row);
  }

  async insert({ initiative }: InitiativeChange<InitiativeCreated>): Promise<void> {
    await this.database.insert(initiatives).values(toInitiativeRow(initiative));
  }

  async list(): Promise<readonly Initiative[]> {
    const rows = await this.database
      .select()
      .from(initiatives)
      .orderBy(desc(initiatives.createdAt), asc(initiatives.id));
    return rows.map(toInitiative);
  }

  async archived({ words, state, page, projects }: ArchiveSearch): Promise<ArchivePage> {
    const matches = and(
      isNotNull(initiatives.archivedAt),
      words.length > 0 ? matching(initiativeVector, words) : undefined,
      projects === "all" ? undefined : inProjects(projects),
    );
    const [countRows, pageRows] = await Promise.all([
      this.database
        .select({ state: initiatives.state, count: count() })
        .from(initiatives)
        .where(matches)
        .groupBy(initiatives.state),
      this.database
        .select()
        .from(initiatives)
        .where(and(matches, state === "all" ? undefined : eq(initiatives.state, state)))
        // The one that ended last on top; one nothing dates sinks below every dated one.
        .orderBy(
          sql`${initiatives.endedAt} DESC NULLS LAST`,
          desc(initiatives.createdAt),
          asc(initiatives.id),
        )
        .limit(ARCHIVE_PAGE_SIZE)
        .offset((page - 1) * ARCHIVE_PAGE_SIZE),
    ]);
    const tasksOfPage = await this.tasksOfEach(pageRows.map(({ id }) => id));
    const countOf = (wanted: Initiative["state"]) =>
      countRows.find((row) => row.state === wanted)?.count ?? 0;
    return {
      initiatives: pageRows.map((row) => ({
        initiative: toInitiative(row),
        tasks: tasksOfPage.get(row.id) ?? [],
      })),
      counts: { done: countOf("done"), dropped: countOf("dropped") },
    };
  }

  private async tasksOfEach(ids: readonly string[]): Promise<ReadonlyMap<string, readonly Task[]>> {
    if (ids.length === 0) return new Map();
    const rows = await this.database
      .select()
      .from(tasks)
      .where(inArray(tasks.initiativeId, [...ids]))
      .orderBy(asc(tasks.createdAt), asc(tasks.id));
    const byInitiative = new Map<string, Task[]>();
    for (const task of rows.map(toTask)) {
      if (!task.initiativeId) continue;
      byInitiative.set(task.initiativeId, [...(byInitiative.get(task.initiativeId) ?? []), task]);
    }
    return byInitiative;
  }

  async update<Event extends DomainEvent>(
    id: string,
    change: (initiative: Initiative, tasks: readonly Task[]) => InitiativeChange<Event> | undefined,
  ): Promise<InitiativeUpdate<Event>> {
    return this.database.transaction(async (transaction) => {
      const initiative = await heldInitiative(transaction, id);
      const changed = change(initiative, await tasksOf(transaction, id));
      if (!changed) return { initiative, event: undefined };
      await saveInitiative(transaction, changed.initiative);
      return changed;
    });
  }

  async updateWithTasks<Event extends DomainEvent>(
    id: string,
    change: (
      initiative: Initiative,
      tasks: readonly Task[],
    ) => InitiativeTasksChange<Event> | undefined,
  ): Promise<InitiativeTasksUpdate<Event>> {
    return this.database.transaction(async (transaction) => {
      // The Initiative first and its Tasks after, the one order any hold of both takes.
      const initiative = await heldInitiative(transaction, id);
      const changed = change(initiative, await heldTasksOf(transaction, id));
      if (!changed) return { initiative, event: undefined, taskChanges: [] };
      await saveInitiative(transaction, changed.initiative);
      for (const taskChange of changed.taskChanges) {
        await saveTask(transaction, taskChange.task, taskChange);
      }
      return changed;
    });
  }

  async changeTasks(
    id: string,
    change: (
      initiative: Initiative,
      tasks: readonly Task[],
    ) => readonly TaskChange<TaskStateChanged>[],
  ): Promise<readonly TaskChange<TaskStateChanged>[]> {
    return this.database.transaction(async (transaction) => {
      const initiative = await heldInitiative(transaction, id);
      const taskChanges = change(initiative, await heldTasksOf(transaction, id));
      for (const taskChange of taskChanges) {
        await saveTask(transaction, taskChange.task, taskChange);
      }
      return taskChanges;
    });
  }

  async updateNaming<Event extends DomainEvent>(
    id: string,
    change: (
      initiative: Initiative,
      takenShortNames: ReadonlySet<string>,
    ) => InitiativeChange<Event> | undefined,
  ): Promise<InitiativeUpdate<Event>> {
    return this.database.transaction(async (transaction) => {
      // The Short names first and the Initiative after, the one order any hold of both takes.
      await holdShortNames(transaction);
      const initiative = await heldInitiative(transaction, id);
      const others = await transaction
        .select({ shortName: initiatives.shortName })
        .from(initiatives)
        .where(and(isNotNull(initiatives.shortName), ne(initiatives.id, id)));
      const taken = new Set(others.flatMap(({ shortName }) => shortName ?? []));
      const changed = change(initiative, taken);
      if (!changed) return { initiative, event: undefined };
      await saveInitiative(transaction, changed.initiative);
      return changed;
    });
  }

  async addTask(
    id: string,
    create: (
      initiative: Initiative,
      takenOrders: readonly string[],
      tasks: readonly Task[],
    ) => InitiativeTaskAdded,
  ): Promise<InitiativeTaskAdded> {
    return this.database.transaction(async (transaction) => {
      // The manual order, the Initiative, the dependencies, then its Tasks: the order every other
      // hold takes. Its Tasks are held as the Publishing Task the new one blocks is saved whole.
      await holdManualOrder(transaction);
      const initiative = await heldInitiative(transaction, id);
      const everyTask = await everyTaskHoldingDependencies(transaction);
      const held = await heldTasksOf(transaction, id);
      const added = create(initiative, await takenOrders(transaction), withHeld(everyTask, held));
      await insertTask(transaction, added.created);
      if (added.blocking) await saveTask(transaction, added.blocking.task, added.blocking);
      return added;
    });
  }

  async settle(
    id: string,
    settle: (
      initiative: Initiative,
      tasks: readonly Task[],
      takenOrders: readonly string[],
    ) => InitiativeSettling,
  ): Promise<InitiativeSettling> {
    return this.database.transaction(async (transaction) => {
      // The manual order, the Initiative, then the dependencies: the order every other hold takes.
      await holdManualOrder(transaction);
      const initiative = await heldInitiative(transaction, id);
      const everyTask = await everyTaskHoldingDependencies(transaction);
      const settled = settle(
        initiative,
        everyTask.filter(({ initiativeId }) => initiativeId === id),
        await takenOrders(transaction),
      );
      for (const created of settled.created) await insertTask(transaction, created);
      if (settled.event) await saveInitiative(transaction, settled.initiative);
      return settled;
    });
  }

  async changeDependencies<Event extends DomainEvent>(
    id: string,
    taskId: string,
    change: (
      initiative: Initiative,
      task: Task,
      tasks: readonly Task[],
    ) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>> {
    return this.database.transaction(async (transaction) => {
      // The Initiative first and the dependencies after, the one order every hold of both takes.
      const initiative = await heldInitiative(transaction, id);
      return changeDependenciesHeld(transaction, taskId, (task, everyTask) =>
        change(initiative, task, everyTask),
      );
    });
  }

  async changeTask<Event extends DomainEvent>(
    id: string,
    taskId: string,
    change: (
      initiative: Initiative,
      task: Task,
      tasks: readonly Task[],
    ) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>> {
    return this.database.transaction(async (transaction) => {
      const initiative = await heldInitiative(transaction, id);
      const task = await heldTask(transaction, taskId);
      return saveTask(transaction, task, change(initiative, task, await tasksOf(transaction, id)));
    });
  }
}

/**
 * The Project filter's rule (`isInProjectFilter`) in the query: an Initiative with no Task, so no
 * Project yet, always shows; one spanning Projects shows if any of them is chosen.
 */
function inProjects(projectIds: readonly string[]): SQL {
  const ofIt = eq(tasks.initiativeId, initiatives.id);
  // In parentheses: exists() adds none around a subquery written as SQL.
  const anyTask = sql`(SELECT 1 FROM ${tasks} WHERE ${ofIt})`;
  const inChosen = sql`(SELECT 1 FROM ${tasks} WHERE ${ofIt} AND ${inArray(tasks.projectId, [...projectIds])})`;
  return or(notExists(anyTask), exists(inChosen)) ?? sql`true`;
}

async function heldInitiative(transaction: Transaction, id: string): Promise<Initiative> {
  if (!canBeRowId(id)) throw new InitiativeNotFound(id);
  const [row] = await transaction
    .select()
    .from(initiatives)
    .where(eq(initiatives.id, id))
    .for("update");
  if (!row) throw new InitiativeNotFound(id);
  return toInitiative(row);
}

async function saveInitiative(transaction: Transaction, initiative: Initiative): Promise<void> {
  await transaction
    .update(initiatives)
    .set(toInitiativeRow(initiative))
    .where(eq(initiatives.id, initiative.id));
}

async function heldTasksOf(transaction: Transaction, initiativeId: string): Promise<Task[]> {
  const rows = await transaction
    .select()
    .from(tasks)
    .where(eq(tasks.initiativeId, initiativeId))
    .orderBy(asc(tasks.id))
    .for("update");
  return rows.map(toTask);
}

/** Every Task, the Initiative's as held in place of their earlier read. */
function withHeld(everyTask: readonly Task[], held: readonly Task[]): Task[] {
  const heldById = new Map(held.map((task) => [task.id, task]));
  return everyTask.map((task) => heldById.get(task.id) ?? task);
}

async function tasksOf(transaction: Transaction, initiativeId: string): Promise<Task[]> {
  const rows = await transaction.select().from(tasks).where(eq(tasks.initiativeId, initiativeId));
  return rows.map(toTask);
}
