import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Initiative, InitiativeState } from "./initiative.js";
import { InitiativeOutcomeWritten, InitiativeStateChanged } from "./initiative-events.js";
import { InitiativeNotShaping } from "./initiative-not-shaping.js";
import { InitiativeRefused } from "./initiative-refused.js";
import { newTaskProblems, trimmedNewTask, type NewTask, type Task } from "./task.js";
import { createTask, type NewTaskSetting, type TaskChange } from "./task-changes.js";
import { addDependency, removeDependency } from "./task-dependencies.js";
import { changeDescription, changeTitle } from "./task-description.js";
import { TaskRefused } from "./task-refused.js";
import type {
  TaskCreated,
  TaskDependencyAdded,
  TaskDependencyRemoved,
  TaskDescriptionChanged,
  TaskTitleChanged,
} from "./task-events.js";

/** An Initiative after a change, with the event that announces it. */
export interface InitiativeChange<Event extends DomainEvent> {
  readonly initiative: Initiative;
  readonly event: Event;
}

/** "Confirm the Initiative": its outcome and Task list are agreed, and it becomes active. */
export function confirmInitiative(
  initiative: Initiative,
): InitiativeChange<InitiativeStateChanged> {
  if (initiative.state !== "shaping") {
    throw new InitiativeRefused([
      `Only an Initiative being shaped can be confirmed; this one is ${initiative.state}.`,
    ]);
  }
  return moveTo(initiative, "active");
}

/** Undefined when it is already dropped. Its Tasks stay as they are. */
export function dropInitiative(
  initiative: Initiative,
): InitiativeChange<InitiativeStateChanged> | undefined {
  if (initiative.state === "dropped") return undefined;
  if (initiative.state === "done") {
    throw new InitiativeRefused(["A done Initiative can't be dropped."]);
  }
  return moveTo(initiative, "dropped");
}

/**
 * Done once it is active and every one of its Tasks that isn't Dropped is Done, at least one of
 * them (spec §2.1 Defaults); undefined otherwise, a shaping one waiting for Confirm.
 */
export function finishInitiative(
  initiative: Initiative,
  tasks: readonly Pick<Task, "state">[],
): InitiativeChange<InitiativeStateChanged> | undefined {
  if (initiative.state !== "active") return undefined;
  const kept = tasks.filter(({ state }) => state !== "dropped");
  if (kept.length === 0 || kept.some(({ state }) => state !== "done")) return undefined;
  return moveTo(initiative, "done");
}

/** A new Task in Backlog in the Initiative; a done or dropped one takes no more. */
export function addTaskToInitiative(
  initiative: Initiative,
  id: string,
  given: NewTask,
  setting: Omit<NewTaskSetting, "initiativeId" | "originIdeaId">,
  at: Date,
): TaskChange<TaskCreated> {
  if (initiative.state === "done" || initiative.state === "dropped") {
    throw new InitiativeRefused([`A ${initiative.state} Initiative takes no more Tasks.`]);
  }
  return createTask(
    id,
    given,
    { ...setting, originIdeaId: undefined, initiativeId: initiative.id },
    at,
  );
}

/**
 * How a change reaches an Initiative (spec §2.1 Defaults): straight onto it, only while it is being
 * shaped, or by a Proposal of the CTO's the user applies, while it is shaping or active.
 */
export type InitiativeChangeRoute = "straight" | "by-proposal";

/**
 * What must be true once it is done, written by the CTO or the user; undefined when it says so
 * already. Each change below judges what it asks before the Initiative's state, so a request that
 * is wrong or changes nothing is answered as such, never turned into a Proposal.
 */
export function writeOutcome(
  initiative: Initiative,
  outcome: string,
  route: InitiativeChangeRoute,
): InitiativeChange<InitiativeOutcomeWritten> | undefined {
  const written = outcome.trim();
  if (written === "") {
    throw new InitiativeRefused(["Write what must be true once the Initiative is done."]);
  }
  if (written === initiative.outcome) return undefined;
  requireOpenTo(initiative, route, "its outcome is written");
  return {
    initiative: { ...initiative, outcome: written },
    event: new InitiativeOutcomeWritten(initiative.id, written),
  };
}

/** The CTO's new Task in the Initiative; the user adds one with addTaskToInitiative. */
export function addCtoTask(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  id: string,
  given: NewTask,
  setting: Omit<NewTaskSetting, "initiativeId" | "originIdeaId">,
  at: Date,
): TaskChange<TaskCreated> {
  requireCtoTaskAllowed(initiative, route, given);
  return addTaskToInitiative(initiative, id, given, setting, at);
}

/**
 * Refuses the CTO's new Task as addCtoTask would, without making it, together with
 * `blockerProblems`, the reasons it couldn't wait for the Tasks it asks to.
 */
export function requireCtoTaskAllowed(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  given: NewTask,
  blockerProblems: readonly string[] = [],
): void {
  const problems = [...newTaskProblems(trimmedNewTask(given)), ...blockerProblems];
  if (problems.length > 0) throw new TaskRefused(problems);
  requireOpenTo(initiative, route, CTO_CHANGES);
}

/**
 * The CTO makes one of the Initiative's Tasks wait for `blockerId`, any Task anywhere; the rules
 * are addDependency's.
 */
export function addDependencyOfItsTask(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  task: Task,
  blockerId: string,
  tasks: readonly Task[],
): TaskChange<TaskDependencyAdded> | undefined {
  return changeItsTask(initiative, route, task, () => addDependency(task, blockerId, tasks));
}

export function removeDependencyOfItsTask(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  task: Task,
  blockerId: string,
): TaskChange<TaskDependencyRemoved> | undefined {
  return changeItsTask(initiative, route, task, () => removeDependency(task, blockerId));
}

/** The CTO rewrites the title of one of the Initiative's Tasks; the rules are changeTitle's. */
export function changeTitleOfItsTask(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  task: Task,
  title: string,
): TaskChange<TaskTitleChanged> | undefined {
  return changeItsTask(initiative, route, task, () => changeTitle(task, title));
}

/** The CTO rewrites the Description of one of its Tasks; the rules are changeDescription's. */
export function changeDescriptionOfItsTask(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  task: Task,
  description: string,
): TaskChange<TaskDescriptionChanged> | undefined {
  return changeItsTask(initiative, route, task, () => changeDescription(task, description));
}

function changeItsTask<Event extends DomainEvent>(
  initiative: Initiative,
  route: InitiativeChangeRoute,
  task: Task,
  change: () => TaskChange<Event> | undefined,
): TaskChange<Event> | undefined {
  requireItsTask(initiative, task);
  const changed = change();
  if (changed) requireOpenTo(initiative, route, CTO_CHANGES);
  return changed;
}

const CTO_CHANGES = "its Tasks and their dependencies change straight onto it";

function requireOpenTo(initiative: Initiative, route: InitiativeChangeRoute, change: string): void {
  const { state } = initiative;
  if (route === "straight" && state !== "shaping") throw new InitiativeNotShaping(state, change);
  if (state === "done" || state === "dropped") {
    throw new InitiativeRefused([`The Initiative is ${state}: it changes no more.`]);
  }
}

function requireItsTask(initiative: Initiative, task: Task): void {
  if (task.initiativeId !== initiative.id) {
    throw new InitiativeRefused([`The Task "${task.title}" isn't one of this Initiative's.`]);
  }
}

/**
 * Every Initiative's Tasks on the board, by the Initiative's id, in the order they were added, so
 * the Projects one spans keep their order.
 */
export function tasksByInitiative(board: readonly Task[]): ReadonlyMap<string, readonly Task[]> {
  const byInitiative = new Map<string, Task[]>();
  const added = board.toSorted(
    (one, other) =>
      one.createdAt.getTime() - other.createdAt.getTime() || one.id.localeCompare(other.id),
  );
  for (const task of added) {
    if (!task.initiativeId) continue;
    const tasks = byInitiative.get(task.initiativeId) ?? [];
    tasks.push(task);
    byInitiative.set(task.initiativeId, tasks);
  }
  return byInitiative;
}

/** The Projects an Initiative spans: its Tasks', each once, in the order its Tasks come. */
export function initiativeProjectIds(tasks: readonly Pick<Task, "projectId">[]): string[] {
  return [...new Set(tasks.map(({ projectId }) => projectId))];
}

function moveTo(
  initiative: Initiative,
  to: InitiativeState,
): InitiativeChange<InitiativeStateChanged> {
  return {
    initiative: { ...initiative, state: to },
    event: new InitiativeStateChanged(initiative.id, initiative.state, to),
  };
}
