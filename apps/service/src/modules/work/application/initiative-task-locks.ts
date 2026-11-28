import type { TaskLocks } from "./task-locks.js";
import type { TaskRepository } from "../ports/task-repository.js";

/**
 * Runs `work` holding the lock of every Task of the Initiative (`TaskLocks`), as a move of the
 * Initiative that moves its Tasks does, so none of them lands between a way back's branch reset
 * and its move (`TaskWaysBack`).
 */
export async function holdingTheInitiativesTasks<Result>(
  locks: TaskLocks,
  tasks: TaskRepository,
  initiativeId: string,
  work: () => Promise<Result>,
): Promise<Result> {
  const taskIds = (await tasks.inInitiatives([initiativeId])).map(({ id }) => id);
  return locks.runAll(taskIds, work);
}
