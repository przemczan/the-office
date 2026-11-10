import type { Author } from "./author.js";

/**
 * Shaping with the CTO → active on "Confirm the Initiative" → done once its Tasks are, with
 * dropped as the exit (spec §2.1); the moves are in initiative-changes.ts.
 */
export const INITIATIVE_STATES = ["shaping", "active", "done", "dropped"] as const;
export type InitiativeState = (typeof INITIATIVE_STATES)[number];

/**
 * A multi-task effort toward one outcome, Office-wide: each of its Tasks is in one Project, which
 * the Task names (`Task.initiativeId`), so the Projects it spans are its Tasks' (initiativeProjectIds).
 */
export interface Initiative {
  readonly id: string;
  readonly name: string;
  /** What must be true once it is done, in plain language; empty until written. */
  readonly outcome: string;
  readonly state: InitiativeState;
  /** The Idea it was shaped from. */
  readonly originIdeaId: string;
  readonly createdBy: Author;
  readonly createdAt: Date;
  /**
   * When it became Done or Dropped; undefined while it is shaping or active, and for one that ended
   * before the moment was kept and nothing dates.
   */
  readonly endedAt?: Date;
  /** Set while it is in the Archive (initiative-archive.ts), a Done or Dropped one alone. */
  readonly archivedAt?: Date;
  /** Its last Restore from the Archive, from which its Archive period counts again. */
  readonly restoredAt?: Date;
  /**
   * Its latest planning Thread with the Planner, opened by Plan the Initiative; undefined until it
   * is first planned. Only this Thread may move its Tasks to Planning (start_planning).
   */
  readonly planningThreadId?: string;
  /** Whether its latest planning Thread plans its Tasks in auto mode. */
  readonly planningAutoMode: boolean;
}
