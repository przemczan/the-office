import { isPublishingTask, type Task } from "./task.js";
import { isArchived } from "./task-archive.js";
import type { TaskChange } from "./task-changes.js";
import { TaskDependencyAdded, TaskDependencyRemoved, type TaskCreated } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { NOT_STARTED_STATES, TASK_STATE_NAMES } from "./task-states.js";

/** A change of one Task's dependencies, with every link it adds or removes, in order. */
export interface DependencyChange {
  readonly task: Task;
  readonly events: readonly (TaskDependencyAdded | TaskDependencyRemoved)[];
}

/** Every change one added dependency makes (dependencyChanges). */
export interface DependencyChanges {
  /** The Task that waits, as it ends. */
  readonly task: Task;
  /** Every Task changed, the Task that waits first when it changed; none when nothing changed. */
  readonly changed: readonly DependencyChange[];
  /** When the Task already waits for the blocker through another Task: the one it waits for. */
  readonly coveredBy: Task | undefined;
}

/**
 * The Task waits for `blockerId` to be Done before it can start (spec §2.1): any Task in any
 * Project, given every Task to keep the dependencies free of cycles; refused with every reason. A
 * Task waits directly only for Tasks it doesn't already wait for through another Task (the user,
 * 2026-11-15), so the change is:
 * - nothing, when it waits for the blocker already, directly or through another Task (`coveredBy`);
 * - otherwise the new link, less the Task's direct links it now waits for through another, and on
 *   every Task not started that waits for this one and now waits through it for one it waits for
 *   directly, the same: its direct links covered by another of its links go. Links covered before
 *   aren't looked for elsewhere; they go when their Task changes this way.
 * Started Tasks keep their dependencies. A Publishing Task waits for every Task of its Initiative
 * by design: its own links are never taken out, it is given the link as asked, and the links The
 * Office keeps on it never count as another Task's wait.
 */
export function dependencyChanges(
  task: Task,
  blockerId: string,
  tasks: readonly Task[],
): DependencyChanges {
  const unchanged = { task, changed: [], coveredBy: undefined };
  if (task.blockedBy.includes(blockerId)) return unchanged;
  const problems = dependencyProblems(task, blockerId, tasks);
  if (problems.length > 0) throw new TaskRefused(problems);
  const added = {
    task: { ...task, blockedBy: [...task.blockedBy, blockerId] },
    events: [new TaskDependencyAdded(task.id, blockerId)],
  };
  if (isPublishingTask(task)) return { task: added.task, changed: [added], coveredBy: undefined };
  const byId = new Map(tasks.map((each) => [each.id, each]));
  const coveredBy = task.blockedBy
    .map((id) => byId.get(id))
    .find((each) => each !== undefined && coveredWaits(each, byId).has(blockerId));
  if (coveredBy) return { ...unchanged, coveredBy };

  // What the Task newly waits for: the blocker and every Task the blocker waits for. A Task not
  // started that waits for this one and directly for one of those changes: it, like this Task,
  // keeps only the direct links no other of its links covers. No other Task changes, and no removal
  // takes a wait away, as each is kept through another link, the dependencies having no cycle.
  const blocker = byId.get(blockerId);
  const newlyCovered = new Set([blockerId, ...(blocker ? coveredWaits(blocker, byId) : [])]);
  byId.set(task.id, added.task);
  const others = tasks.flatMap((each): DependencyChange[] => {
    if (each.id === task.id || !canLoseCoveredLinks(each)) return [];
    if (!each.blockedBy.some((id) => newlyCovered.has(id))) return [];
    if (!coveredWaits(each, byId).has(task.id)) return [];
    const change = withoutLinks(each, coveredLinks(each, byId));
    return change ? [change] : [];
  });
  const own = withoutLinks(added.task, coveredLinks(added.task, byId));
  const changedTask: DependencyChange = own
    ? { task: own.task, events: [...added.events, ...own.events] }
    : added;
  return { task: changedTask.task, changed: [changedTask, ...others], coveredBy: undefined };
}

/**
 * The new Task waiting for each of `blockerIds` from the start, each judged as `dependencyChanges`
 * judges it, refused with every reason, and waiting directly only for those no other of them
 * waits for (the user, 2026-11-15). Nothing waits for a new Task, so no other Task changes.
 */
export function createdWaitingFor(
  created: TaskChange<TaskCreated>,
  blockerIds: readonly string[],
  tasks: readonly Task[],
): TaskChange<TaskCreated> {
  const problems: string[] = [];
  const asked = [...new Set(blockerIds)];
  for (const blockerId of asked) {
    try {
      dependencyChanges(created.task, blockerId, tasks);
    } catch (error) {
      if (!(error instanceof TaskRefused)) throw error;
      problems.push(...error.reasons);
    }
  }
  if (problems.length > 0) throw new TaskRefused(problems);
  const byId = new Map(tasks.map((each) => [each.id, each]));
  const covered = new Set(
    asked.flatMap((id) => {
      const blocker = byId.get(id);
      return blocker ? [...coveredWaits(blocker, byId)] : [];
    }),
  );
  const blockedBy = [
    ...created.task.blockedBy,
    ...asked.filter((id) => !covered.has(id) && !created.task.blockedBy.includes(id)),
  ];
  return { ...created, task: { ...created.task, blockedBy } };
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

/** Why no Task could wait for `blockerId`: it isn't there, was dropped or is archived. */
function blockerProblems(blockerId: string, tasks: readonly Task[]): string[] {
  const blocker = tasks.find(({ id }) => id === blockerId);
  if (!blocker) return [`There is no Task "${blockerId}".`];
  if (blocker.state === "dropped")
    return [`"${blocker.title}" was dropped, so nothing waits for it.`];
  if (isArchived(blocker)) return [`"${blocker.title}" is archived, so nothing waits for it.`];
  return [];
}

/**
 * What `task` waits for in a way that lets another Task leave out a direct wait: the Tasks it waits
 * for directly or through others, never through a Publishing Task, whose links The Office keeps and
 * takes out by itself, nor through a Task Done or Dropped, which holds nothing back any more.
 */
function coveredWaits(task: Task, byId: ReadonlyMap<string, Task>): Set<string> {
  const seen = new Set<string>();
  if (!passesWaitsOn(task)) return seen;
  const toVisit = [...task.blockedBy];
  for (let id = toVisit.pop(); id !== undefined; id = toVisit.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const each = byId.get(id);
    if (each && passesWaitsOn(each)) toVisit.push(...each.blockedBy);
  }
  return seen;
}

function passesWaitsOn(task: Task): boolean {
  return !isPublishingTask(task) && task.state !== "done" && task.state !== "dropped";
}

/** The Task's direct links it also waits for through another of its links. */
function coveredLinks(task: Task, byId: ReadonlyMap<string, Task>): Set<string> {
  const through = task.blockedBy.flatMap((id) => {
    const each = byId.get(id);
    return each ? [...coveredWaits(each, byId)] : [];
  });
  return new Set(through.filter((id) => task.blockedBy.includes(id)));
}

/** A Task whose direct links another's wait now covers loses them only before it starts. */
function canLoseCoveredLinks(task: Task): boolean {
  return NOT_STARTED_STATES.includes(task.state) && !isPublishingTask(task);
}

/** The Task without its direct links to `ids`; undefined when it has none of them. */
function withoutLinks(task: Task, ids: ReadonlySet<string>): DependencyChange | undefined {
  const removed = task.blockedBy.filter((id) => ids.has(id));
  if (removed.length === 0) return undefined;
  return {
    task: { ...task, blockedBy: task.blockedBy.filter((id) => !ids.has(id)) },
    events: removed.map((id) => new TaskDependencyRemoved(task.id, id)),
  };
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
