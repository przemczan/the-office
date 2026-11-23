import type { Route } from "@the-office/contracts";

/**
 * How a Stage is marked on its left edge: in "Edit for this Task", a started Stage is marked locked,
 * its edge grey, with its state.
 */
export type FlowStageMarkTone = "locked";

export interface FlowStageMark {
  readonly tone: FlowStageMarkTone;
  /** Its words, such as "Done". */
  readonly label: string;
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
