import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import type { Neighbours } from "../../domain/manual-order.js";
import type { Task } from "../../domain/task.js";
import type { TaskChange } from "../../domain/task-changes.js";
import type { TaskCreated, TaskReordered } from "../../domain/task-events.js";
import { TaskRepository, type NeighbourIds, type TaskUpdate } from "../../ports/task-repository.js";
import { tasks } from "./work.schema.js";
import {
  changeDependenciesHeld,
  heldTask,
  holdManualOrder,
  saveTask,
  takenOrders,
  toTask,
  toTaskRow,
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
      await transaction.insert(tasks).values(toTaskRow(created.task));
      return created;
    });
  }

  async find(id: string): Promise<Task | undefined> {
    const [row] = await this.database.select().from(tasks).where(eq(tasks.id, id));
    return row && toTask(row);
  }

  async list(): Promise<readonly Task[]> {
    return (await this.database.select().from(tasks)).map(toTask);
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

  async changeDependencies<Event extends DomainEvent>(
    id: string,
    change: (task: Task, tasks: readonly Task[]) => TaskChange<Event> | undefined,
  ): Promise<TaskUpdate<Event>> {
    return this.database.transaction((transaction) =>
      changeDependenciesHeld(transaction, id, change),
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
