import type { StandInChoiceWaiting } from "../domain/now.js";

/**
 * The Stages waiting for the user's choice of a Stand-in Engine (spec 5.4), which Pipelines works
 * out from their held runs; the composition root binds it.
 */
export abstract class StandInChoicesWaiting {
  /** Oldest first; empty while none waits. */
  abstract waiting(): Promise<readonly StandInChoiceWaiting[]>;
}
