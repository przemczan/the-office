import type { Task } from "@the-office/contracts";

/** The Tasks this one must wait for, in the order they were added. */
export function blockersOf(task: Task, tasks: readonly Task[]): Task[] {
  return task.blockedBy.flatMap((id) => tasks.find((each) => each.id === id) ?? []);
}

/** The blockers still holding the Task back: a Done or Dropped one no longer blocks (spec §2.1). */
export function blockingTasksOf(task: Task, tasks: readonly Task[]): Task[] {
  return blockersOf(task, tasks).filter(canHoldBack);
}

/** Whether a Task waiting for this one would wait: neither Done nor Dropped. */
export function canHoldBack({ state }: Task): boolean {
  return state !== "done" && state !== "dropped";
}

/** The Tasks waiting for this one, leaving out the Dropped. */
export function waitingFor(task: Task, tasks: readonly Task[]): Task[] {
  return tasks.filter((each) => each.blockedBy.includes(task.id) && each.state !== "dropped");
}

/** The Dependencies' folded line. */
export function dependenciesSummary(blockers: readonly Task[], waiting: readonly Task[]): string {
  const parts = [
    ...(blockers.length > 0
      ? [`Waits on ${blockers.length} ${blockers.length === 1 ? "Task" : "Tasks"}`]
      : []),
    ...(waiting.length > 0
      ? [`${waiting.length} ${waiting.length === 1 ? "waits" : "wait"} for it`]
      : []),
  ];
  return parts.length > 0 ? parts.join(" · ") : "None";
}

/**
 * The Tasks this one could wait for: any in any Project that can still hold it back and isn't
 * archived, leaving out itself, its blockers already, and every Task that waits for it, which
 * would close a cycle; the service refuses the same.
 */
export function blockerCandidates(task: Task, tasks: readonly Task[]): Task[] {
  const waitingOnIt = waitingForTransitively(task.id, tasks);
  return tasks.filter(
    (each) =>
      each.id !== task.id &&
      canHoldBack(each) &&
      each.archivedAt === null &&
      !task.blockedBy.includes(each.id) &&
      !waitingOnIt.has(each.id),
  );
}

/** The ids of every Task that waits for `taskId`, directly or through others. */
function waitingForTransitively(taskId: string, tasks: readonly Task[]): Set<string> {
  const waiting = new Set<string>();
  const toVisit = [taskId];
  for (let id = toVisit.pop(); id !== undefined; id = toVisit.pop()) {
    for (const each of tasks) {
      if (each.blockedBy.includes(id) && !waiting.has(each.id)) {
        waiting.add(each.id);
        toVisit.push(each.id);
      }
    }
  }
  return waiting;
}
