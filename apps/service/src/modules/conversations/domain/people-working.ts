import type { Thread } from "./thread.js";

/** Who works on a Task right now, each once, the one who started first leading. */
export interface TaskPeopleWorking {
  readonly taskId: string;
  readonly roleKeys: readonly string[];
}

/**
 * Whether the Thread's person works in it now: it is answering and waits on no Decision. A Stage
 * Thread stays answering while it waits on its open Decision, so that Thread doesn't count, and a
 * Consultant answering the Decision counts through their Consultation. An Initiative's planning
 * Thread stays answerable while the planner works, so its person works in it while its Decisions
 * wait.
 */
export function worksIn({ home, state, openDecisions }: Thread): boolean {
  if (state !== "answering") return false;
  return home.kind === "initiative" || openDecisions.length === 0;
}

/** The people working on each Task, from the Threads answering now; a Task with nobody isn't listed. */
export function peopleWorkingOnTasks(threads: readonly Thread[]): readonly TaskPeopleWorking[] {
  const oldestFirst = threads.toSorted(
    (one, other) => one.startedAt.getTime() - other.startedAt.getTime(),
  );
  const roleKeysByTask = new Map<string, Set<string>>();
  for (const thread of oldestFirst) {
    if (thread.home.kind !== "task" || !worksIn(thread)) continue;
    const roleKeys = roleKeysByTask.get(thread.home.taskId) ?? new Set();
    roleKeysByTask.set(thread.home.taskId, roleKeys.add(thread.roleKey));
  }
  return [...roleKeysByTask].map(([taskId, roleKeys]) => ({ taskId, roleKeys: [...roleKeys] }));
}
