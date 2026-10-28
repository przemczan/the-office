import { Inject, Injectable } from "@nestjs/common";
import { asc, desc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import type { Initiative } from "../../domain/initiative.js";
import type { InitiativeChange } from "../../domain/initiative-changes.js";
import { InitiativeNotFound } from "../../domain/initiative-not-found.js";
import type { Task } from "../../domain/task.js";
import type { TaskChange } from "../../domain/task-changes.js";
import type { TaskCreated } from "../../domain/task-events.js";
import { InitiativeRepository, type InitiativeUpdate } from "../../ports/initiative-repository.js";
import type { TaskUpdate } from "../../ports/task-repository.js";
import { initiatives, tasks } from "./work.schema.js";
import {
  changeDependenciesHeld,
  everyTaskHoldingDependencies,
  holdManualOrder,
  takenOrders,
  toInitiative,
  toInitiativeRow,
  toTask,
  toTaskRow,
  type Transaction,
} from "./work-rows.js";

@Injectable()
export class PostgresInitiativeRepository extends InitiativeRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async find(id: string): Promise<Initiative | undefined> {
    const [row] = await this.database.select().from(initiatives).where(eq(initiatives.id, id));
    return row && toInitiative(row);
  }

  async list(): Promise<readonly Initiative[]> {
    const rows = await this.database
      .select()
      .from(initiatives)
      .orderBy(desc(initiatives.createdAt), asc(initiatives.id));
    return rows.map(toInitiative);
  }

  async update<Event extends DomainEvent>(
    id: string,
    change: (initiative: Initiative, tasks: readonly Task[]) => InitiativeChange<Event> | undefined,
  ): Promise<InitiativeUpdate<Event>> {
    return this.database.transaction(async (transaction) => {
      const initiative = await heldInitiative(transaction, id);
      const changed = change(initiative, await tasksOf(transaction, id));
      if (!changed) return { initiative, event: undefined };
      await transaction
        .update(initiatives)
        .set(toInitiativeRow(changed.initiative))
        .where(eq(initiatives.id, id));
      return changed;
    });
  }

  async addTask(
    id: string,
    create: (
      initiative: Initiative,
      takenOrders: readonly string[],
      tasks: readonly Task[],
    ) => TaskChange<TaskCreated>,
  ): Promise<TaskChange<TaskCreated>> {
    return this.database.transaction(async (transaction) => {
      // The manual order, the Initiative, then the dependencies: the order every other hold takes.
      await holdManualOrder(transaction);
      const initiative = await heldInitiative(transaction, id);
      const everyTask = await everyTaskHoldingDependencies(transaction);
      const created = create(initiative, await takenOrders(transaction), everyTask);
      await transaction.insert(tasks).values(toTaskRow(created.task));
      return created;
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
}

async function heldInitiative(transaction: Transaction, id: string): Promise<Initiative> {
  const [row] = await transaction
    .select()
    .from(initiatives)
    .where(eq(initiatives.id, id))
    .for("update");
  if (!row) throw new InitiativeNotFound(id);
  return toInitiative(row);
}

async function tasksOf(transaction: Transaction, initiativeId: string): Promise<Task[]> {
  const rows = await transaction.select().from(tasks).where(eq(tasks.initiativeId, initiativeId));
  return rows.map(toTask);
}
