import { Inject, Injectable } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import type { Neighbours } from "../../domain/manual-order.js";
import type { StateChange } from "../../domain/state-change.js";
import type { Task } from "../../domain/task.js";
import type { TaskChange } from "../../domain/task-changes.js";
import type { TaskCreated, TaskReordered } from "../../domain/task-events.js";
import { STARTED_STATES } from "../../domain/task-states.js";
import { TaskRepository, type NeighbourIds, type TaskUpdate } from "../../ports/task-repository.js";
import { tasks } from "./work.schema.js";
import {
  changeDependenciesHeld,
  heldTask,
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
    const [row] = await this.database.select().from(tasks).where(eq(tasks.id, id));
    return row && toTask(row);
  }

  async list(): Promise<readonly Task[]> {
    return (await this.database.select().from(tasks)).map(toTask);
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
