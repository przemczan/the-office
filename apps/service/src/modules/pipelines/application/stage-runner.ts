import type { Stage, StageKind } from "../domain/stage.js";
import type { StageOutcome, StageRun } from "../domain/stage-run.js";
import type { StageRunInterruption } from "./stage-run-interruption.js";

export type StageOfKind<Kind extends StageKind> = Extract<Stage, { readonly kind: Kind }>;

/** A run of one of a Task's Stages, as the walk hands it to the runner of its kind. */
export interface StageWork<Kind extends StageKind = StageKind> {
  readonly stage: StageOfKind<Kind>;
  /** The run, already started; its carried failure goes into the Brief. */
  readonly run: StageRun;
  /** The Task's own Stages, whose earlier results a Brief names. */
  readonly stages: readonly Stage[];
  /** The Task's runs before this one, oldest first. */
  readonly earlierRuns: readonly StageRun[];
  /**
   * The user's Stop or Pause of the run. A runner with nothing to interrupt or hold, such as a
   * Script Stage's command, ends as it would, and the walk holds the Task after it.
   */
  readonly interruption: StageRunInterruption;
}

/**
 * Does the work of one kind of Stage and says how it ended. The walk owns the run record, the
 * loops and the Task's state; a runner knows only its kind's work.
 */
export interface StageRunner<Kind extends StageKind = StageKind> {
  run(work: StageWork<Kind>): Promise<StageOutcome>;
}
