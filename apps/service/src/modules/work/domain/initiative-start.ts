import type { Initiative } from "./initiative.js";
import { InitiativeRefused } from "./initiative-refused.js";
import { boardOrder } from "./manual-order.js";
import type { Task } from "./task.js";

/*
 * Start Ready Tasks (spec §2.1): the normal Start on each of an active Initiative's Ready Tasks,
 * one after another, an Overlap always answered with "queue behind".
 */

/**
 * The Initiative's Ready Tasks in the order Start Ready Tasks starts them: a blocker inside the
 * Initiative before the Tasks waiting for it, so its queue place is ahead of theirs, and the board's
 * order otherwise. A Task already in the queue is among them: Start on it keeps its place.
 * Refused with the reasons when the Initiative isn't active or has no Ready Task.
 */
export function readyTasksToStart(initiative: Initiative, tasks: readonly Task[]): Task[] {
  if (initiative.state !== "active") {
    throw new InitiativeRefused([
      `Only an active Initiative's Tasks are started together; this one is ${initiative.state === "shaping" ? "being shaped: confirm it first" : initiative.state}.`,
    ]);
  }
  const ready = tasks
    .filter(({ initiativeId, state }) => initiativeId === initiative.id && state === "ready")
    .toSorted(boardOrder);
  if (ready.length === 0) {
    throw new InitiativeRefused([
      "None of the Initiative's Tasks is Ready: nothing is left to start.",
    ]);
  }
  return blockersFirst(ready);
}

/**
 * `tasks` in their order, each preceded by the ones among them it waits for, directly or through
 * another. Dependencies never close a cycle (TaskRepository.changeDependencies), and a Task already
 * placed is never placed again, so this ends either way.
 */
function blockersFirst(tasks: readonly Task[]): Task[] {
  const placed = new Set<string>();
  const ordered: Task[] = [];
  const place = (task: Task): void => {
    if (placed.has(task.id)) return;
    placed.add(task.id);
    for (const blocker of tasks.filter(({ id }) => task.blockedBy.includes(id))) place(blocker);
    ordered.push(task);
  };
  for (const task of tasks) place(task);
  return ordered;
}
