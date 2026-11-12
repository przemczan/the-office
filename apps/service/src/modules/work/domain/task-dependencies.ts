import { isPublishingTask, type Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import { TaskDependencyAdded, TaskDependencyRemoved, type TaskCreated } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { NOT_STARTED_STATES, TASK_STATE_NAMES } from "./task-states.js";

/**
 * The Task waits for `blocker` to be Done before it can start (spec §2.1): any Task in any
 * Project, given every Task to keep the dependencies free of cycles. Undefined when it waits for
 * it already; refused with every reason.
 */
export function addDependency(
  task: Task,
  blockerId: string,
  tasks: readonly Task[],
): TaskChange<TaskDependencyAdded> | undefined {
  if (task.blockedBy.includes(blockerId)) return undefined;
  const problems = dependencyProblems(task, blockerId, tasks);
  if (problems.length > 0) throw new TaskRefused(problems);
  return {
    task: { ...task, blockedBy: [...task.blockedBy, blockerId] },
    event: new TaskDependencyAdded(task.id, blockerId),
  };
}

/**
 * The new Task waiting for each of `blockerIds` from the start, each judged as `addDependency`
 * judges it; refused with every reason.
 */
export function createdWaitingFor(
  created: TaskChange<TaskCreated>,
  blockerIds: readonly string[],
  tasks: readonly Task[],
): TaskChange<TaskCreated> {
  const problems: string[] = [];
  let task = created.task;
  for (const blockerId of blockerIds) {
    try {
      task = addDependency(task, blockerId, tasks)?.task ?? task;
    } catch (error) {
      if (!(error instanceof TaskRefused)) throw error;
      problems.push(...error.reasons);
    }
  }
  if (problems.length > 0) throw new TaskRefused(problems);
  return { ...created, task };
}

/**
 * Why a Task not made yet couldn't wait for each of `blockerIds` from the start, judged as
 * `createdWaitingFor` judges them; nothing waits for a new Task, so it closes no cycle.
 */
export function newTaskBlockerProblems(
  blockerIds: readonly string[],
  tasks: readonly Task[],
): string[] {
  return [...new Set(blockerIds)].flatMap((blockerId) => blockerProblems(blockerId, tasks));
}

/**
 * The Office makes the Publishing Task wait for `blockerId`, a Task added to its Initiative or
 * moved into its Project (spec 2.1, "Publishing Tasks"): unlike the user's dependencies, also once
 * it has started, when it waits before its next Stage. Undefined when it waits for it already, or
 * when the blocker waits for the Publishing Task, as the two would then wait for each other.
 */
export function blockPublishingTask(
  task: Task,
  blockerId: string,
  tasks: readonly Task[],
): TaskChange<TaskDependencyAdded> | undefined {
  if (!isPublishingTask(task)) {
    throw new Error(`The Task ${task.id} isn't a Publishing Task, so The Office doesn't block it.`);
  }
  if (task.blockedBy.includes(blockerId) || blockerId === task.id) return undefined;
  const blocker = tasks.find(({ id }) => id === blockerId);
  if (blocker && waitsFor(blocker, task.id, tasks)) return undefined;
  return {
    task: { ...task, blockedBy: [...task.blockedBy, blockerId] },
    event: new TaskDependencyAdded(task.id, blockerId),
  };
}

/** Undefined when the Task doesn't wait for it. */
export function removeDependency(
  task: Task,
  blockerId: string,
): TaskChange<TaskDependencyRemoved> | undefined {
  if (!task.blockedBy.includes(blockerId)) return undefined;
  return {
    task: { ...task, blockedBy: task.blockedBy.filter((id) => id !== blockerId) },
    event: new TaskDependencyRemoved(task.id, blockerId),
  };
}

/** The blockers still holding the Task back: neither Done nor Dropped (the user, 2026-10-28). */
export function blockingTasks(blockers: readonly Task[]): Task[] {
  return blockers.filter(({ state }) => state !== "done" && state !== "dropped");
}

/** Why a Task with these blockers can't start yet; empty when none holds it back. */
export function blockedProblems(blockers: readonly Task[]): string[] {
  return blockingTasks(blockers).map(
    ({ title }) => `Blocked by "${title}", which must be Done first.`,
  );
}

function dependencyProblems(task: Task, blockerId: string, tasks: readonly Task[]): string[] {
  if (!NOT_STARTED_STATES.includes(task.state)) {
    return [
      `A Task's dependencies are set before it starts; this one is in ${TASK_STATE_NAMES[task.state]}.`,
    ];
  }
  if (blockerId === task.id) return ["A Task can't wait for itself."];
  const problems = blockerProblems(blockerId, tasks);
  const blocker = tasks.find(({ id }) => id === blockerId);
  if (problems.length > 0 || !blocker || !waitsFor(blocker, task.id, tasks)) return problems;
  return [
    `"${blocker.title}" already waits for "${task.title}", so "${task.title}" can't wait for it.`,
  ];
}

/** Why no Task could wait for `blockerId`: it isn't there, or was dropped. */
function blockerProblems(blockerId: string, tasks: readonly Task[]): string[] {
  const blocker = tasks.find(({ id }) => id === blockerId);
  if (!blocker) return [`There is no Task "${blockerId}".`];
  if (blocker.state === "dropped")
    return [`"${blocker.title}" was dropped, so nothing waits for it.`];
  return [];
}

/** Whether `task` waits for `targetId`, directly or through the Tasks it waits for. */
function waitsFor(task: Task, targetId: string, tasks: readonly Task[]): boolean {
  const byId = new Map(tasks.map((each) => [each.id, each]));
  const seen = new Set<string>();
  const toVisit = [...task.blockedBy];
  for (let id = toVisit.pop(); id !== undefined; id = toVisit.pop()) {
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    toVisit.push(...(byId.get(id)?.blockedBy ?? []));
  }
  return false;
}
