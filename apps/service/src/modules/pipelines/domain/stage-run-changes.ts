import { engineSwitchWords } from "./stage-history-words.js";
import { StageRunEngineSwitched, StageRunEnded, StageRunStarted } from "./stage-run-events.js";
import {
  NO_STAGE_TOKENS,
  type AskedInterruption,
  type CarriedFailure,
  type EngineSwitch,
  type SentBack,
  type StageInterruption,
  type StageOutcome,
  type StageRun,
  type StageRunStandIn,
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
    standInFor: undefined,
    engineSwitches: [],
    headCommit: undefined,
    changedFiles: undefined,
    commandRuns: [],
    tokens: NO_STAGE_TOKENS,
    context: undefined,
    decisions: [],
    heldBy: undefined,
    heldByUser: undefined,
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
    run: { ...run, ...heldAtTheEnd(run, outcome), outcome, endedAt, waitingSince: undefined },
    event: new StageRunEnded(run.taskId, run.id, run.stageKey, outcome.status),
  };
}

/**
 * What an interrupted run honoured as it ended, kept with its end unless it records what was asked
 * already: the walk records a Pause or a Stop as it is asked, yet a run a Stop interrupts at once
 * can end before that record is saved.
 */
function heldAtTheEnd(
  run: StageRun,
  outcome: StageOutcome,
): Pick<StageRun, "heldBy" | "heldByUser"> {
  if (run.heldBy || outcome.status !== "failed" || !isAsked(outcome.interrupted)) {
    return { heldBy: run.heldBy, heldByUser: run.heldByUser };
  }
  return { heldBy: outcome.interrupted, heldByUser: outcome.heldByUser };
}

/** Whether something was asked of the run, rather than The Office restarting under it. */
function isAsked(interruption: StageInterruption | undefined): interruption is AskedInterruption {
  return interruption !== undefined && interruption !== "restart";
}

/** An engine as a run records it: its id and its name at the time. */
export interface NamedEngine {
  readonly engineId: string;
  readonly engineName: string;
}

/**
 * The run's session went on on the Stand-in Engine `to`, as `from` refused its turn for a used-up
 * window (spec 5.4): the switch the run appends, what the run's engine now stands in for (the
 * cascade's engine, `cascade`, why given as the switch's words), and the event that announces it.
 */
export function engineSwitched(
  run: Pick<StageRun, "id" | "taskId" | "stageKey">,
  {
    from,
    to,
    cascade,
    windowWords,
    resetsAt,
  }: {
    readonly from: NamedEngine;
    readonly to: NamedEngine;
    readonly cascade: NamedEngine;
    readonly windowWords: string;
    readonly resetsAt: Date;
  },
  at: Date,
): {
  readonly engineSwitch: EngineSwitch;
  readonly standInFor: StageRunStandIn;
  readonly event: StageRunEngineSwitched;
} {
  const engineSwitch: EngineSwitch = {
    fromEngineId: from.engineId,
    fromEngineName: from.engineName,
    toEngineId: to.engineId,
    toEngineName: to.engineName,
    windowWords,
    resetsAt: resetsAt.toISOString(),
    at: at.toISOString(),
  };
  return {
    engineSwitch,
    standInFor: { ...cascade, reason: engineSwitchWords(engineSwitch) },
    event: new StageRunEngineSwitched(run.taskId, run.id, run.stageKey, from.engineId, to.engineId),
  };
}
