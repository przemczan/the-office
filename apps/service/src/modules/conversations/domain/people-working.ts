import type { Thread } from "./thread.js";

/** Who works on a Task right now, each once, the one who started first leading. */
export interface TaskPeopleWorking {
  readonly taskId: string;
  readonly roleKeys: readonly string[];
}

/**
 * The people working on each Task, from the Threads answering now; a Task with nobody isn't
 * listed. A Stage Thread stays answering while it waits on its open Decision, so that Thread
 * doesn't count, and a Consultant answering the Decision counts through their Consultation.
 */
export function peopleWorkingOnTasks(threads: readonly Thread[]): readonly TaskPeopleWorking[] {
  const oldestFirst = threads.toSorted(
    (one, other) => one.startedAt.getTime() - other.startedAt.getTime(),
  );
  const roleKeysByTask = new Map<string, Set<string>>();
  for (const { home, roleKey, state, openDecision } of oldestFirst) {
    if (home.kind !== "task" || state !== "answering" || openDecision) continue;
    const roleKeys = roleKeysByTask.get(home.taskId) ?? new Set();
    roleKeysByTask.set(home.taskId, roleKeys.add(roleKey));
  }
  return [...roleKeysByTask].map(([taskId, roleKeys]) => ({ taskId, roleKeys: [...roleKeys] }));
}
