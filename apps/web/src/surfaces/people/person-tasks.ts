import type { Pipeline, Task, TaskState, Thread } from "@the-office/contracts";

/** A Task the person has a part in, and what that part is, in a few words. */
export interface PersonTask {
  readonly task: Task;
  readonly part: string;
}

/**
 * The Tasks the person has a part in: those they created, as from a chat, those with a Thread with
 * them, by its title (as "Planning"), and those whose Pipeline has a Stage their Role works, by
 * the Stages' names (task 10). Ownership and consultations add theirs in later tasks.
 */
export function personTasks(
  roleKey: string,
  tasks: readonly Task[],
  pipelines: readonly Pipeline[],
  threadsOnTasks: readonly Thread[],
): PersonTask[] {
  return tasks.flatMap((task) => {
    const created = task.createdBy.kind === "person" && task.createdBy.roleKey === roleKey;
    const threads = threadsOnTasks
      .filter(({ home }) => home.kind === "task" && home.taskId === task.id)
      .map(({ title }) => title ?? "A Thread");
    const stages =
      pipelines
        .find(({ id }) => id === task.pipelineId)
        ?.stages.filter((stage) => stage.kind === "agent" && stage.role === roleKey)
        .map(({ name }) => name) ?? [];
    const parts = new Set([...(created ? ["Created it"] : []), ...threads, ...stages]);
    return parts.size > 0 ? [{ task, part: [...parts].join(" · ") }] : [];
  });
}

/** A group of states on the person's Work tab, as the user asks about them; All has none. */
export interface WorkFilter {
  readonly key: string;
  readonly label: string;
  readonly states?: readonly TaskState[];
}

export const WORK_FILTERS: readonly [WorkFilter, ...WorkFilter[]] = [
  { key: "all", label: "All" },
  { key: "not-started", label: "Not started", states: ["backlog", "planning", "ready"] },
  { key: "in-progress", label: "In progress", states: ["in-progress", "paused"] },
  { key: "waiting-on-you", label: "Waiting on you", states: ["waiting-on-you"] },
  { key: "done", label: "Done", states: ["done"] },
  { key: "dropped", label: "Dropped", states: ["dropped"] },
];

export function inFilter(filter: WorkFilter, { task }: PersonTask): boolean {
  return filter.states === undefined || filter.states.includes(task.state);
}
