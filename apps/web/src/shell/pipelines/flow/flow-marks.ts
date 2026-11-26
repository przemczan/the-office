import type { Route, RouteLimit, StageState } from "@the-office/contracts";

/**
 * How a Stage is marked on its left edge: in "Edit for this Task", a started Stage is marked locked,
 * its edge grey, with its state; in the Task's diagram, a Stage is marked with its state.
 */
export type FlowStageMarkTone = "locked" | StageState;

export interface FlowStageMark {
  readonly tone: FlowStageMarkTone;
  /** Its words, such as "Done". */
  readonly label: string;
  /** The Stage the walk is at: drawn with a ring. */
  readonly current?: boolean;
  /** How many rounds the work came to it, such as "Round 2 of ≤3"; none for a Stage run once. */
  readonly round?: string;
}

/** The marks by Stage key; a Stage with none shows no mark. */
export type FlowStageMarks = ReadonlyMap<string, FlowStageMark>;

/**
 * A Task's started Stages, which can't be changed, by key, each with why, such as "Done: started,
 * so it can't be changed": the lock's words and every control it disables says it.
 */
export type FlowLocks = ReadonlyMap<string, string>;

export const NO_LOCKS: FlowLocks = new Map();

/**
 * What a Proposal shows over the flow before it is applied: the routes it proposes, dashed, and the
 * ones it takes away, dotted, by the key of the Stage they leave. The Stages carry the routes as
 * they are now; the canvas draws these over them.
 */
export interface FlowOverlay {
  readonly proposed: ReadonlyMap<string, readonly Route[]>;
  readonly takenAway: ReadonlyMap<string, readonly Route[]>;
}

/**
 * How far a Task's walk has come, for the canvas to draw its routes by (docs/design/task-pipeline-progress.html):
 * the routes taken, with their counts, and the routes the walk left, dimmed. Without it every route
 * is drawn plain.
 */
export interface FlowProgress {
  /** Whether any run ran: before, every route is drawn as ahead. */
  readonly started: boolean;
  /** The routes followed, by the key of the Stage they leave; `to` null for End. */
  readonly taken: ReadonlyMap<string, readonly FlowTakenRoute[]>;
  /** The Stage the walk is at. */
  readonly current: string | null;
  /** The Stages that ran. */
  readonly ran: ReadonlySet<string>;
  /** The Stages the walk won't reach (Not taken or Skipped): the routes touching them are dimmed. */
  readonly quiet: ReadonlySet<string>;
}

export interface FlowTakenRoute {
  readonly to: string | null;
  readonly times: number;
  readonly limit: RouteLimit;
}
