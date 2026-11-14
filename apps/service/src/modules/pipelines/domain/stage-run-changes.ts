import { StageRunEnded, StageRunStarted } from "./stage-run-events.js";
import {
  NO_STAGE_TOKENS,
  type CarriedFailure,
  type SentBack,
  type StageOutcome,
  type StageRun,
} from "./stage-run.js";

export interface NewStageRun {
  readonly id: string;
  readonly taskId: string;
  readonly stageKey: string;
  readonly carriedFailure: CarriedFailure | undefined;
  readonly sentBack: SentBack | undefined;
  /** The Role working an Agent Stage's run; left out for another kind's. */
  readonly roleKey?: string;
}

/** The Task's next Stage run, after `earlierRuns` of them, with the event that announces it. */
export function startStageRun(
  given: NewStageRun,
  earlierRuns: number,
  startedAt: Date,
): { readonly run: StageRun; readonly event: StageRunStarted } {
  const run: StageRun = {
    ...given,
    roleKey: given.roleKey,
    number: earlierRuns + 1,
    threadId: undefined,
    session: undefined,
    engineId: undefined,
    engineName: undefined,
    model: undefined,
    headCommit: undefined,
    commandRuns: [],
    tokens: NO_STAGE_TOKENS,
    decisions: [],
    heldBy: undefined,
    published: undefined,
    waitingSince: undefined,
    gateAction: undefined,
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
    run: { ...run, outcome, endedAt, waitingSince: undefined },
    event: new StageRunEnded(run.taskId, run.id, run.stageKey, outcome.status),
  };
}
