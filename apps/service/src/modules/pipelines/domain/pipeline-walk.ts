import {
  conflictCarried,
  goesToResolve,
  isResolveStage,
  RESOLVE_KEY,
  withoutResolveStages,
  withResolveStages,
} from "./resolve-stages.js";
import { isPublishStage, type Stage } from "./stage.js";
import type {
  BudgetReached,
  CarriedFailure,
  OutOfReachStatement,
  SentBack,
  StageOutcome,
  StageRun,
  StageRunDecision,
  WalkAnswer,
  WalkDecisionKind,
} from "./stage-run.js";

/** An unmet Definition of Done statement Out of reach, in its words, with why. */
export interface UnmetOutOfReach {
  readonly statement: string;
  readonly why: string;
}

/** What the walk stops to ask the user, before The Office words it as a Decision. */
export type WalkQuestion =
  /** The Stage failed with no retries left: it has no loop, or its loop used up its rounds. */
  | { readonly kind: "no-retries-left"; readonly stage: Stage; readonly error: string }
  /** The Task's tokens reached the Stage's budget before an engine call. */
  | { readonly kind: "budget"; readonly stage: Stage; readonly reached: BudgetReached }
  /**
   * The Office restarted during the Stage `RESTARTS_ASKED_AT` times in a row: it runs again only
   * once the user says so.
   */
  | { readonly kind: "restart"; readonly stage: Stage }
  /**
   * Resolve gave up on a conflict at Publish, or left it to the user as it came back too often;
   * or, with no Agent Stage to resolve it, Publish found the Task's branch conflicts with the base.
   */
  | { readonly kind: "base-moved"; readonly stage: Stage; readonly error: string }
  | { readonly kind: "branch-moved"; readonly stage: Stage; readonly error: string }
  /** Publish shipped the work, but its after publishing line failed: escalated, never looped. */
  | { readonly kind: "after-publishing-failed"; readonly stage: Stage; readonly error: string }
  /**
   * The Definition of Done isn't reported met as the walk reaches `before`, the Publish Stage it
   * checks ahead of, or, undefined, as every Stage of a Pipeline without one ended. One more round
   * would run `again`, the last Agent Stage before it other than Resolve (or the Stage just before
   * it when there is none). `outOfReach` are those of `unmet` the reports say they can't verify,
   * which another round can't address.
   */
  | {
      readonly kind: "definition-of-done";
      readonly unmet: readonly string[];
      readonly outOfReach: readonly UnmetOutOfReach[];
      readonly again: Stage;
      readonly before: Stage | undefined;
    };

/** What the walk over a Task's Stages does next. */
export type NextMove =
  /**
   * Run the Stage; `carriedFailure` is set when a loop or a round the user allowed went back, and
   * `sentBack` when the user sent the work back to it from a Gate.
   */
  | {
      readonly move: "run";
      readonly stage: Stage;
      readonly carriedFailure: CarriedFailure | undefined;
      readonly sentBack: SentBack | undefined;
    }
  /**
   * Skip the optional Stage: every statement of the Definition of Done is already reported met
   * (spec §2.3).
   */
  | { readonly move: "skip"; readonly stage: Stage }
  /**
   * The last run is still running, the Decision opened on it waits on the user, or its Gate does.
   */
  | { readonly move: "wait"; readonly run: StageRun }
  /** Ask the user, with a Decision opened on the last run. */
  | { readonly move: "ask"; readonly run: StageRun; readonly question: WalkQuestion }
  /** Every Stage ended, with the Definition of Done reported met or the user calling it Done. */
  | { readonly move: "complete" }
  /** The user dropped the Task in a Decision or at a Gate. */
  | { readonly move: "drop" };

type StoppingMove = Exclude<NextMove, { move: "run" | "skip" }>;

interface WalkPosition {
  readonly index: number;
  readonly carriedFailure: CarriedFailure | undefined;
  readonly sentBack: SentBack | undefined;
}

/** The position at the Stage of `index`, with nothing carried to it. */
function at(index: number): WalkPosition {
  return { index, carriedFailure: undefined, sentBack: undefined };
}

/** What the walk replays as it goes over the runs. */
interface Walk {
  /** The Task's Stages, with Resolve's put in once a conflict at Publish went to it. */
  stages: readonly Stage[];
  readonly definitionOfDone: readonly string[];
  position: WalkPosition;
  /** The runs replayed so far, the current one last. */
  replayed: readonly StageRun[];
  /** Each loop's rounds gone back, by the key of the failed Stage that owns it. */
  readonly roundsUsed: Map<string, number>;
  /** Rounds the user allowed beyond each loop's own, by the same key. */
  readonly roundsAdded: Map<string, number>;
  /** Every run of the Task, oldest first, of which `replayed` is a start. */
  readonly runs: readonly StageRun[];
  /** Whether the user answered the Definition of Done check before Publish "Call it met". */
  calledMet: boolean;
}

/**
 * The restart in a row during one Stage that asks the user before it runs again, rather than going
 * on by itself, so a crash loop stops (spec §2.4).
 */
export const RESTARTS_ASKED_AT = 3;

/** The key the Definition of Done check's own rounds count under: no Stage's key has a space. */
const DEFINITION_OF_DONE_ROUNDS = "definition of done";

/**
 * The one walk over a Task's Stages (spec §2.3): a straight list whose only control flow is "on
 * failure go back to Stage X, at most N times", with the user asked when a Stage fails with no
 * retries left and when the Definition of Done isn't reported met before Publish (or at the end of
 * a Pipeline without one), and waiting at each Gate for the user, who may send the work back to an
 * earlier Stage without using a round. The position, each loop's rounds, the user's answers and Gate actions are replayed from the Task's
 * Stage runs, oldest first, so they are kept nowhere else. A loop's rounds belong to the Stage that
 * owns it and count over the whole Task: going back again never resets them.
 */
export function nextMove(
  stages: readonly Stage[],
  runs: readonly StageRun[],
  definitionOfDone: readonly string[],
): NextMove {
  const walk: Walk = {
    stages,
    definitionOfDone,
    position: at(0),
    replayed: [],
    roundsUsed: new Map(),
    roundsAdded: new Map(),
    runs,
    calledMet: false,
  };
  for (const [index, run] of runs.entries()) {
    walk.replayed = runs.slice(0, index + 1);
    const stopped = replay(walk, run);
    if (!stopped) continue;
    if (index === runs.length - 1) return stopped;
    throw new Error(
      `Stage run ${run.number} of Task ${run.taskId} stopped the walk (${stopped.move}), yet runs follow it.`,
    );
  }
  const stage = walk.stages[walk.position.index];
  if (!stage) return { move: "complete" };
  if (stage.optional && unmetStatements(definitionOfDone, runs).length === 0) {
    return { move: "skip", stage };
  }
  const { carriedFailure, sentBack } = walk.position;
  return { move: "run", stage, carriedFailure, sentBack };
}

/**
 * The numbers, from 1, of the Definition of Done statements Reported met (spec §2.3): met once any
 * Agent Stage run that ended done reported it, until a later report lists it as no longer met.
 * Script Stages report none. `runs` are the Task's, oldest first.
 */
export function reportedMet(runs: readonly StageRun[]): readonly number[] {
  return reportedMetIn(runs.map(({ outcome }) => outcome));
}

/** `reportedMet` over the outcomes of the Task's runs, oldest first. */
export function reportedMetIn(outcomes: readonly (StageOutcome | undefined)[]): readonly number[] {
  return [...definitionOfDoneReports(outcomes).met].toSorted((one, other) => one - other);
}

/**
 * The statements Out of reach, by their numbers with the latest why, counted across reports as
 * `reportedMet` is: a statement later reported met is no longer Out of reach.
 */
export function reportedOutOfReach(runs: readonly StageRun[]): readonly OutOfReachStatement[] {
  return [...definitionOfDoneReports(runs.map(({ outcome }) => outcome)).outOfReach]
    .map(([statement, why]) => ({ statement, why }))
    .toSorted((one, other) => one.statement - other.statement);
}

/** What every Agent Stage's report so far adds up to. */
interface DefinitionOfDoneReports {
  readonly met: ReadonlySet<number>;
  /** The latest why, by the statement's number; never one in `met`. */
  readonly outOfReach: ReadonlyMap<number, string>;
}

/**
 * Folds the done Agent Stage runs' reports, oldest first: each adds what it reports met, takes back
 * what it lists as no longer met, and records its Out of reach statements. Runs stored before
 * reports counted across Stages fold the same way.
 */
function definitionOfDoneReports(
  outcomes: readonly (StageOutcome | undefined)[],
): DefinitionOfDoneReports {
  const met = new Set<number>();
  const outOfReach = new Map<number, string>();
  for (const outcome of outcomes) {
    if (outcome?.status !== "done" || !outcome.definitionOfDoneMet) continue;
    for (const statement of outcome.definitionOfDoneMet) {
      met.add(statement);
      outOfReach.delete(statement);
    }
    for (const statement of outcome.definitionOfDoneNoLongerMet ?? []) met.delete(statement);
    for (const { statement, why } of outcome.definitionOfDoneOutOfReach ?? []) {
      if (!met.has(statement)) outOfReach.set(statement, why);
    }
  }
  return { met, outOfReach };
}

/** The Definition of Done statements not Reported met. */
export function unmetStatements(
  definitionOfDone: readonly string[],
  runs: readonly StageRun[],
): string[] {
  const met = new Set(reportedMet(runs));
  return definitionOfDone.filter((_statement, index) => !met.has(index + 1));
}

/** The unmet statements Out of reach, in the words of the Definition of Done, with why. */
function outOfReachStatements(
  definitionOfDone: readonly string[],
  runs: readonly StageRun[],
): UnmetOutOfReach[] {
  return reportedOutOfReach(runs).flatMap(({ statement, why }) => {
    const words = definitionOfDone[statement - 1];
    return words === undefined ? [] : [{ statement: words, why }];
  });
}

/** The unmet statements another round of `again` can address: those not Out of reach. */
export function addressableStatements(
  unmet: readonly string[],
  outOfReach: readonly UnmetOutOfReach[],
): string[] {
  const unreachable = new Set(outOfReach.map(({ statement }) => statement));
  return unmet.filter((statement) => !unreachable.has(statement));
}

/** Definition of Done statements as a list, one line each. */
export function statementList(statements: readonly string[]): string {
  return statements.map((statement) => `- ${statement}`).join("\n");
}

/**
 * The failure one more round carries: the statements it can address, the others left to the user.
 * With none to address, the user still chose the round, so it carries every unmet statement.
 */
function definitionOfDoneCarried(
  unmet: readonly string[],
  outOfReach: readonly UnmetOutOfReach[],
): string {
  const addressable = addressableStatements(unmet, outOfReach);
  const notMet = `The Definition of Done isn't reported met:\n${statementList(addressable.length > 0 ? addressable : unmet)}`;
  if (addressable.length === 0 || outOfReach.length === 0) return notMet;
  return `${notMet}\n\nThe user checks these themselves, as you reported you can't verify them where you work:\n${statementList(outOfReach.map(({ statement }) => statement))}`;
}

/** Moves the walk past the run; a move that stops it is returned. */
function replay(walk: Walk, run: StageRun): StoppingMove | undefined {
  const stage = stageOfRun(walk.stages, walk.position.index, run);
  const { outcome } = run;
  if (!outcome) return { move: "wait", run };
  switch (outcome.status) {
    case "done":
      return stage.kind === "gate" ? afterGate(walk, run) : advance(walk, run);
    case "needs-decision":
      if (waitsOnItsAgent(run)) return { move: "wait", run };
      // Answered: the Stage runs again, with the answer in its Brief.
      walk.position = at(walk.position.index);
      return undefined;
    case "failed":
      // A held run keeps the Decision its Agent opened: nothing runs until the user answers it.
      if (outcome.interrupted && waitsOnItsAgent(run)) return { move: "wait", run };
      if (outcome.interrupted === "restart") return afterRestart(walk, run, stage);
      // Held by the user: the walk stays at the Stage, with the failure it carried, using no round.
      if (outcome.interrupted) return undefined;
      if (outcome.branchMoved) return afterBranchMoved(walk, run, stage, outcome.error);
      if (outcome.baseMoved) return afterBaseMoved(walk, run, stage, outcome.error);
      if (outcome.afterPublishingFailed) {
        return afterPublishingFailed(run, stage, outcome.error);
      }
      if (outcome.budgetReached) return afterBudget(walk, run, stage, outcome.budgetReached);
      return stage.key === RESOLVE_KEY
        ? afterResolveGaveUp(walk, run, stage, outcome.error)
        : afterFailure(walk, run, stage, outcome.error);
  }
}

/**
 * The Task waits at the Gate until the user acts: Continue moves on, Drop drops the Task, and Send
 * back goes to the earlier Stage they chose with their feedback, using no round (spec §2.3).
 */
function afterGate(walk: Walk, run: StageRun): StoppingMove | undefined {
  const action = run.gateAction;
  if (!action) return { move: "wait", run };
  switch (action.kind) {
    case "continue":
      return advance(walk, run);
    case "drop":
      return { move: "drop" };
    case "send-back": {
      const index = walk.stages.findIndex(({ key }) => key === action.stageKey);
      // The Gate refuses a Stage that isn't earlier (gateActionProblems), so this is a fault.
      if (index < 0 || index >= walk.position.index) {
        throw new Error(
          `Gate "${run.stageKey}" sent the work back to "${action.stageKey}", which isn't earlier.`,
        );
      }
      walk.position = {
        index,
        carriedFailure: undefined,
        sentBack: { gateKey: run.stageKey, feedback: action.feedback },
      };
      return undefined;
    }
  }
}

function afterFailure(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  error: string,
): StoppingMove | undefined {
  const back = goBack(walk, stage, error, {});
  if (back) {
    walk.position = back;
    return undefined;
  }
  const question = { kind: "no-retries-left", stage, error } as const;
  const waiting = waitingOn(run, "no-retries-left", question);
  if (waiting) return waiting;
  const answer = answerOf(run, "no-retries-left");
  switch (answer.kind) {
    case "more-rounds":
    case "one-more-round": {
      const rounds = answer.kind === "more-rounds" ? answer.rounds : 1;
      walk.roundsAdded.set(stage.key, (walk.roundsAdded.get(stage.key) ?? 0) + rounds);
      const guided = answer.kind === "one-more-round" ? guidanceOf(answer) : {};
      const allowed = goBack(walk, stage, error, guided);
      if (!allowed) throw new Error(`Stage "${stage.key}" got more rounds, yet can't go back.`);
      walk.position = allowed;
      return undefined;
    }
    case "accept-issues":
      return advance(walk, run);
    case "drop":
      return { move: "drop" };
    case "answered":
    case "mark-done":
    case "raise-budget":
    case "resolved-in-worktree":
    case "keep-branch":
      throw new Error(`Stage run ${run.id} was answered "${answer.kind}" after a failure.`);
  }
}

/**
 * The Task's tokens reached the Stage's budget, which always asks the user (spec §2.3), never a
 * loop: a raise runs the Stage again as it was briefed; the raise itself is replayed by
 * `stageBudget`.
 */
function afterBudget(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  reached: BudgetReached,
): StoppingMove | undefined {
  const waiting = waitingOn(run, "budget", { kind: "budget", stage, reached });
  if (waiting) return waiting;
  const answer = answerOf(run, "budget");
  switch (answer.kind) {
    case "raise-budget":
      // The Stage stays where it is with what it carried: the user's feedback or the failure.
      return undefined;
    case "drop":
      return { move: "drop" };
    default:
      throw new Error(`Stage run ${run.id} was answered "${answer.kind}" at its budget.`);
  }
}

/**
 * The Office restarted during the run (spec §2.4): the walk stays at the Stage as for a run the user
 * held, with the failure it carried and using no round, so the Stage goes on by itself. The
 * `RESTARTS_ASKED_AT`th restart in a row during the Stage asks the user instead, against a crash
 * loop: run again, and it goes on the same way.
 */
function afterRestart(walk: Walk, run: StageRun, stage: Stage): StoppingMove | undefined {
  // A run asked about keeps its Decision, as do those asked about before restarts went on.
  if (!decisionOf(run, "restart") && restartsInARow(walk.replayed) < RESTARTS_ASKED_AT) {
    return undefined;
  }
  const waiting = waitingOn(run, "restart", { kind: "restart", stage });
  if (waiting) return waiting;
  const answer = answerOf(run, "restart");
  switch (answer.kind) {
    case "one-more-round":
      return undefined;
    case "drop":
      return { move: "drop" };
    default:
      throw new Error(`Stage run ${run.id} was answered "${answer.kind}" after a restart.`);
  }
}

/**
 * The restarts in a row the replayed runs end with, the last one's included: every run since the
 * Stage last got past a restart (a run ending any other way) or the user answered one.
 */
function restartsInARow(replayed: readonly StageRun[]): number {
  let restarts = 0;
  for (const run of replayed.toReversed()) {
    const { outcome } = run;
    if (outcome?.status !== "failed" || outcome.interrupted !== "restart") break;
    if (restarts > 0 && decisionOf(run, "restart")?.answer) break;
    restarts += 1;
  }
  return restarts;
}

/**
 * Publish found the Task's branch conflicts with the base (spec §2.3, "Conflicts at Publish"):
 * Resolve, the Project's Test and any Gate the Publish asks for are put before it the first time,
 * and the walk goes to Resolve, again each time the conflict comes back, until Resolve leaves it to
 * the user.
 * With no Agent Stage to resolve it, or for a run asked about before The Office resolved
 * conflicts, the user is asked on the run: run again stays at the Stage using no round;
 * continuing records the failure as an accepted issue.
 */
function afterBaseMoved(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  error: string,
): StoppingMove | undefined {
  if (goesToResolve(run)) {
    const stages = withResolveStages(walk.stages, walk.position.index);
    const index = stages.findIndex(({ key }) => key === RESOLVE_KEY);
    if (index >= 0) {
      walk.stages = stages;
      const conflicts = walk.replayed.filter(goesToResolve).length;
      walk.position = {
        index,
        carriedFailure: conflictCarried(stage, error, conflicts),
        sentBack: undefined,
      };
      return undefined;
    }
  }
  const waiting = waitingOn(run, "base-moved", { kind: "base-moved", stage, error });
  if (waiting) return waiting;
  const answer = answerOf(run, "base-moved");
  switch (answer.kind) {
    case "one-more-round":
      return undefined;
    case "accept-issues":
      return advance(walk, run);
    case "drop":
      return { move: "drop" };
    default:
      throw new Error(`Stage run ${run.id} was answered "${answer.kind}" after the base moved.`);
  }
}

/**
 * Publish shipped the work, but its after publishing line failed (spec §2.3 Loops): the user is
 * asked straight away, through a Consultant first, using no round, as going back can't unship it.
 * Retry and Continue both stay at the Publish Stage: its next run finds the publication kept and
 * runs only the after line, or, after Continue, ends done with the failure noted.
 */
function afterPublishingFailed(
  run: StageRun,
  stage: Stage,
  error: string,
): StoppingMove | undefined {
  const question = { kind: "after-publishing-failed", stage, error } as const;
  const waiting = waitingOn(run, "after-publishing-failed", question);
  if (waiting) return waiting;
  const answer = answerOf(run, "after-publishing-failed");
  switch (answer.kind) {
    case "one-more-round":
    case "accept-issues":
      return undefined;
    default:
      throw new Error(
        `Stage run ${run.id} was answered "${answer.kind}" after its after publishing line failed.`,
      );
  }
}

/**
 * The branch moved somewhere The Office can't take as it is, so the Stage didn't start: the user
 * is asked directly, and whatever they answer uses no round (spec §2.3). The walk stays at the
 * Stage with the failure it carried, unless words of their own guide it.
 */
function afterBranchMoved(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  error: string,
): StoppingMove | undefined {
  const waiting = waitingOn(run, "branch-moved", { kind: "branch-moved", stage, error });
  if (waiting) return waiting;
  const answer = answerOf(run, "branch-moved");
  switch (answer.kind) {
    case "keep-branch":
      if (answer.guidance !== undefined) {
        const { guidance } = answer;
        walk.position = {
          index: walk.position.index,
          carriedFailure: { stageKey: stage.key, error, round: 1, rounds: 1, guidance },
          sentBack: undefined,
        };
      }
      return undefined;
    case "one-more-round":
      return undefined;
    case "drop":
      return { move: "drop" };
    default:
      throw new Error(`Stage run ${run.id} was answered "${answer.kind}" after the branch moved.`);
  }
}

/**
 * Resolve gave up, or left a conflict that came back too often to the user, who is asked directly,
 * not a Consultant first (spec §2.3): once they resolved it in the worktree Resolve runs again to
 * commit it, words of their own guide one more round of Resolve, or they drop the Task.
 */
function afterResolveGaveUp(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  error: string,
): StoppingMove | undefined {
  const waiting = waitingOn(run, "base-moved", { kind: "base-moved", stage, error });
  if (waiting) return waiting;
  const answer = answerOf(run, "base-moved");
  switch (answer.kind) {
    case "resolved-in-worktree":
      walk.position = at(walk.position.index);
      return undefined;
    case "one-more-round":
      walk.position = {
        index: walk.position.index,
        carriedFailure: { stageKey: stage.key, error, round: 1, rounds: 1, ...guidanceOf(answer) },
        sentBack: undefined,
      };
      return undefined;
    case "drop":
      return { move: "drop" };
    default:
      throw new Error(`Stage run ${run.id} was answered "${answer.kind}" after Resolve gave up.`);
  }
}

/**
 * Moves the walk to the next Stage. Before it enters a Publish Stage, or past the last Stage of a
 * Pipeline that checks none, the Definition of Done must be reported met (spec §2.3), so an unmet
 * statement is asked about before anything is pushed or merged.
 */
function advance(walk: Walk, run: StageRun): StoppingMove | undefined {
  const index = walk.position.index + 1;
  walk.position = at(index);
  // A Decision recorded where the walk checked before (on a Publish run, past the last Stage) is
  // replayed where it is, whatever the check would find now.
  if (decisionOf(run, "definition-of-done")) return checkDefinitionOfDone(walk, run);
  const next = walk.stages[index];
  if (next) {
    // Resolve's Stages go back to a Publish the check already let through.
    if (!isPublishStage(next) || walk.calledMet || isResolveStage({ key: run.stageKey })) {
      return undefined;
    }
    // Runs that went on past a Publish unchecked ran before the check moved there.
    if (run !== walk.runs.at(-1)) return undefined;
    return checkDefinitionOfDone(walk, run);
  }
  if (checksBeforePublish(walk.stages)) return undefined;
  return checkDefinitionOfDone(walk, run);
}

/**
 * Whether the walk checks the Definition of Done before a Publish Stage rather than at the end: a
 * Publish first in the Pipeline has no Stage before it to check after, so it is checked at the end.
 * Resolve's Stages, which The Office puts before a Publish that conflicted, don't count.
 */
function checksBeforePublish(stages: readonly Stage[]): boolean {
  return withoutResolveStages(stages).some((stage, index) => index > 0 && isPublishStage(stage));
}

/**
 * The Definition of Done check at the walk's position, a Publish Stage or past the last Stage: with
 * every statement reported met it goes on; otherwise the user is asked on the run, and their answer
 * replayed.
 */
function checkDefinitionOfDone(walk: Walk, run: StageRun): StoppingMove | undefined {
  const { index } = walk.position;
  const before = walk.stages[index];
  const unmet = unmetStatements(walk.definitionOfDone, walk.replayed);
  // A Decision already on the run, open or answered, is kept even when nothing is unmet now.
  if (unmet.length === 0 && !decisionOf(run, "definition-of-done")) return undefined;
  const again = againStage(walk.stages, index);
  const outOfReach = outOfReachStatements(walk.definitionOfDone, walk.replayed);
  const question = { kind: "definition-of-done", unmet, outOfReach, again, before } as const;
  const waiting = waitingOn(run, "definition-of-done", question);
  if (waiting) return waiting;
  const answer = answerOf(run, "definition-of-done");
  switch (answer.kind) {
    case "mark-done":
      if (before) {
        walk.calledMet = true;
        return undefined;
      }
      return { move: "complete" };
    case "drop":
      return { move: "drop" };
    case "one-more-round": {
      const round = (walk.roundsUsed.get(DEFINITION_OF_DONE_ROUNDS) ?? 0) + 1;
      walk.roundsUsed.set(DEFINITION_OF_DONE_ROUNDS, round);
      // A round answered before reports counted across Stages may find nothing unmet now.
      const carried = unmet.length > 0 ? unmet : walk.definitionOfDone;
      const error = definitionOfDoneCarried(carried, outOfReach);
      walk.position = {
        index: walk.stages.indexOf(again),
        carriedFailure: {
          stageKey: again.key,
          error,
          round,
          rounds: round,
          ...guidanceOf(answer),
        },
        sentBack: undefined,
      };
      return undefined;
    }
    case "answered":
    case "more-rounds":
    case "accept-issues":
    case "raise-budget":
    case "resolved-in-worktree":
    case "keep-branch":
      throw new Error(
        `Stage run ${run.id} was answered "${answer.kind}" at the Definition of Done.`,
      );
  }
}

/**
 * The Stage one more round of the Definition of Done check runs: the last Agent Stage before the
 * Stage at `index`, never Resolve, or the Stage just before it when there is none.
 */
function againStage(stages: readonly Stage[], index: number): Stage {
  const earlier = stages.slice(0, index);
  const again =
    earlier.findLast((stage) => stage.kind === "agent" && stage.key !== RESOLVE_KEY) ??
    earlier.at(-1);
  if (!again) throw new Error("The Definition of Done was checked before any Stage ran.");
  return again;
}

/**
 * Whether the Decision the run's Agent opened with an Office tool waits on the user. A
 * needs-decision run always keeps one, as its runner does.
 */
function waitsOnItsAgent(run: StageRun): boolean {
  const asked = run.decisions.find(({ kind }) => kind === "agent");
  if (!asked && run.outcome?.status === "needs-decision") {
    throw new Error(`Stage run ${run.id} needs a Decision its Agent didn't keep.`);
  }
  return asked !== undefined && asked.answer === undefined;
}

/** The move while the run's Decision of `kind` isn't answered: open it, or wait on it. */
function waitingOn(
  run: StageRun,
  kind: WalkDecisionKind,
  question: WalkQuestion,
): StoppingMove | undefined {
  const decision = decisionOf(run, kind);
  if (!decision) return { move: "ask", run, question };
  if (!decision.answer) return { move: "wait", run };
  return undefined;
}

function answerOf(run: StageRun, kind: WalkDecisionKind): WalkAnswer {
  const answer = decisionOf(run, kind)?.answer;
  if (!answer) throw new Error(`Stage run ${run.id} has no answered ${kind} Decision.`);
  return answer;
}

function decisionOf(run: StageRun, kind: WalkDecisionKind): StageRunDecision | undefined {
  return run.decisions.find((decision) => decision.kind === kind);
}

/** The Stage the walk stands at, which the run must be of. */
function stageOfRun(stages: readonly Stage[], index: number, run: StageRun): Stage {
  const stage = stages[index];
  if (stage?.key !== run.stageKey) {
    const expected = stage ? `"${stage.key}"` : "none, as they have all ended";
    throw new Error(
      `Stage run ${run.number} of Task ${run.taskId} ran "${run.stageKey}"; its Stages expected ${expected}.`,
    );
  }
  return stage;
}

/**
 * Where the failed Stage goes back to, or undefined when it has no retries left. Its loop goes
 * back to an earlier Stage; rounds the user allowed a Stage without a loop run it again.
 */
function goBack(
  walk: Walk,
  failed: Stage,
  error: string,
  guided: Guided,
): (WalkPosition & { readonly carriedFailure: CarriedFailure }) | undefined {
  const onFailure = failed.kind === "gate" ? undefined : failed.onFailure;
  const rounds = (onFailure?.rounds ?? 0) + (walk.roundsAdded.get(failed.key) ?? 0);
  const round = (walk.roundsUsed.get(failed.key) ?? 0) + 1;
  if (round > rounds) return undefined;
  const failedIndex = walk.stages.indexOf(failed);
  const index = onFailure
    ? walk.stages.findIndex(({ key }) => key === onFailure.goBackTo)
    : failedIndex;
  // The library refuses a loop to a Stage that isn't earlier (stageProblems), so this is a fault.
  if (onFailure && (index < 0 || index >= failedIndex)) {
    throw new Error(
      `Stage "${failed.key}" goes back to "${onFailure.goBackTo}", which isn't earlier.`,
    );
  }
  walk.roundsUsed.set(failed.key, round);
  return {
    index,
    carriedFailure: { stageKey: failed.key, error, round, rounds, ...guided },
    sentBack: undefined,
  };
}

/**
 * What to do differently in a round, and whose words they are, as its carried failure keeps them.
 */
type Guided = Pick<CarriedFailure, "guidance" | "guidedBy">;

type OneMoreRound = Extract<WalkAnswer, { readonly kind: "one-more-round" }>;

function guidanceOf({ guidance, guidedBy }: OneMoreRound): Guided {
  return {
    ...(guidance !== undefined && { guidance }),
    ...(guidance !== undefined && guidedBy !== undefined && { guidedBy }),
  };
}
