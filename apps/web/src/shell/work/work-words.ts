import type { BadgeProps } from "@the-office/ui";
import type {
  Author,
  Idea,
  Initiative,
  Priority,
  Role,
  Task,
  TaskCreator,
  TaskHolder,
  TaskKind,
  TaskState,
} from "@the-office/contracts";
import { PAUSED_BY_THE_ALARM } from "../fire-alarm/fire-alarm-words.ts";
import { userName } from "../use-user-name.ts";
import { pausedByUsageWindowWords } from "../usage-window-words.ts";

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

/** What holds a Paused Task, as the Task carries it, for its state's words. */
export interface PausedHold {
  readonly pausedBy?: TaskHolder | null;
  /** When a Task the usage window holds resumes by itself. */
  readonly resumesAt?: string | null;
}

/**
 * How a Task's state reads, a Paused one by what holds it: the alarm, the usage window with when it
 * resumes (spec 2.1), else Paused. Stop leaves the Task Paused (spec §2.1) and only its held Stage
 * knows, so `stopped` can come only from a page that has the Task's Stages.
 */
export function taskStateWords(
  state: TaskState,
  {
    pausedBy = null,
    resumesAt = null,
    stopped = false,
    now = new Date(),
  }: PausedHold & { readonly stopped?: boolean; readonly now?: Date } = {},
): string {
  if (state !== "paused") return TASK_STATE_NAMES[state];
  if (pausedBy === "alarm") return PAUSED_BY_THE_ALARM;
  if (pausedBy === "usage-window") return pausedByUsageWindowWords(resumesAt, now);
  return stopped ? STOPPED : TASK_STATE_NAMES.paused;
}

/** A Task in the Archive, with the moment it was archived. */
export interface Archived {
  readonly archivedAt: string;
}

/**
 * Whether the Task is in the Archive: a mark beside its state, never a state, that takes it off the
 * board and its lists (spec §2.1); blockers, Initiatives and Usage estimates still read it.
 */
export function isArchived<Archivable extends Pick<Task, "archivedAt">>(
  task: Archivable,
): task is Archivable & Archived {
  return task.archivedAt !== null;
}

/** Only a Done or Dropped Task or Initiative can be archived. */
export function canBeArchived(
  record: Pick<Task, "archivedAt"> & { readonly state: Task["state"] | Initiative["state"] },
): boolean {
  return (record.state === "done" || record.state === "dropped") && !isArchived(record);
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
  normal: "equal",
  low: "chevrons-down",
};

/** Each Kind as the UI names it (spec §2.1): "Kind" shows beside it wherever the word could mislead. */
export const KIND_NAMES: Readonly<Record<TaskKind, string>> = {
  feature: "Feature",
  bug: "Bug",
  chore: "Chore",
};

/** Each Kind's Lucide icon; only Bug's is coloured (`.kind-icon.kind-bug`), so bugs stand out. */
export const KIND_ICONS: Readonly<Record<TaskKind, string>> = {
  feature: "sparkles",
  bug: "bug",
  chore: "wrench",
};

/** A Kind's plural, as a Pipeline picker's badge says it: "Default for Bugs". */
export const KIND_PLURALS: Readonly<Record<TaskKind, string>> = {
  feature: "Features",
  bug: "Bugs",
  chore: "Chores",
};

/** The badge on the Pipeline that is a Kind's default, in a Pipeline picker. */
export function kindDefaultWords(kind: TaskKind): string {
  return `Default for ${KIND_PLURALS[kind]}`;
}

/**
 * What a Bug's Description starts as, when Bug is chosen while it is empty (web only: the service
 * sees it as any Description).
 */
export const BUG_DESCRIPTION_OUTLINE =
  "**Steps to reproduce**\n1. \n\n**Expected**\n\n\n**Actual**\n";

/** Where the cursor goes in the outline: the end of "1. ". */
export const BUG_OUTLINE_CURSOR = BUG_DESCRIPTION_OUTLINE.indexOf("1. ") + "1. ".length;

/**
 * The Description after the Kind changes from `from` to `to`: Bug fills the outline into an empty
 * one, and leaving Bug empties it again while it is still the untouched outline. Words of the user's
 * are never touched.
 */
export function descriptionForKind(description: string, from: TaskKind, to: TaskKind): string {
  if (to === "bug" && from !== "bug" && description.trim() === "") return BUG_DESCRIPTION_OUTLINE;
  if (from === "bug" && to !== "bug" && description === BUG_DESCRIPTION_OUTLINE) return "";
  return description;
}

/**
 * "You" for the signed-in user, another user's name, or the person's first name when their Role is
 * known.
 */
export function authorName(
  author: Author,
  roles: readonly Role[] | undefined,
  signedInUserId: string | undefined,
): string {
  if (author.kind === "user") return userName(author.user, signedInUserId);
  return roles?.find((role) => role.key === author.roleKey)?.card.name ?? author.roleKey;
}

/** Who made a Task, as `authorName` says an Author: The Office for one it made by itself. */
export function creatorName(
  creator: TaskCreator,
  roles: readonly Role[] | undefined,
  signedInUserId: string | undefined,
): string {
  return creator.kind === "office" ? "The Office" : authorName(creator, roles, signedInUserId);
}

/** How many of the statements are among the numbers Reported met, counted from 1. */
export function reportedMetCount(statements: readonly string[], met: readonly number[]): number {
  return statements.filter((_, index) => met.includes(index + 1)).length;
}

/** The Projects an Idea is in, for the Project filter: none when it is Office-wide. */
export function projectIdsOfIdea(idea: Pick<Idea, "projectId">): string[] {
  return idea.projectId === null ? [] : [idea.projectId];
}
