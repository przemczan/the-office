/** How a Stage run ends (spec §2.3), with what the next Stage or the user needs from it. */
export type StageOutcome =
  | { readonly status: "done"; readonly summary: string }
  | { readonly status: "needs-decision"; readonly question: string }
  | { readonly status: "failed"; readonly error: string };

export type StageOutcomeStatus = StageOutcome["status"];

/**
 * The failure an on-failure loop went back with, which the next run of the Stage it went back to
 * carries into its Brief.
 */
export interface CarriedFailure {
  /** The key of the Stage that failed and owns the loop. */
  readonly stageKey: string;
  readonly error: string;
  /** Which time the loop goes back, from 1. */
  readonly round: number;
  /** How many times the loop may go back. */
  readonly rounds: number;
}

/**
 * One run of one of a Task's Stages. It owns that run's state, so nothing about a Stage's work
 * accretes on the Task or on the walk (research §12).
 */
export interface StageRun {
  readonly id: string;
  readonly taskId: string;
  readonly stageKey: string;
  /** Its place among the Task's Stage runs, from 1. */
  readonly number: number;
  readonly carriedFailure: CarriedFailure | undefined;
  /** Undefined while the Stage runs. */
  readonly outcome: StageOutcome | undefined;
  readonly startedAt: Date;
  readonly endedAt: Date | undefined;
}
