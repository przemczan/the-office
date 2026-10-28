import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Initiative, InitiativeState } from "./initiative.js";
import { InitiativeOutcomeWritten, InitiativeStateChanged } from "./initiative-events.js";
import { InitiativeNotShaping } from "./initiative-not-shaping.js";
import { InitiativeRefused } from "./initiative-refused.js";
import type { NewTask, Task } from "./task.js";
import { createTask, type NewTaskSetting, type TaskChange } from "./task-changes.js";
import { addDependency, removeDependency } from "./task-dependencies.js";
import type { TaskCreated, TaskDependencyAdded, TaskDependencyRemoved } from "./task-events.js";

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
 * What must be true once it is done, written by the CTO or the user while it is being shaped (spec
 * §2.1 Defaults); undefined when it says so already.
 */
export function writeOutcome(
  initiative: Initiative,
  outcome: string,
): InitiativeChange<InitiativeOutcomeWritten> | undefined {
  requireShaping(initiative, "its outcome is written");
  const written = outcome.trim();
  if (written === "") {
    throw new InitiativeRefused(["Write what must be true once the Initiative is done."]);
  }
  if (written === initiative.outcome) return undefined;
  return {
    initiative: { ...initiative, outcome: written },
    event: new InitiativeOutcomeWritten(initiative.id, written),
  };
}

/**
 * The CTO's new Task, straight onto an Initiative being shaped (spec §2.1 Defaults); the user adds
 * one with addTaskToInitiative while it is active too.
 */
export function addTaskWhileShaping(
  initiative: Initiative,
  id: string,
  given: NewTask,
  setting: Omit<NewTaskSetting, "initiativeId" | "originIdeaId">,
  at: Date,
): TaskChange<TaskCreated> {
  requireShaping(initiative, CTO_CHANGES);
  return addTaskToInitiative(initiative, id, given, setting, at);
}

/**
 * The CTO makes one of the Initiative's Tasks wait for `blockerId`, any Task anywhere, while it is
 * being shaped; the rules are addDependency's.
 */
export function addDependencyWhileShaping(
  initiative: Initiative,
  task: Task,
  blockerId: string,
  tasks: readonly Task[],
): TaskChange<TaskDependencyAdded> | undefined {
  requireShaping(initiative, CTO_CHANGES);
  requireItsTask(initiative, task);
  return addDependency(task, blockerId, tasks);
}

export function removeDependencyWhileShaping(
  initiative: Initiative,
  task: Task,
  blockerId: string,
): TaskChange<TaskDependencyRemoved> | undefined {
  requireShaping(initiative, CTO_CHANGES);
  requireItsTask(initiative, task);
  return removeDependency(task, blockerId);
}

const CTO_CHANGES = "its Tasks and their dependencies change straight onto it";

function requireShaping(initiative: Initiative, change: string): void {
  if (initiative.state !== "shaping") throw new InitiativeNotShaping(initiative.state, change);
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
