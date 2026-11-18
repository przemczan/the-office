import type { Route } from "@the-office/contracts";

/**
 * How a Stage of a Project Pipeline's built flow is marked on its left edge (the adopted Project
 * Pipelines design, carried onto the canvas by docs/design/pipeline-flow.html): green Inserted, blue
 * Replaced, amber Changed and Routes changed, and a removed Stage dashed and struck through, its old
 * routes dotted.
 */
export type FlowStageMarkTone = "inserted" | "replaced" | "changed" | "routes-changed" | "removed";

export interface FlowStageMark {
  readonly tone: FlowStageMarkTone;
  /** Its words, such as "Inserted after Review & fix" or "Routes changed". */
  readonly label: string;
}

/** The marks by Stage key; a Stage with none is the base Pipeline's as it is. */
export type FlowStageMarks = ReadonlyMap<string, FlowStageMark>;

/**
 * What a Proposal shows over the flow before it is applied: the routes it proposes, dashed, and the
 * ones it takes away, dotted, by the key of the Stage they leave. The Stages carry the routes as
 * they are now; the canvas draws these over them.
 */
export interface FlowOverlay {
  readonly proposed: ReadonlyMap<string, readonly Route[]>;
  readonly takenAway: ReadonlyMap<string, readonly Route[]>;
}
