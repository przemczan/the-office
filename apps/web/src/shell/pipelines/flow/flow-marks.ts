import type { Route } from "@the-office/contracts";

/**
 * How a Stage of a Project Pipeline's built flow is marked on its left edge (the adopted Project
 * Pipelines design, carried onto the canvas by docs/design/pipeline-flow.html): green Inserted, blue
 * Replaced, amber Changed and Routes changed, and a removed Stage dashed and struck through, its old
 * routes dotted. In "Edit for this Task", a started Stage is marked locked with its state.
 */
export type FlowStageMarkTone =
  "inserted" | "replaced" | "changed" | "routes-changed" | "removed" | "locked";

export interface FlowStageMark {
  readonly tone: FlowStageMarkTone;
  /** Its words, such as "Inserted after Review & fix", "Routes changed" or "Done". */
  readonly label: string;
}

/** The marks by Stage key; a Stage with none is the base Pipeline's as it is. */
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
