import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, inArray, isNotNull } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { forgettingReads } from "../../../../platform/database/read-scope.js";
import { retriedTransaction } from "../../../../platform/database/retried-transaction.js";
import type { QueuedTask, Release, Starting } from "../../domain/queue.js";
import type { Task } from "../../domain/task.js";
import type { TaskChange } from "../../domain/task-changes.js";
import type { TaskStarted } from "../../domain/task-events.js";
import type { HeldAtStart } from "../../domain/task-start.js";
import { STARTED_STATES } from "../../domain/task-states.js";
import { QueueRepository, type HeldForRelease } from "../../ports/queue-repository.js";
import { heldFireAlarm } from "./postgres-fire-alarm-repository.js";
import { queue } from "./queue.schema.js";
import { initiatives, tasks } from "./work.schema.js";
import {
  authorOf,
  heldTask,
  holdStarts,
  keepStateChange,
  toTask,
  taskRowUpdate,
  type Transaction,
} from "./work-rows.js";

type QueueRow = typeof queue.$inferSelect;

/**
 * The fire alarm is read in the hold of Starts, on its transaction: sounding it holds Starts once it
 * is on, so a Start either sees it or started before the alarm paused every started Task. Each
 * transaction runs again after a deadlock (`retriedTransaction`), its rows held in id order.
 */
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
    return forgettingReads(() =>
      retriedTransaction(this.database, async (transaction) => {
        await holdStarts(transaction);
        const task = await heldTask(transaction, id);
        const held = {
          startedTasks: await startedTasks(transaction),
          blockers: await tasksById(transaction, task.blockedBy),
          fireAlarmOn: await this.fireAlarmOn(transaction),
          initiativePaused: await isInitiativePaused(transaction, task.initiativeId),
        };
        const starting = decide(task, held, await heldQueue(transaction));
        if (starting.kind === "started") {
          await saveStarted(transaction, starting.change);
        } else {
          await saveQueued(transaction, starting.queued);
        }
        return starting;
      }),
    );
  }

  async release(
    decide: (queue: readonly QueuedTask[], held: HeldForRelease) => Release,
  ): Promise<Release> {
    return forgettingReads(() =>
      retriedTransaction(this.database, async (transaction) => {
        await holdStarts(transaction);
        const inQueue = await heldQueue(transaction);
        if (inQueue.length === 0) {
          return {
            started: [],
            startedEstimates: new Map(),
            refused: [],
            waiting: [],
            reasonsChanged: [],
            capResets: [],
          };
        }
        // The queued Tasks are held, so none changes state between the weighing and the save.
        const queued = await heldTasks(
          transaction,
          inQueue.map(({ taskId }) => taskId),
        );
        const running = await startedTasks(transaction);
        const read = new Set([...queued, ...running].map(({ id }) => id));
        const blockerIds = queued
          .flatMap(({ blockedBy }) => blockedBy)
          .filter((id) => !read.has(id));
        const release = decide(inQueue, {
          tasks: [...queued, ...running, ...(await tasksById(transaction, blockerIds))],
          fireAlarmOn: await this.fireAlarmOn(transaction),
          pausedInitiativeIds: await pausedInitiativeIds(transaction),
        });
        for (const started of release.started) await saveStarted(transaction, started);
        for (const { taskId } of release.refused) await removeQueued(transaction, taskId);
        for (const waiting of release.waiting) await saveQueued(transaction, waiting);
        return release;
      }),
    );
  }

  /** Whether the fire alarm is on, as the hold of Starts reads it on its own transaction. */
  protected async fireAlarmOn(transaction: Transaction): Promise<boolean> {
    return (await heldFireAlarm(transaction)).on;
  }

  async takeOut(taskId: string): Promise<boolean> {
    return forgettingReads(() =>
      retriedTransaction(this.database, async (transaction) => {
        await holdStarts(transaction);
        return removeQueued(transaction, taskId);
      }),
    );
  }

  async reorder(change: (queue: readonly QueuedTask[]) => readonly QueuedTask[]): Promise<void> {
    await forgettingReads(() =>
      retriedTransaction(this.database, async (transaction) => {
        await holdStarts(transaction);
        for (const { taskId, place } of change(await heldQueue(transaction))) {
          await transaction.update(queue).set({ place }).where(eq(queue.taskId, taskId));
        }
      }),
    );
  }
}

/**
 * Read in the hold of Starts, never holding the Initiative: Pause the Initiative holds it and then
 * its Tasks' rows, so it either pauses a Task this hold starts, or saved its mark before this reads.
 */
async function isInitiativePaused(
  transaction: Transaction,
  initiativeId: string | undefined,
): Promise<boolean> {
  if (initiativeId === undefined) return false;
  const [row] = await transaction
    .select({ pausedAt: initiatives.pausedAt })
    .from(initiatives)
    .where(eq(initiatives.id, initiativeId));
  return row?.pausedAt != null;
}

async function pausedInitiativeIds(transaction: Transaction): Promise<ReadonlySet<string>> {
  const rows = await transaction
    .select({ id: initiatives.id })
    .from(initiatives)
    .where(isNotNull(initiatives.pausedAt));
  return new Set(rows.map(({ id }) => id));
}

/** Every started Task, read in the hold of Starts, which only a Start or a release changes. */
async function startedTasks(transaction: Transaction): Promise<Task[]> {
  const rows = await transaction
    .select()
    .from(tasks)
    .where(inArray(tasks.state, [...STARTED_STATES]));
  return rows.map(toTask);
}

/** The Tasks of `ids` there are, in no particular order. */
async function tasksById(transaction: Transaction, ids: readonly string[]): Promise<Task[]> {
  if (ids.length === 0) return [];
  const rows = await transaction
    .select()
    .from(tasks)
    .where(inArray(tasks.id, [...new Set(ids)]));
  return rows.map(toTask);
}

/** The Tasks of `ids`, held until the transaction ends, in id order as every hold of Tasks is. */
async function heldTasks(transaction: Transaction, ids: readonly string[]): Promise<Task[]> {
  const rows = await transaction
    .select()
    .from(tasks)
    .where(inArray(tasks.id, [...ids]))
    .orderBy(asc(tasks.id))
    .for("update");
  return rows.map(toTask);
}

async function heldQueue(transaction: Transaction): Promise<QueuedTask[]> {
  return (await transaction.select().from(queue)).map(toQueuedTask);
}

/** Saves the started Task, which leaves the queue if it was in it. */
async function saveStarted(
  transaction: Transaction,
  started: TaskChange<TaskStarted>,
): Promise<void> {
  const { task } = started;
  await transaction.update(tasks).set(taskRowUpdate(task)).where(eq(tasks.id, task.id));
  await keepStateChange(transaction, started);
  await removeQueued(transaction, task.id);
}

async function saveQueued(transaction: Transaction, queued: QueuedTask): Promise<void> {
  const row = {
    ...queued,
    reasons: [...queued.reasons],
    shortReasons: [...queued.shortReasons],
    behind: [...queued.behind],
  };
  await transaction
    .insert(queue)
    .values(row)
    .onConflictDoUpdate({
      target: queue.taskId,
      set: { reasons: row.reasons, shortReasons: row.shortReasons, behind: row.behind },
    });
}

async function removeQueued(transaction: Transaction, taskId: string): Promise<boolean> {
  const removed = await transaction
    .delete(queue)
    .where(eq(queue.taskId, taskId))
    .returning({ taskId: queue.taskId });
  return removed.length > 0;
}

function toQueuedTask({
  taskId,
  place,
  queuedAt,
  queuedBy,
  reasons,
  shortReasons,
  behind,
}: QueueRow): QueuedTask {
  return { taskId, place, queuedAt, queuedBy: authorOf(queuedBy), reasons, shortReasons, behind };
}
