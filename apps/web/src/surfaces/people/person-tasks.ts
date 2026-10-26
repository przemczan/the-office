import type { Decision, Pipeline, Task, TaskState, Thread } from "@the-office/contracts";
import { waitsOnYou } from "../../shell/work/waiting-on-you.ts";

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

/** A group of Tasks on the person's Work tab, as the user asks about them. */
export interface WorkFilter {
  readonly key: string;
  readonly label: string;
  /** Whether the Task is in the group, given every Decision waiting on the user. */
  readonly includes: (task: Task, openDecisions: readonly Decision[]) => boolean;
}

export const WORK_FILTERS: readonly [WorkFilter, ...WorkFilter[]] = [
  { key: "all", label: "All", includes: () => true },
  { key: "not-started", label: "Not started", includes: inStates("backlog", "planning", "ready") },
  { key: "in-progress", label: "In progress", includes: inStates("in-progress", "paused") },
  { key: "waiting-on-you", label: "Waiting on you", includes: waitsOnYou },
  { key: "done", label: "Done", includes: inStates("done") },
  { key: "dropped", label: "Dropped", includes: inStates("dropped") },
];

export function inFilter(
  filter: WorkFilter,
  { task }: PersonTask,
  openDecisions: readonly Decision[],
): boolean {
  return filter.includes(task, openDecisions);
}

function inStates(...states: TaskState[]): WorkFilter["includes"] {
  return (task) => states.includes(task.state);
}
