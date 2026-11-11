import type { Initiative, InitiativeState, Task } from "@the-office/contracts";
import { dayOf } from "../../shell/time.ts";
import { isArchived, NOT_STARTED } from "../../shell/work/work-words.ts";
import { blockingTasksOf } from "./dependency-words.ts";
import type { InitiativeProgress } from "./initiative-words.ts";
import { lastEndedFirst } from "./last-ended-first.ts";

/** The Initiatives board's filters, kept in its address. */
export interface InitiativesFilters {
  /** Words of a name or an outcome, matched by the service (`GET /initiatives?query=`). */
  readonly query?: string;
  /** Only the Initiatives with a Task waiting on the user; `?waiting=1`. */
  readonly waiting?: 1;
}

/** The filters from the board's address, leaving out whatever isn't one: only the filters set. */
export function initiativesFiltersOf(search: Record<string, unknown>): InitiativesFilters {
  const { query, waiting } = search;
  return {
    ...(typeof query === "string" && query.trim() !== "" && { query }),
    // The router reads `?waiting=1` as the number; a hand-typed `true` means the same.
    ...((waiting === 1 || waiting === true || waiting === "1") && { waiting: 1 as const }),
  };
}

export function hasInitiativesFilters(filters: InitiativesFilters): boolean {
  return filters.query !== undefined || filters.waiting !== undefined;
}

/** A column of the Initiatives board, left to right as an Initiative moves (spec §2.1). */
export interface InitiativeColumn {
  readonly key: "shaping" | "active" | "done";
  readonly label: string;
  /** Under the head; `cto` names who shapes, `archivePeriod` how long an ended one stays. */
  readonly hint: (cto: string, archivePeriod: number) => string;
  /** What fills it, said while it has none in any Project. */
  readonly none: (archivePeriod: number) => string;
}

export const INITIATIVE_COLUMNS: readonly InitiativeColumn[] = [
  {
    key: "shaping",
    label: "Shaping",
    hint: (cto) => `With ${cto}, until you confirm them`,
    none: () => "Nothing being shaped. Shape an Idea into an Initiative from Ideas.",
  },
  {
    key: "active",
    label: "Active",
    hint: () => "Their Tasks are on the Work board",
    none: () => "Nothing Active. Confirm an Initiative in Shaping to start its Tasks.",
  },
  {
    key: "done",
    label: "Done",
    hint: (_cto, archivePeriod) =>
      `Done and dropped in the last ${daysWords(archivePeriod)}, then archived`,
    none: (archivePeriod) => `Nothing done in the last ${daysWords(archivePeriod)}.`,
  },
];

function daysWords(days: number): string {
  return days === 1 ? "day" : `${days} days`;
}

/** The board's Initiatives: those not archived. */
export function onTheBoard(initiatives: readonly Initiative[]): Initiative[] {
  return initiatives.filter((initiative) => !isArchived(initiative));
}

/**
 * The Initiatives in one state, in the order the board shows them: Shaping and Active newest first,
 * as the service answers; Done and Dropped the one that ended last on top, one nothing dates last.
 */
export function inStateInOrder(
  initiatives: readonly Initiative[],
  state: InitiativeState,
): Initiative[] {
  const inState = initiatives.filter((initiative) => initiative.state === state);
  if (state === "shaping" || state === "active") return inState;
  return inState.toSorted(lastEndedFirst);
}

/** What moves in an Initiative now, from its Tasks' states. */
export interface WhatMovesNow {
  /** Its Tasks waiting on the user, by `waitsOnYou`. */
  readonly waitingOnYou: number;
  /** In progress or Paused. */
  readonly inProgress: number;
  /** Not started, waiting for a Task that isn't Done or Dropped. */
  readonly blocked: number;
}

export function whatMovesNow(
  initiativeTasks: readonly Task[],
  tasks: readonly Task[],
  waitsOnYou: (task: Task) => boolean,
): WhatMovesNow {
  return {
    waitingOnYou: initiativeTasks.filter(waitsOnYou).length,
    inProgress: initiativeTasks.filter(({ state }) => state === "in-progress" || state === "paused")
      .length,
    blocked: initiativeTasks.filter(
      (task) => NOT_STARTED.includes(task.state) && blockingTasksOf(task, tasks).length > 0,
    ).length,
  };
}

/** An Active card's edge, as a Task card's: amber while one waits on the user, green while one runs. */
export function activeEdge({ waitingOnYou, inProgress }: WhatMovesNow): string | undefined {
  if (waitingOnYou > 0) return "edge-decision";
  if (inProgress > 0) return "edge-running";
  return undefined;
}

/** What an Active card says in place of "0 of 0 Tasks done". */
export function nothingToCountWords(initiativeTasks: readonly Task[]): string {
  return initiativeTasks.length > 0
    ? "No Task left: every one was dropped. Add a Task or drop the Initiative on its page."
    : "No Task yet. Add one on its page.";
}

/** A Shaping card's foot after "Shaping with …". */
export function tasksSoFarWords(count: number): string {
  if (count === 0) return "No Task yet";
  return `${count} ${count === 1 ? "Task" : "Tasks"} so far`;
}

/** An ended Initiative's final count. */
export function finalCountWords({ done, counted }: Pick<InitiativeProgress, "done" | "counted">) {
  if (counted === 0) return "No Task done";
  return `${done} of ${counted} ${counted === 1 ? "Task" : "Tasks"} done`;
}

/** "Done 3 Nov", "Dropped 20 Oct"; the state alone for one whose end nothing dates. */
export function endedWords(
  { state, endedAt }: Pick<Initiative, "state" | "endedAt">,
  now: Date = new Date(),
): string {
  const name = state === "done" ? "Done" : "Dropped";
  return endedAt === null ? name : `${name} ${dayOf(endedAt, now)}`;
}

/**
 * What a column with no card says: why it shows none, or what would fill it. `inState` is every
 * Initiative on the board in its state, in any Project.
 */
export function emptyColumnWords(
  column: InitiativeColumn,
  inState: readonly Initiative[],
  inProjectFilter: (initiative: Initiative) => boolean,
  archivePeriod: number,
): string {
  if (inState.some(inProjectFilter)) return "None matches the filters.";
  if (inState.length > 0) return "None in the Projects shown.";
  return column.none(archivePeriod);
}

/** "2 archived Initiatives match “sync” too.", under the filter bar while the search matches some. */
export function archivedMatchesWords(count: number, query: string): string {
  const what = count === 1 ? "archived Initiative matches" : "archived Initiatives match";
  return `${count} ${what} “${query.trim()}” too.`;
}

/** The foot of Done: how many archived Initiatives the Projects shown hold. */
export function archivedCountWords(count: number): string {
  return `${count.toLocaleString("en-US")} archived ${count === 1 ? "Initiative" : "Initiatives"}`;
}
