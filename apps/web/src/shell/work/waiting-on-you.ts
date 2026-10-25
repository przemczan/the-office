import { useQuery } from "@tanstack/react-query";
import type { Decision, Task } from "@the-office/contracts";
import { decisionQueries } from "../../api/conversations.ts";

/**
 * A Task in Planning with a Decision open waits on the user without changing state (spec §9); in
 * progress, Waiting on you is a state of its own.
 */
export function waitsOnYou(task: Task, openDecisions: readonly Decision[]): boolean {
  return task.state === "planning" && openDecisions.some(({ taskId }) => taskId === task.id);
}

/** Whether a Task waits on the user while planning, from the one read of the open Decisions. */
export function useWaitingOnYou(): (task: Task) => boolean {
  const openDecisions = useQuery(decisionQueries.open()).data ?? [];
  return (task) => waitsOnYou(task, openDecisions);
}
