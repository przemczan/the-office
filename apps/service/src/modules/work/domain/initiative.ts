import type { ArchivedBy, Author } from "./author.js";

/**
 * Shaping with whoever shapes Initiatives → active on "Confirm the Initiative" → done once its
 * Tasks are, with dropped as the exit (spec §2.1); the moves are in initiative-changes.ts.
 */
export const INITIATIVE_STATES = ["shaping", "active", "done", "dropped"] as const;
export type InitiativeState = (typeof INITIATIVE_STATES)[number];

/**
 * A multi-task effort toward one outcome, Office-wide: each of its Tasks is in one Project, which
 * the Task names (`Task.initiativeId`), so the Projects it spans are its Tasks'
 * (initiativeProjectIds).
 */
export interface Initiative {
  readonly id: string;
  readonly name: string;
  /** What must be true once it is done, in plain language; empty until written. */
  readonly outcome: string;
  readonly state: InitiativeState;
  /** The Idea it was shaped from; undefined for one created with create_initiative. */
  readonly originIdeaId: string | undefined;
  readonly createdBy: Author;
  readonly createdAt: Date;
  /**
   * When it became Done or Dropped; undefined while it is shaping or active, and for one that ended
   * before the moment was kept and nothing dates.
   */
  readonly endedAt?: Date;
  /** Set while it is in the Archive (initiative-archive.ts), a Done or Dropped one alone. */
  readonly archivedAt?: Date;
  /** Who archived it, while it is; undefined too for one archived before that was kept. */
  readonly archivedBy?: ArchivedBy;
  /** Its last Restore from the Archive, from which its Archive period counts again. */
  readonly restoredAt?: Date;
  /** Who last restored it, with `restoredAt`. */
  readonly restoredBy?: Author;
  /**
   * Set while it is paused (initiative-pause.ts), an active one alone: a mark beside its state, as
   * the Archive's is.
   */
  readonly pausedAt?: Date;
  /**
   * Its latest planning Thread, opened by Plan the Initiative; undefined until it is first planned.
   * Only this Thread may move its Tasks to Planning (start_planning).
   */
  readonly planningThreadId?: string;
  /**
   * Every planning Thread it opened, oldest first: a Thread on it is a planning Thread by being
   * here, whoever holds Plans or Shapes Initiatives now; every other one is a shaping Thread.
   */
  readonly planningThreadIds: readonly string[];
  /** Who asked for its latest planning Thread; undefined until it is first planned. */
  readonly planningStartedBy?: Author;
  /** Whether its latest planning Thread plans its Tasks in auto mode. */
  readonly planningAutoMode: boolean;
  /**
   * Whether its latest planning Thread was opened by Plan with…, where the planner waits for the
   * user's first message on how to plan it.
   */
  readonly planningWithUser: boolean;
  /**
   * The Initiative's Pipeline in each Project it was given one for (spec 2.1). While shaping, the
   * Projects a Pipeline was chosen for; from Confirm, every Project it spanned then, None included,
   * as Confirm fixed it. A Project with no entry has None: every Project starts there, and one it
   * comes to span once active is still open to a shaping Proposal, as nothing was fixed for it.
   */
  readonly pipelines: readonly InitiativePipeline[];
  /** What its branches are named by (short-name.ts); undefined while no Project has a Pipeline. */
  readonly shortName?: string;
  /**
   * The Projects The Office made the Initiative's branch in, at Confirm or as it came to span
   * them; kept after a Drop, as the branches are (spec 5.5).
   */
  readonly branches: readonly InitiativeBranch[];
}

/** The Initiative's branch in one Project, `initiative/<short name>` (initiativeBranchOf). */
export interface InitiativeBranch {
  readonly projectId: string;
  readonly madeAt: Date;
}

/**
 * The Initiative's Pipeline in one Project: a library Pipeline's id, office-wide or that Project's
 * own; undefined for None, which publishes the Project's Tasks one by one.
 */
export interface InitiativePipeline {
  readonly projectId: string;
  readonly pipelineId: string | undefined;
}

/** The Initiative's Pipeline in the Project; undefined for None. */
export function pipelineIn(
  initiative: Pick<Initiative, "pipelines">,
  projectId: string,
): string | undefined {
  return initiative.pipelines.find((entry) => entry.projectId === projectId)?.pipelineId;
}

/** Whether any Project of the Initiative has a Pipeline, so it has a Short name and branches. */
export function hasAnyPipeline(initiative: Pick<Initiative, "pipelines">): boolean {
  return initiative.pipelines.some(({ pipelineId }) => pipelineId !== undefined);
}

/**
 * Whether the Project's Pipeline, or its None, was fixed: at Confirm, or by a Proposal applied
 * since. Never while shaping.
 */
export function isPipelineFixed(initiative: Initiative, projectId: string): boolean {
  return (
    initiative.state !== "shaping" &&
    initiative.pipelines.some((entry) => entry.projectId === projectId)
  );
}

/** The Projects an Initiative spans: its Tasks', each once, in the order its Tasks come. */
export function initiativeProjectIds(tasks: readonly { readonly projectId: string }[]): string[] {
  return [...new Set(tasks.map(({ projectId }) => projectId))];
}
