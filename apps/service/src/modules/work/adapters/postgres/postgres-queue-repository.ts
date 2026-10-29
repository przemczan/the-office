import { Inject, Injectable } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { QueuedTask, Release, Starting } from "../../domain/queue.js";
import type { Task } from "../../domain/task.js";
import type { HeldAtStart } from "../../domain/task-start.js";
import { STARTED_STATES } from "../../domain/task-states.js";
import { QueueRepository } from "../../ports/queue-repository.js";
import { queue } from "./queue.schema.js";
import { tasks } from "./work.schema.js";
import { heldTask, holdStarts, toTask, toTaskRow, type Transaction } from "./work-rows.js";

type QueueRow = typeof queue.$inferSelect;

@Injectable()
export class PostgresQueueRepository extends QueueRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async list(): Promise<readonly QueuedTask[]> {
    return (await this.database.select().from(queue)).map(toQueuedTask);
  }

  async start(
    id: string,
    decide: (task: Task, held: HeldAtStart, queue: readonly QueuedTask[]) => Starting,
  ): Promise<Starting> {
    return this.database.transaction(async (transaction) => {
      await holdStarts(transaction);
      const task = await heldTask(transaction, id);
      const startedRows = await transaction
        .select()
        .from(tasks)
        .where(inArray(tasks.state, [...STARTED_STATES]));
      const blockerRows = task.blockedBy.length
        ? await transaction
            .select()
            .from(tasks)
            .where(inArray(tasks.id, [...task.blockedBy]))
        : [];
      const starting = decide(
        task,
        { startedTasks: startedRows.map(toTask), blockers: blockerRows.map(toTask) },
        await heldQueue(transaction),
      );
      if (starting.kind === "started") {
        await saveStarted(transaction, starting.change.task);
      } else {
        await saveQueued(transaction, starting.queued);
      }
      return starting;
    });
  }

  async release(
    decide: (queue: readonly QueuedTask[], tasks: readonly Task[]) => Release,
  ): Promise<Release> {
    return this.database.transaction(async (transaction) => {
      await holdStarts(transaction);
      const inQueue = await heldQueue(transaction);
      if (inQueue.length === 0) return { started: [], refused: [], waiting: [] };
      // The queued Tasks are held, so none changes state between the weighing and the save.
      await transaction
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          inArray(
            tasks.id,
            inQueue.map(({ taskId }) => taskId),
          ),
        )
        .for("update");
      const release = decide(inQueue, (await transaction.select().from(tasks)).map(toTask));
      for (const { task } of release.started) await saveStarted(transaction, task);
      for (const { taskId } of release.refused) await removeQueued(transaction, taskId);
      for (const waiting of release.waiting) await saveQueued(transaction, waiting);
      return release;
    });
  }

  async takeOut(taskId: string): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      await holdStarts(transaction);
      return removeQueued(transaction, taskId);
    });
  }

  async reorder(change: (queue: readonly QueuedTask[]) => readonly QueuedTask[]): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await holdStarts(transaction);
      for (const { taskId, place } of change(await heldQueue(transaction))) {
        await transaction.update(queue).set({ place }).where(eq(queue.taskId, taskId));
      }
    });
  }
}

async function heldQueue(transaction: Transaction): Promise<QueuedTask[]> {
  return (await transaction.select().from(queue)).map(toQueuedTask);
}

/** Saves the started Task, which leaves the queue if it was in it. */
async function saveStarted(transaction: Transaction, task: Task): Promise<void> {
  await transaction.update(tasks).set(toTaskRow(task)).where(eq(tasks.id, task.id));
  await removeQueued(transaction, task.id);
}

async function saveQueued(transaction: Transaction, queued: QueuedTask): Promise<void> {
  const row = { ...queued, reasons: [...queued.reasons] };
  await transaction
    .insert(queue)
    .values(row)
    .onConflictDoUpdate({ target: queue.taskId, set: { reasons: row.reasons } });
}

async function removeQueued(transaction: Transaction, taskId: string): Promise<boolean> {
  const removed = await transaction
    .delete(queue)
    .where(eq(queue.taskId, taskId))
    .returning({ taskId: queue.taskId });
  return removed.length > 0;
}

function toQueuedTask({ taskId, place, queuedAt, reasons }: QueueRow): QueuedTask {
  return { taskId, place, queuedAt, reasons };
}
