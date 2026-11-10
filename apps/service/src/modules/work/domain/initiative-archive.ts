import type { Initiative } from "./initiative.js";
import type { InitiativeChange } from "./initiative-changes.js";
import { InitiativeArchived, InitiativeRestored } from "./initiative-events.js";
import { InitiativeRefused } from "./initiative-refused.js";
import type { ProjectFilter } from "./project-filter.js";
import type { Task } from "./task.js";

// The Archive of Initiatives, by the rules of task-archive.ts (spec §2.1).

/** How many archived Initiatives a page of the Archive holds. */
export const ARCHIVE_PAGE_SIZE = 25;

/** The Archive's Done / Dropped / All filter. */
export type ArchiveStateFilter = "all" | "done" | "dropped";

/** What a page of the Archive is asked for: every filter is applied in the search, never after. */
export interface ArchiveSearch {
  /** Each the start of a word of its name or outcome (`searchWords`); none for every one. */
  readonly words: readonly string[];
  readonly state: ArchiveStateFilter;
  /** Counting from 1. */
  readonly page: number;
  readonly projects: ProjectFilter;
}

/** An archived Initiative with its Tasks, from which its Projects and final count are read. */
export interface ArchivedInitiative {
  readonly initiative: Initiative;
  readonly tasks: readonly Task[];
}

/** One page, the one that ended last on top, and how many match each state with the other filters. */
export interface ArchivePage {
  readonly initiatives: readonly ArchivedInitiative[];
  readonly counts: { readonly done: number; readonly dropped: number };
}

/** Whether the Initiative is in the Archive: a mark beside its state, never a state. */
export function isInitiativeArchived(initiative: Initiative): boolean {
  return initiative.archivedAt !== undefined;
}

/** A Done or Dropped Initiative still on the board: the ones the daily run weighs. */
export function isEndedOnTheBoard(initiative: Initiative): boolean {
  return isEnded(initiative) && !isInitiativeArchived(initiative);
}

/**
 * Takes a Done or Dropped Initiative off the board, its state untouched; refused in any other
 * state, and undefined when it is already archived.
 */
export function archiveInitiative(
  initiative: Initiative,
  at: Date,
): InitiativeChange<InitiativeArchived> | undefined {
  if (!isEnded(initiative)) {
    throw new InitiativeRefused([
      `Only a Done or Dropped Initiative can be archived; this one is ${initiative.state}.`,
    ]);
  }
  if (isInitiativeArchived(initiative)) return undefined;
  return {
    initiative: { ...initiative, archivedAt: at },
    event: new InitiativeArchived(initiative.id, at),
  };
}

/**
 * Returns an archived Initiative to the board in the state it had, keeping the moment, from which
 * archiving it automatically counts again. Undefined when it isn't archived.
 */
export function restoreInitiative(
  initiative: Initiative,
  at: Date,
): InitiativeChange<InitiativeRestored> | undefined {
  if (!isInitiativeArchived(initiative)) return undefined;
  return {
    initiative: { ...initiative, archivedAt: undefined, restoredAt: at },
    event: new InitiativeRestored(initiative.id, at),
  };
}

/**
 * Where the Initiative's Archive period starts: the later of its end and its last Restore.
 * Undefined for one that ended before its end was kept and was never restored: nothing dates it,
 * so it is due at once.
 */
export function initiativeArchivePeriodStart(initiative: Initiative): Date | undefined {
  const { endedAt, restoredAt } = initiative;
  if (!endedAt || !restoredAt) return endedAt ?? restoredAt;
  return restoredAt > endedAt ? restoredAt : endedAt;
}

/**
 * Archives a Done or Dropped Initiative on the board whose Archive period started before `cutoff`
 * (archiveCutoff); undefined for any other, which stays as it is.
 */
export function archiveInitiativeIfDue(
  initiative: Initiative,
  cutoff: Date,
  at: Date,
): InitiativeChange<InitiativeArchived> | undefined {
  if (!isEndedOnTheBoard(initiative)) return undefined;
  const start = initiativeArchivePeriodStart(initiative);
  if (start && start >= cutoff) return undefined;
  return archiveInitiative(initiative, at);
}

function isEnded({ state }: Initiative): boolean {
  return state === "done" || state === "dropped";
}
