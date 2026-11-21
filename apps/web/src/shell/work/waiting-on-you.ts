import { useQuery } from "@tanstack/react-query";
import type { Decision, TaskSummary } from "@the-office/contracts";
import { decisionQueries } from "../../api/conversations.ts";

/**
 * Whether a Task waits on the user (spec §9): in progress, Waiting on you is a state of its own; a
 * Task in Planning, or Paused with a Decision its Agent opened before the user held it (spec §2.4),
 * waits on the user without changing state. Every count and filter of Waiting on you goes by this.
 */
export function waitsOnYou(task: TaskSummary, openDecisions: readonly Decision[]): boolean {
  return task.state === "waiting-on-you" || waitsOnYouInItsState(task, openDecisions);
}

/** A Task in Planning or Paused with a Decision open: its state doesn't say it waits on the user. */
export function waitsOnYouInItsState(
  task: TaskSummary,
  openDecisions: readonly Decision[],
): boolean {
  return (
    (task.state === "planning" || task.state === "paused") &&
    openDecisions.some(({ taskId }) => taskId === task.id)
  );
}

/** Whether a Task waits on the user, from the one read of the open Decisions. */
export function useWaitingOnYou(): (task: TaskSummary) => boolean {
  const openDecisions = useOpenDecisions();
  return (task) => waitsOnYou(task, openDecisions);
}

/** Whether a Task waits on the user in its state, which a badge beside its state shows. */
export function useWaitingOnYouInItsState(): (task: TaskSummary) => boolean {
  const openDecisions = useOpenDecisions();
  return (task) => waitsOnYouInItsState(task, openDecisions);
}

function useOpenDecisions(): readonly Decision[] {
  return useQuery(decisionQueries.open()).data ?? [];
}
