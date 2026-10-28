import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Initiative, InitiativeState } from "./initiative.js";
import { InitiativeStateChanged } from "./initiative-events.js";
import { InitiativeRefused } from "./initiative-refused.js";
import type { NewTask, Task } from "./task.js";
import { createTask, type NewTaskSetting, type TaskChange } from "./task-changes.js";
import type { TaskCreated } from "./task-events.js";

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
