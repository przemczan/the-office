import type { Stage } from "./stage.js";
import type {
  BudgetReached,
  CarriedFailure,
  StageDecisionKind,
  StageRun,
  StageRunDecision,
  WalkAnswer,
} from "./stage-run.js";

/** What the walk stops to ask the user, before The Office words it as a Decision. */
export type WalkQuestion =
  /** The run's Agent asked it, in its needs-decision outcome. */
  | { readonly kind: "agent" }
  /** The Stage failed with no retries left: it has no loop, or its loop used up its rounds. */
  | { readonly kind: "no-retries-left"; readonly stage: Stage; readonly error: string }
  /** The Task's tokens reached the Stage's budget before an engine call. */
  | { readonly kind: "budget"; readonly stage: Stage; readonly reached: BudgetReached }
  /**
   * Every Stage ended, but the Definition of Done isn't reported met; one more round would run
   * `again`, the last Agent Stage (or the last Stage when there is none).
   */
  | {
      readonly kind: "definition-of-done";
      readonly unmet: readonly string[];
      readonly again: Stage;
    };

/** What the walk over a Task's Stages does next. */
export type NextMove =
  /** Run the Stage; `carriedFailure` is set when a loop or a round the user allowed went back. */
  | {
      readonly move: "run";
      readonly stage: Stage;
      readonly carriedFailure: CarriedFailure | undefined;
    }
  /**
   * Skip the optional Stage: every statement of the Definition of Done is already reported met
   * (spec §2.3).
   */
  | { readonly move: "skip"; readonly stage: Stage }
  /** The last run is still running, or the Decision opened on it waits on the user. */
  | { readonly move: "wait"; readonly run: StageRun }
  /** Ask the user, with a Decision opened on the last run. */
  | { readonly move: "ask"; readonly run: StageRun; readonly question: WalkQuestion }
  /** Every Stage ended, with the Definition of Done reported met or the user calling it Done. */
  | { readonly move: "complete" }
  /** The user dropped the Task in a Decision. */
  | { readonly move: "drop" };

type StoppingMove = Exclude<NextMove, { move: "run" | "skip" }>;

interface WalkPosition {
  readonly index: number;
  readonly carriedFailure: CarriedFailure | undefined;
}

/** What the walk replays as it goes over the runs. */
interface Walk {
  readonly stages: readonly Stage[];
  readonly definitionOfDone: readonly string[];
  position: WalkPosition;
  /** The runs replayed so far, the current one last. */
  replayed: readonly StageRun[];
  /** Each loop's rounds gone back, by the key of the failed Stage that owns it. */
  readonly roundsUsed: Map<string, number>;
  /** Rounds the user allowed beyond each loop's own, by the same key. */
  readonly roundsAdded: Map<string, number>;
}

/** The key the Definition of Done check's own rounds count under: no Stage's key has a space. */
const DEFINITION_OF_DONE_ROUNDS = "definition of done";

/**
 * The one walk over a Task's Stages (spec §2.3): a straight list whose only control flow is "on
 * failure go back to Stage X, at most N times", with the user asked when a Stage fails with no
 * retries left and when the Definition of Done isn't reported met at the end. The position, each
 * loop's rounds and the user's answers are replayed from the Task's Stage runs, oldest first, so
 * they are kept nowhere else. A loop's rounds belong to the Stage that owns it and count over the
 * whole Task: going back again never resets them.
 */
export function nextMove(
  stages: readonly Stage[],
  runs: readonly StageRun[],
  definitionOfDone: readonly string[],
): NextMove {
  const walk: Walk = {
    stages,
    definitionOfDone,
    position: { index: 0, carriedFailure: undefined },
    replayed: [],
    roundsUsed: new Map(),
    roundsAdded: new Map(),
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
  const stage = stages[walk.position.index];
  if (!stage) return { move: "complete" };
  if (stage.optional && unmetStatements(definitionOfDone, runs).length === 0) {
    return { move: "skip", stage };
  }
  return { move: "run", stage, carriedFailure: walk.position.carriedFailure };
}

/**
 * The Definition of Done statements not reported met: those missing from the report of the last
 * Agent Stage run that ended done (spec §2.3). Script Stages report none.
 */
export function unmetStatements(
  definitionOfDone: readonly string[],
  runs: readonly StageRun[],
): string[] {
  const reports = runs.flatMap(({ outcome }) =>
    outcome?.status === "done" && outcome.definitionOfDoneMet ? [outcome.definitionOfDoneMet] : [],
  );
  const met = new Set(reports.at(-1));
  return definitionOfDone.filter((_statement, index) => !met.has(index + 1));
}

/** Moves the walk past the run; a move that stops it is returned. */
function replay(walk: Walk, run: StageRun): StoppingMove | undefined {
  const stage = stageOfRun(walk.stages, walk.position.index, run);
  const { outcome } = run;
  if (!outcome) return { move: "wait", run };
  switch (outcome.status) {
    case "done":
      return advance(walk, run);
    case "needs-decision": {
      const waiting = waitingOn(run, "agent", { kind: "agent" });
      if (waiting) return waiting;
      // Answered: the Stage runs again, with the answer in its Brief.
      walk.position = { index: walk.position.index, carriedFailure: undefined };
      return undefined;
    }
    case "failed":
      return outcome.budgetReached
        ? afterBudget(walk, run, stage, outcome.budgetReached)
        : afterFailure(walk, run, stage, outcome.error);
  }
}

function afterFailure(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  error: string,
): StoppingMove | undefined {
  const back = goBack(walk, stage, error, undefined);
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
      const guidance = answer.kind === "one-more-round" ? answer.guidance : undefined;
      const allowed = goBack(walk, stage, error, guidance);
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
      throw new Error(`Stage run ${run.id} was answered "${answer.kind}" after a failure.`);
  }
}

/**
 * The Task's tokens reached the Stage's budget, which always asks the user (spec §2.3), never a
 * loop: a raise runs the Stage again; the raise itself is replayed by `stageBudget`.
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
      walk.position = { index: walk.position.index, carriedFailure: undefined };
      return undefined;
    case "drop":
      return { move: "drop" };
    default:
      throw new Error(`Stage run ${run.id} was answered "${answer.kind}" at its budget.`);
  }
}

/**
 * Moves the walk to the next Stage. Past the last one, the Definition of Done must be reported
 * met; otherwise the user is asked on the run, and their answer replayed.
 */
function advance(walk: Walk, run: StageRun): StoppingMove | undefined {
  const index = walk.position.index + 1;
  walk.position = { index, carriedFailure: undefined };
  const last = walk.stages.at(-1);
  if (index < walk.stages.length || !last) return undefined;
  const unmet = unmetStatements(walk.definitionOfDone, walk.replayed);
  if (unmet.length === 0) return undefined;
  const again = walk.stages.findLast(({ kind }) => kind === "agent") ?? last;
  const question = { kind: "definition-of-done", unmet, again } as const;
  const waiting = waitingOn(run, "definition-of-done", question);
  if (waiting) return waiting;
  const answer = answerOf(run, "definition-of-done");
  switch (answer.kind) {
    case "mark-done":
      return { move: "complete" };
    case "drop":
      return { move: "drop" };
    case "one-more-round": {
      const round = (walk.roundsUsed.get(DEFINITION_OF_DONE_ROUNDS) ?? 0) + 1;
      walk.roundsUsed.set(DEFINITION_OF_DONE_ROUNDS, round);
      const error = `The Definition of Done isn't reported met:\n${unmet.map((statement) => `- ${statement}`).join("\n")}`;
      walk.position = {
        index: walk.stages.indexOf(again),
        carriedFailure: {
          stageKey: again.key,
          error,
          round,
          rounds: round,
          ...guidanceOf(answer.guidance),
        },
      };
      return undefined;
    }
    case "answered":
    case "more-rounds":
    case "accept-issues":
    case "raise-budget":
      throw new Error(
        `Stage run ${run.id} was answered "${answer.kind}" at the Definition of Done.`,
      );
  }
}

/** The move while the run's Decision of `kind` isn't answered: open it, or wait on it. */
function waitingOn(
  run: StageRun,
  kind: StageDecisionKind,
  question: WalkQuestion,
): StoppingMove | undefined {
  const decision = decisionOf(run, kind);
  if (!decision) return { move: "ask", run, question };
  if (!decision.answer) return { move: "wait", run };
  return undefined;
}

function answerOf(run: StageRun, kind: StageDecisionKind): WalkAnswer {
  const answer = decisionOf(run, kind)?.answer;
  if (!answer) throw new Error(`Stage run ${run.id} has no answered ${kind} Decision.`);
  return answer;
}

function decisionOf(run: StageRun, kind: StageDecisionKind): StageRunDecision | undefined {
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
  guidance: string | undefined,
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
    carriedFailure: { stageKey: failed.key, error, round, rounds, ...guidanceOf(guidance) },
  };
}

function guidanceOf(guidance: string | undefined): { readonly guidance?: string } {
  return guidance === undefined ? {} : { guidance };
}
