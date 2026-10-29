import type { HeldAtStart } from "../domain/task-start.js";
import type { QueuedTask, Release, Starting } from "../domain/queue.js";
import type { Task } from "../domain/task.js";

/**
 * Where Start and the queue are kept. Start, every release and every change of the queue hold
 * Starts until saved, so two never count the same free desk or take the same place.
 */
export abstract class QueueRepository {
  /** The queue, in no particular order. */
  abstract list(): Promise<readonly QueuedTask[]>;

  /**
   * Start: `decide` weighs the Task with every started Task, the Tasks it waits for and the queue
   * read in the hold, then the started Task or its place in the queue is saved. Throws
   * TaskNotFound when there is no such Task.
   */
  abstract start(
    id: string,
    decide: (task: Task, held: HeldAtStart, queue: readonly QueuedTask[]) => Starting,
  ): Promise<Starting>;

  /**
   * A release: `decide` weighs the queue against every Task read in the hold; the Tasks it starts
   * are saved and leave the queue with those refused, and those still waiting keep their new
   * reasons.
   */
  abstract release(
    decide: (queue: readonly QueuedTask[], tasks: readonly Task[]) => Release,
  ): Promise<Release>;

  /** Takes the Task out of the queue; whether it was in it. */
  abstract takeOut(taskId: string): Promise<boolean>;

  /** Saves the places `change` gives the queued Tasks it returns, from the queue as held. */
  abstract reorder(change: (queue: readonly QueuedTask[]) => readonly QueuedTask[]): Promise<void>;
}
