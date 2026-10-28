import type { BadgeProps } from "@the-office/ui";
import type { Author, Idea, Priority, Role, TaskState } from "@the-office/contracts";

/** Each Task state as the UI names it (spec §2.1). */
export const TASK_STATE_NAMES: Readonly<Record<TaskState, string>> = {
  backlog: "Backlog",
  planning: "Planning",
  ready: "Ready",
  "in-progress": "In progress",
  "waiting-on-you": "Waiting on you",
  paused: "Paused",
  done: "Done",
  dropped: "Dropped",
};

/** The states before In progress: the Task can still be reordered and its priority changed. */
export const NOT_STARTED: readonly TaskState[] = ["backlog", "planning", "ready"];

/** How a state's badge reads: running green, waiting on someone amber, ended by how it ended. */
export const TASK_STATE_TONES: Readonly<Record<TaskState, NonNullable<BadgeProps["tone"]>>> = {
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
export function projectIdsOfIdea(idea: Pick<Idea, "projectId">): string[] {
  return idea.projectId === null ? [] : [idea.projectId];
}
