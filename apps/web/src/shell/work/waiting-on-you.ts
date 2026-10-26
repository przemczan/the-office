import { useQuery } from "@tanstack/react-query";
import type { Decision, Task } from "@the-office/contracts";
import { decisionQueries } from "../../api/conversations.ts";

/**
 * Whether a Task waits on the user (spec §9): in progress, Waiting on you is a state of its own; a
 * Task in Planning with a Decision open waits on the user without changing state. Every count and
 * filter of Waiting on you goes by this.
 */
export function waitsOnYou(task: Task, openDecisions: readonly Decision[]): boolean {
  return task.state === "waiting-on-you" || waitsOnYouWhilePlanning(task, openDecisions);
}

/** A Task in Planning with a Decision open: its state doesn't say it waits on the user. */
export function waitsOnYouWhilePlanning(task: Task, openDecisions: readonly Decision[]): boolean {
  return task.state === "planning" && openDecisions.some(({ taskId }) => taskId === task.id);
}

/** Whether a Task waits on the user, from the one read of the open Decisions. */
export function useWaitingOnYou(): (task: Task) => boolean {
  const openDecisions = useOpenDecisions();
  return (task) => waitsOnYou(task, openDecisions);
}

/** Whether a Task waits on the user while planning, which a badge beside its state shows. */
export function useWaitingOnYouWhilePlanning(): (task: Task) => boolean {
  const openDecisions = useOpenDecisions();
  return (task) => waitsOnYouWhilePlanning(task, openDecisions);
}

function useOpenDecisions(): readonly Decision[] {
  return useQuery(decisionQueries.open()).data ?? [];
}
