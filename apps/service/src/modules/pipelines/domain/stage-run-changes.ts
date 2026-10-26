import { StageRunEnded, StageRunStarted } from "./stage-run-events.js";
import type { CarriedFailure, StageOutcome, StageRun } from "./stage-run.js";

export interface NewStageRun {
  readonly id: string;
  readonly taskId: string;
  readonly stageKey: string;
  readonly carriedFailure: CarriedFailure | undefined;
}

/** The Task's next Stage run, after `earlierRuns` of them, with the event that announces it. */
export function startStageRun(
  given: NewStageRun,
  earlierRuns: number,
  startedAt: Date,
): { readonly run: StageRun; readonly event: StageRunStarted } {
  const run: StageRun = {
    ...given,
    number: earlierRuns + 1,
    threadId: undefined,
    outcome: undefined,
    startedAt,
    endedAt: undefined,
  };
  return { run, event: new StageRunStarted(run.taskId, run.id, run.stageKey) };
}

/** A run that has already ended is a fault of the caller: each run ends once. */
export function endStageRun(
  run: StageRun,
  outcome: StageOutcome,
  endedAt: Date,
): { readonly run: StageRun; readonly event: StageRunEnded } {
  if (run.outcome) throw new Error(`Stage run ${run.id} has already ended ${run.outcome.status}.`);
  return {
    run: { ...run, outcome, endedAt },
    event: new StageRunEnded(run.taskId, run.id, run.stageKey, outcome.status),
  };
}
