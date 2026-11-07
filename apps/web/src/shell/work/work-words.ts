import type { BadgeProps } from "@the-office/ui";
import type { Author, Idea, Priority, Role, TaskState } from "@the-office/contracts";
import { PAUSED_BY_THE_ALARM } from "../fire-alarm/fire-alarm-words.ts";

/** Each Task state as the UI names it (spec §2.1). */
export const TASK_STATE_NAMES: Readonly<Record<TaskState, string>> = {
  shaping: "Shaping",
  backlog: "Backlog",
  planning: "Planning",
  ready: "Ready",
  "in-progress": "In progress",
  "waiting-on-you": "Waiting on you",
  paused: "Paused",
  done: "Done",
  dropped: "Dropped",
};

/** A Stage the user stopped, and the Task held there. */
export const STOPPED = "Stopped";

/**
 * How a Task's state reads, a Paused one by what holds it. Stop leaves the Task Paused (spec §2.1)
 * and only its held Stage knows, so `stopped` can come only from a page that has the Task's Stages.
 */
export function taskStateWords(
  state: TaskState,
  {
    pausedByAlarm = false,
    stopped = false,
  }: { readonly pausedByAlarm?: boolean; readonly stopped?: boolean } = {},
): string {
  if (state !== "paused") return TASK_STATE_NAMES[state];
  if (pausedByAlarm) return PAUSED_BY_THE_ALARM;
  return stopped ? STOPPED : TASK_STATE_NAMES.paused;
}

/** The states before In progress: the Task can still be reordered and its priority changed. */
export const NOT_STARTED: readonly TaskState[] = ["shaping", "backlog", "planning", "ready"];

/** How a state's badge reads: running green, waiting on someone amber, ended by how it ended. */
export const TASK_STATE_TONES: Readonly<Record<TaskState, NonNullable<BadgeProps["tone"]>>> = {
  shaping: "neutral",
  backlog: "neutral",
  planning: "neutral",
  ready: "neutral",
  "in-progress": "success",
  "waiting-on-you": "warning",
  paused: "warning",
  done: "success",
  dropped: "danger",
};

export const PRIORITY_NAMES: Readonly<Record<Priority, string>> = {
  high: "High",
  normal: "Normal",
  low: "Low",
};

export const PRIORITY_ICONS: Readonly<Record<Priority, string>> = {
  high: "chevrons-up",
  normal: "minus",
  low: "chevron-down",
};

/** "You" for the user, or the person's first name when their Role is known. */
export function authorName(author: Author, roles: readonly Role[] | undefined): string {
  if (author.kind === "user") return "You";
  return roles?.find((role) => role.key === author.roleKey)?.card.name ?? author.roleKey;
}

/** The Projects an Idea is in, for the Project filter: none when it is Office-wide. */
/** How many of the statements are among the numbers Reported met, counted from 1. */
export function reportedMetCount(statements: readonly string[], met: readonly number[]): number {
  return statements.filter((_, index) => met.includes(index + 1)).length;
}

export function projectIdsOfIdea(idea: Pick<Idea, "projectId">): string[] {
  return idea.projectId === null ? [] : [idea.projectId];
}
