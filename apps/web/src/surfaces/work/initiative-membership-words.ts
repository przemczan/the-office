import type { Initiative, TaskSummary } from "@the-office/contracts";
import { NOT_STARTED, TASK_STATE_NAMES } from "../../shell/work/work-words.ts";

/**
 * Whether the Task may join or leave an Initiative at all: before it starts, and never one The
 * Office made. The service judges the rest, and refuses in the same words as to an Agent.
 */
function canChangeInitiative(task: TaskSummary): boolean {
  return NOT_STARTED.includes(task.state) && task.madeFor === null && task.archivedAt === null;
}

/** Whether the Task, in no Initiative, could join one. */
export function canJoinAnInitiative(task: TaskSummary): boolean {
  return task.initiativeId === null && canChangeInitiative(task);
}

/** Whether the Task could leave its Initiative. */
export function canBeTakenOut(task: TaskSummary): boolean {
  return task.initiativeId !== null && canChangeInitiative(task);
}

/**
 * The Initiatives the Task could join: being shaped, while it is in Backlog, or active; never an
 * archived one.
 */
export function initiativesToJoin(
  task: TaskSummary,
  initiatives: readonly Initiative[],
): Initiative[] {
  return initiatives.filter(
    ({ state, archivedAt }) =>
      archivedAt === null &&
      (state === "active" || (state === "shaping" && task.state === "backlog")),
  );
}

/** The Tasks in no Initiative that could join this one. */
export function tasksToAdd(initiative: Initiative, tasks: readonly TaskSummary[]): TaskSummary[] {
  return tasks.filter(
    (task) => canJoinAnInitiative(task) && initiativesToJoin(task, [initiative]).length > 0,
  );
}

/** The Initiative's Tasks that could leave it. */
export function tasksToTakeOut(
  initiative: Initiative,
  tasks: readonly TaskSummary[],
): TaskSummary[] {
  return tasks.filter((task) => task.initiativeId === initiative.id && canBeTakenOut(task));
}

/** What joining does to the Task's state. */
export function joiningWords(task: TaskSummary, initiative: Initiative): string {
  return initiative.state === "shaping"
    ? "It moves to Shaping, and to Backlog once the Initiative is confirmed."
    : `It stays in ${TASK_STATE_NAMES[task.state]}.`;
}

/** What taking the Task out does to its state; its dependencies stay either way. */
export function takingOutWords(task: TaskSummary): string {
  const plannedInInitiative = task.initiativePlanningThreadId !== null;
  const state =
    task.state === "shaping"
      ? "It goes to Backlog."
      : task.state === "planning" && plannedInInitiative
        ? "It is planned in the Initiative's planning Thread, so it goes back to Backlog."
        : task.state === "ready" && plannedInInitiative
          ? "It stays Ready; it was planned in the Initiative's planning Thread, so a change of its Plan later takes it to Backlog."
          : `It stays in ${TASK_STATE_NAMES[task.state]}.`;
  return `${state} What it waits for stays.`;
}
