import type { TaskSummary } from "@the-office/contracts";

/** The Tasks this one must wait for, in the order they were added. */
export function blockersOf(task: TaskSummary, tasks: readonly TaskSummary[]): TaskSummary[] {
  return task.blockedBy.flatMap((id) => tasks.find((each) => each.id === id) ?? []);
}

/** The blockers still holding the Task back: a Done or Dropped one no longer blocks (spec §2.1). */
export function blockingTasksOf(task: TaskSummary, tasks: readonly TaskSummary[]): TaskSummary[] {
  return blockersOf(task, tasks).filter(canHoldBack);
}

/** Whether a Task waiting for this one would wait: neither Done nor Dropped. */
export function canHoldBack({ state }: TaskSummary): boolean {
  return state !== "done" && state !== "dropped";
}

/** How far the Initiative is; a Dropped Task no longer counts, as it is done without it (spec §2.1). */
export interface InitiativeProgress {
  readonly done: number;
  readonly counted: number;
  /** Ready, and waiting for no Task. */
  readonly readyToStart: number;
}

export function initiativeProgress(
  initiativeTasks: readonly TaskSummary[],
  tasks: readonly TaskSummary[],
): InitiativeProgress {
  const counted = initiativeTasks.filter(({ state }) => state !== "dropped");
  return {
    done: counted.filter(({ state }) => state === "done").length,
    counted: counted.length,
    readyToStart: counted.filter(
      (task) => task.state === "ready" && blockingTasksOf(task, tasks).length === 0,
    ).length,
  };
}

export function progressWords({ done, counted, readyToStart }: InitiativeProgress): string {
  const ready = readyToStart > 0 ? ` · ${readyToStart} ready to start` : "";
  return `${done} of ${counted} ${counted === 1 ? "Task" : "Tasks"} done${ready}`;
}
