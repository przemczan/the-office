import { outranks } from "./stage-interruption.js";
import { engineSwitchWords } from "./stage-history-words.js";
import { StageRunEngineSwitched, StageRunEnded, StageRunStarted } from "./stage-run-events.js";
import {
  NO_STAGE_TOKENS,
  type AskedInterruption,
  type CarriedFailure,
  type ChosenRoute,
  type EngineSwitch,
  type GateAction,
  type HoldingUser,
  type Restarted,
  type SentBack,
  type StageInterruption,
  type StageOutcome,
  type StageRun,
  type StageRunDecision,
  type StageRunStandIn,
  type StartedOver,
  type TaskRestart,
} from "./stage-run.js";
import { walkAnswerOf, type DecisionAnswer } from "./walk-decisions.js";

/**
 * A change of a Stage run, applied to the run as stored (`StageRunRepository.update`): the run as
 * the change leaves it, with whatever else the change tells, such as the event that announces it.
 */
export interface StageRunChange {
  readonly run: StageRun;
}

export interface NewStageRun {
  readonly id: string;
  readonly taskId: string;
  readonly stageKey: string;
  readonly carriedFailure: CarriedFailure | undefined;
  readonly sentBack: SentBack | undefined;
  /** The Role working an Agent Stage's run; left out for another kind's. */
  readonly roleKey?: string;
  /** The route the held run this one resumes had chosen (spec §2.3); left out for none. */
  readonly choice?: ChosenRoute;
  /** The user's Restart from… that runs it (spec §2.4.5); left out for none. */
  readonly restarted?: Restarted;
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
    choice: given.choice,
    waitingSince: undefined,
    gateAction: undefined,
    outcome: undefined,
    startedAt,
    endedAt: undefined,
  };
  return { run, event: new StageRunStarted(run.taskId, run.id, run.stageKey) };
}

/**
 * The route the Stage's held run had chosen, which the run resuming it starts with (spec §2.3, "How
 * an Agent chooses its route"): the run before is the Stage's own, held by a Pause, the fire alarm,
 * a used-up usage window or a restart, its edits kept. A Stop discards the run's edits, and its
 * choice with them.
 */
export function heldRunChoice(
  stageKey: string,
  earlierRuns: readonly StageRun[],
): ChosenRoute | undefined {
  const last = earlierRuns.at(-1);
  if (last?.stageKey !== stageKey || last.outcome?.status !== "failed") return undefined;
  // A Restart from… discarded the held run's edits, its choice with them.
  if (last.restart) return undefined;
  const held = last.outcome.interrupted;
  return held === undefined || held === "stop" ? undefined : last.choice;
}

/**
 * The run ends with `outcome`; a run that saved no changed files, such as a Gate's, changed none.
 * A run that has already ended is a fault of the caller: each run ends once.
 */
export function endStageRun(
  run: StageRun,
  outcome: StageOutcome,
  endedAt: Date,
): { readonly run: StageRun; readonly event: StageRunEnded } {
  if (run.outcome) throw new Error(`Stage run ${run.id} has already ended ${run.outcome.status}.`);
  return {
    run: {
      ...run,
      ...heldAtTheEnd(run, outcome),
      changedFiles: run.changedFiles ?? [],
      outcome,
      endedAt,
      waitingSince: undefined,
    },
    event: new StageRunEnded(run.taskId, run.id, run.stageKey, outcome.status),
  };
}

/**
 * What the run records as held by once it ended: the stronger of what was asked of it while it ran
 * and what it honoured as it ended, with the user who asked for that one. The walk records a Pause
 * or a Stop as it is asked, yet a run a Stop interrupts at once can end before that record is
 * saved, and a Stop that comes after a Pause the run honoured already still holds it as a Stop.
 */
function heldAtTheEnd(
  run: StageRun,
  outcome: StageOutcome,
): Pick<StageRun, "heldBy" | "heldByUser"> {
  if (
    outcome.status !== "failed" ||
    !isAsked(outcome.interrupted) ||
    !outranks(outcome.interrupted, run.heldBy)
  ) {
    return { heldBy: run.heldBy, heldByUser: run.heldByUser };
  }
  return { heldBy: outcome.interrupted, heldByUser: outcome.heldByUser };
}

/**
 * Records that the user, the fire alarm or a used-up usage window asked `interruption` of the
 * running run, `heldByUser` naming the user who asked for a Pause or a Stop, so a start after a
 * crash honours it. Nothing once the run has ended, or when what was asked already asks as much.
 */
export function holdStageRun(
  run: StageRun,
  interruption: AskedInterruption,
  heldByUser: HoldingUser | undefined,
): StageRunChange | undefined {
  if (run.outcome || !outranks(interruption, run.heldBy)) return undefined;
  return { run: { ...run, heldBy: interruption, heldByUser } };
}

/** Keeps the Decision on the run, so the walk waits on its answer; nothing when it keeps it already. */
export function keepDecision(
  run: StageRun,
  decision: StageRunDecision,
): StageRunChange | undefined {
  if (run.decisions.some(({ id }) => id === decision.id)) return undefined;
  return { run: { ...run, decisions: [...run.decisions, decision] } };
}

/**
 * Keeps the given answers on the run's Decisions that are still open, as the walk replays them;
 * nothing when none of them is. One answered already is left as it is.
 */
export function keepAnswers(
  run: StageRun,
  answers: ReadonlyMap<string, DecisionAnswer>,
): StageRunChange | undefined {
  let kept = false;
  const decisions = run.decisions.map((decision) => {
    const answer = answers.get(decision.id);
    if (decision.answer || !answer) return decision;
    kept = true;
    return { ...decision, answer: walkAnswerOf(decision, answer) };
  });
  return kept ? { run: { ...run, decisions } } : undefined;
}

/** Keeps what the user did at the Gate's run; nothing once it keeps an action, as each takes one. */
export function keepGateAction(run: StageRun, gateAction: GateAction): StageRunChange | undefined {
  if (run.gateAction) return undefined;
  return { run: { ...run, gateAction } };
}

/**
 * Keeps the user's Restart from… on the held run; nothing while it hasn't ended, or once it keeps
 * one, as each held run takes one.
 */
export function keepRestart(run: StageRun, restart: TaskRestart): StageRunChange | undefined {
  if (!run.outcome || run.restart) return undefined;
  return { run: { ...run, restart } };
}

/** Keeps the Start over on the last run before it; nothing once it keeps one. */
export function keepStartedOver(
  run: StageRun,
  startedOver: StartedOver,
): StageRunChange | undefined {
  if (run.startedOver) return undefined;
  return { run: { ...run, startedOver } };
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
