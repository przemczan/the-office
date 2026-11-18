import { recordedCommandResults } from "./condition-command-results.js";
import { carriesAFailure, weighRoutes } from "./conditions.js";
import { reportedOutOfReach, unmetStatements } from "./definition-of-done-reports.js";
import { asFlow, pipelineOrder } from "./flow.js";
import {
  conflictCarried,
  goesToResolve,
  isResolveStage,
  RESOLVE_KEY,
  withoutResolveStages,
  withResolveStages,
} from "./resolve-stages.js";
import { namedRoutes, type Route } from "./route.js";
import { isPublishStage, type Stage } from "./stage.js";
import type { ConditionCommandTest } from "./stage-command-run.js";
import type {
  BudgetReached,
  CarriedFailure,
  SentBack,
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
   * checks ahead of, or, undefined, as it follows a route to End. One more round would run
   * `again`, the last Agent Stage other than Resolve the walk ran (or the Stage it just left when
   * there is none). `outOfReach` are those of `unmet` the reports say they can't verify, which
   * another round can't address.
   */
  | {
      readonly kind: "definition-of-done";
      readonly unmet: readonly string[];
      readonly outOfReach: readonly UnmetOutOfReach[];
      readonly again: Stage;
      readonly before: Stage | undefined;
    }
  /**
   * None of `routes`, the routes out of the ended Stage the walk weighed, holds, or one of them
   * can't be weighed, as `why` says (spec §2.3, "When no route holds"). Each route carries the name
   * of the Stage it leads to.
   */
  | {
      readonly kind: "no-route-holds";
      readonly stage: Stage;
      readonly routes: readonly Route[];
      readonly why: string | undefined;
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
   * The last run is still running, the Decision opened on it waits on the user, or its Gate does.
   */
  | { readonly move: "wait"; readonly run: StageRun }
  /** Ask the user, with a Decision opened on the last run. */
  | { readonly move: "ask"; readonly run: StageRun; readonly question: WalkQuestion }
  /** The walk followed a route to End, with the Definition of Done reported met or called Done. */
  | { readonly move: "complete" }
  /** The user dropped the Task in a Decision or at a Gate. */
  | { readonly move: "drop" }
  /**
   * Run the Project command a condition of the routes out of `stage` names, for the test
   * `condition`, recording its result on `run`, the Stage's ended run, before the walk goes on
   * (spec §2.3, "The Project-command condition").
   */
  | {
      readonly move: "weigh-command";
      readonly run: StageRun;
      readonly stage: Stage;
      readonly condition: ConditionCommandTest;
    };

type StoppingMove = Exclude<NextMove, { move: "run" }>;

interface WalkPosition {
  /** The key of the Stage the walk is at; null once it followed a route to End. */
  readonly key: string | null;
  readonly carriedFailure: CarriedFailure | undefined;
  readonly sentBack: SentBack | undefined;
}

/** The position at the Stage of `key`, with nothing carried to it. */
function at(key: string | null): WalkPosition {
  return { key, carriedFailure: undefined, sentBack: undefined };
}

/** What the walk replays as it goes over the runs. */
interface Walk {
  /** The Task's Stages in the Pipeline's order, with Resolve's put in once a conflict went to it. */
  stages: readonly Stage[];
  /** The routes out of each of the Task's own Stages, by its key, as `asFlow` reads them. */
  readonly routes: ReadonlyMap<string, readonly Route[]>;
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
  /**
   * Whether the user called the Definition of Done met: answered its check before Publish "Call it
   * met", or continued at the Gate that is the check (`gateChecksDefinitionOfDone`).
   */
  calledMet: boolean;
  /**
   * Whether the walk entered a Publish Stage that isn't first in the order, where the Definition of
   * Done is checked, so End doesn't check it again.
   */
  enteredPublish: boolean;
}

/**
 * The restart in a row during one Stage that asks the user before it runs again, rather than going
 * on by itself, so a crash loop stops (spec §2.4).
 */
export const RESTARTS_ASKED_AT = 3;

/** The key the Definition of Done check's own rounds count under: no Stage's key has a space. */
const DEFINITION_OF_DONE_ROUNDS = "definition of done";

/**
 * The one walk over a Task's Stages (spec §2.3), a flow: from the first Stage, as each Stage ends
 * it follows the first of its routes whose condition holds, to a later Stage or to End, and asks
 * the user when none holds. A failing Stage goes back by its on-failure loop, at most N times, then
 * on by a route only when its condition says the Stage ended Failed, and otherwise asks the user.
 * The Definition of Done is checked as the walk enters a Publish, or at End on a path that entered
 * none, unless a Gate just before it was the check; each Gate waits for the user, who may send the
 * work back to an earlier Stage without using a round. The position, each loop's rounds, the
 * user's answers and Gate actions are replayed from the Task's Stage runs, oldest first, so they
 * are kept nowhere else; a recorded run of a Stage a route leads to is followed as it was, without
 * weighing again. A loop's rounds belong to the Stage that owns it and count over the whole Task:
 * going back again never resets them. A Project-command test's result is replayed from the run
 * the routes leave; one not recorded yet is asked for with `weigh-command`.
 */
export function nextMove(
  stages: readonly Stage[],
  runs: readonly StageRun[],
  definitionOfDone: readonly string[],
): NextMove {
  const flow = pipelineOrder(asFlow(stages));
  const given = new Map(stages.map((stage) => [stage.key, stage]));
  const walk: Walk = {
    stages: flow.flatMap(({ key }) => given.get(key) ?? []),
    routes: new Map(flow.map(({ key, routes }) => [key, routes])),
    definitionOfDone,
    position: at(flow[0]?.key ?? null),
    replayed: [],
    roundsUsed: new Map(),
    roundsAdded: new Map(),
    runs,
    calledMet: false,
    enteredPublish: false,
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
  const { key, carriedFailure, sentBack } = walk.position;
  if (key === null) return { move: "complete" };
  return { move: "run", stage: stageOf(walk, key), carriedFailure, sentBack };
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
  const stage = stageOfRun(walk, run);
  const { outcome } = run;
  if (!outcome) return { move: "wait", run };
  switch (outcome.status) {
    case "done":
      return stage.kind === "gate" ? afterGate(walk, run, stage) : advance(walk, run, stage);
    case "needs-decision":
      if (waitsOnItsAgent(run)) return { move: "wait", run };
      // Answered: the Stage runs again, with the answer in its Brief.
      walk.position = at(stage.key);
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
 * The Task waits at the Gate until the user acts: Continue follows its routes, Drop drops the Task,
 * and Send back goes to the earlier Stage they chose with their feedback, using no round (spec
 * §2.3).
 */
function afterGate(walk: Walk, run: StageRun, gate: Stage): StoppingMove | undefined {
  const action = run.gateAction;
  if (!action) return { move: "wait", run };
  const gateIndex = walk.stages.indexOf(gate);
  switch (action.kind) {
    case "continue":
      if (gateChecksDefinitionOfDone(walk.stages, gateIndex)) walk.calledMet = true;
      return advance(walk, run, gate);
    case "drop":
      return { move: "drop" };
    case "send-back": {
      const index = walk.stages.findIndex(({ key }) => key === action.stageKey);
      // The Gate refuses a Stage that isn't earlier (gateActionProblems), so this is a fault.
      if (index < 0 || index >= gateIndex) {
        throw new Error(
          `Gate "${run.stageKey}" sent the work back to "${action.stageKey}", which isn't earlier.`,
        );
      }
      walk.position = {
        key: action.stageKey,
        carriedFailure: undefined,
        sentBack: { gateKey: run.stageKey, feedback: action.feedback },
      };
      return undefined;
    }
  }
}

/**
 * A Stage failed (spec §2.3, "When a Stage fails"): its on-failure loop goes first, then a route
 * whose condition says it ended Failed, and with neither the user is asked.
 */
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
  if (decisionOf(run, "no-retries-left")) return afterNoRetriesLeft(walk, run, stage, error);
  return follow(
    walk,
    run,
    stage,
    routesOf(walk, stage),
    () => afterNoRetriesLeft(walk, run, stage, error),
    (route) => carriesAFailure(route, stage.key),
  );
}

function afterNoRetriesLeft(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  error: string,
): StoppingMove | undefined {
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
      // Every route is weighed as usual, the Stage's outcome staying Failed.
      return advance(walk, run, stage);
    case "drop":
      return { move: "drop" };
    case "answered":
    case "mark-done":
    case "raise-budget":
    case "resolved-in-worktree":
    case "keep-branch":
    case "follow-route":
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
    const stages = withResolveStages(walk.stages, walk.stages.indexOf(stage));
    if (stages.some(({ key }) => key === RESOLVE_KEY)) {
      walk.stages = stages;
      const conflicts = walk.replayed.filter(goesToResolve).length;
      walk.position = {
        key: RESOLVE_KEY,
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
      return advance(walk, run, stage);
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
          key: stage.key,
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
      walk.position = at(stage.key);
      return undefined;
    case "one-more-round":
      walk.position = {
        key: stage.key,
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

/** The Stage ended: the walk follows the first of its routes that holds, or asks the user. */
function advance(walk: Walk, run: StageRun, stage: Stage): StoppingMove | undefined {
  return follow(walk, run, stage, routesOf(walk, stage), () =>
    noRouteHolds(walk, run, stage, undefined),
  );
}

/**
 * Follows one of `routes` out of the Stage the run ended (spec §2.3, "Which route the walk
 * follows"): the route the user chose in the run's no-route-holds Decision; the route to the Stage
 * of the next recorded run, which the walk followed then, so a replay doesn't weigh again; or the
 * first route whose condition holds now. With none holding, `whenNoneHolds` decides; a route that
 * can't be weighed asks the user, and a command test whose result the run doesn't hold yet is
 * weighed first. Only the routes `followable` keeps are followed, each weighed at its place among
 * all of `routes`, so a command test's result recorded on the run stays its own.
 */
function follow(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  routes: readonly Route[],
  whenNoneHolds: () => StoppingMove | undefined,
  followable: (route: Route) => boolean = () => true,
): StoppingMove | undefined {
  const asked = decisionOf(run, "no-route-holds");
  if (asked) return afterNoRouteHolds(walk, run, asked);
  const candidates = routes.filter(followable);
  const recorded = walk.runs[walk.replayed.length];
  const followed = recorded && candidates.find(({ to }) => to === recorded.stageKey);
  if (followed) return goTo(walk, run, followed.to);
  const choice = weighRoutes(
    routes,
    {
      stageKey: stage.key,
      runs: walk.replayed,
      definitionOfDone: walk.definitionOfDone,
      commands: recordedCommandResults(run),
    },
    followable,
  );
  switch (choice.kind) {
    case "follow":
      return goTo(walk, run, choice.route.to);
    case "none-holds":
      return whenNoneHolds();
    case "cannot-be-weighed":
      return noRouteHolds(walk, run, stage, choice.why, candidates);
    case "run-command":
      return {
        move: "weigh-command",
        run,
        stage,
        condition: { ...choice.test, to: choice.route.to },
      };
  }
}

/** Asks the user where the walk goes on from the Stage, as none of its routes holds. */
function noRouteHolds(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  why: string | undefined,
  routes: readonly Route[] = routesOf(walk, stage),
): StoppingMove {
  const names = new Map(walk.stages.map(({ key, name }) => [key, name]));
  return {
    move: "ask",
    run,
    question: { kind: "no-route-holds", stage, routes: namedRoutes(routes, names), why },
  };
}

/** The user's answer to the no-route-holds Decision: the route they chose, or Drop. */
function afterNoRouteHolds(
  walk: Walk,
  run: StageRun,
  decision: StageRunDecision,
): StoppingMove | undefined {
  const { answer } = decision;
  if (!answer) return { move: "wait", run };
  switch (answer.kind) {
    case "follow-route":
      return goTo(walk, run, answer.to);
    case "drop":
      return { move: "drop" };
    default:
      throw new Error(`Stage run ${run.id} was answered "${answer.kind}" when no route held.`);
  }
}

/**
 * Moves the walk to the Stage `to`, or End (null). Before it enters a Publish Stage that isn't
 * first, or at End on a path that entered none, the Definition of Done must be reported met (spec
 * §2.3), so an unmet statement is asked about before anything is pushed or merged.
 */
function goTo(walk: Walk, run: StageRun, to: string | null): StoppingMove | undefined {
  walk.position = at(to);
  const next = to === null ? undefined : stageOf(walk, to);
  const checksHere = next ? checksBefore(walk.stages, next) : !walk.enteredPublish;
  if (next && checksHere) walk.enteredPublish = true;
  // A Decision recorded where the walk checked before (on a Publish run, at End) is replayed where
  // it is, whatever the check would find now.
  if (decisionOf(run, "definition-of-done")) return checkDefinitionOfDone(walk, run);
  if (!checksHere) return undefined;
  if (next) {
    // Resolve's Stages go back to a Publish the check already let through.
    if (walk.calledMet || isResolveStage({ key: run.stageKey })) return undefined;
    // Runs that went on past a Publish unchecked ran before the check moved there.
    if (run !== walk.runs.at(-1)) return undefined;
  }
  return checkDefinitionOfDone(walk, run);
}

/**
 * Whether the Gate at `index` is the Definition of Done check for the Publish Stage after it (spec
 * §2.3), so its Continue calls the Definition of Done met: no Agent Stage, whose report may change
 * what is met, nor a later Gate stands between them in the Pipeline's order; Script Stages may.
 * Resolve's Stages don't count.
 */
export function gateChecksDefinitionOfDone(stages: readonly Stage[], index: number): boolean {
  const gate = stages[index];
  if (gate?.kind !== "gate" || isResolveStage(gate)) return false;
  for (const stage of stages.slice(index + 1)) {
    if (isResolveStage(stage)) continue;
    if (stage.kind !== "script") return false;
    if (isPublishStage(stage)) return true;
  }
  return false;
}

/**
 * Whether the walk checks the Definition of Done before entering `stage`: a Publish Stage that
 * isn't first in the Pipeline's order, as a first one has no Stage before it to check after.
 * Resolve's Stages, which The Office puts before a Publish that conflicted, don't count.
 */
function checksBefore(stages: readonly Stage[], stage: Stage): boolean {
  return isPublishStage(stage) && withoutResolveStages(stages)[0]?.key !== stage.key;
}

/**
 * The Definition of Done check at the walk's position, a Publish Stage or End: with every statement
 * reported met it goes on; otherwise the user is asked on the run, and their answer replayed.
 */
function checkDefinitionOfDone(walk: Walk, run: StageRun): StoppingMove | undefined {
  const { key } = walk.position;
  const before = key === null ? undefined : stageOf(walk, key);
  const unmet = unmetStatements(walk.definitionOfDone, walk.replayed);
  // A Decision already on the run, open or answered, is kept even when nothing is unmet now.
  if (unmet.length === 0 && !decisionOf(run, "definition-of-done")) return undefined;
  const again = againStage(walk, run);
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
        key: again.key,
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
    case "follow-route":
      throw new Error(
        `Stage run ${run.id} was answered "${answer.kind}" at the Definition of Done.`,
      );
  }
}

/**
 * The Stage one more round of the Definition of Done check runs: the last Agent Stage the walk ran,
 * never Resolve, or the Stage the run ended when there is none.
 */
function againStage(walk: Walk, run: StageRun): Stage {
  const agentStages = new Map(
    walk.stages
      .filter((stage) => stage.kind === "agent" && stage.key !== RESOLVE_KEY)
      .map((stage) => [stage.key, stage]),
  );
  const lastAgentRun = walk.replayed.findLast(({ stageKey }) => agentStages.has(stageKey));
  return (lastAgentRun && agentStages.get(lastAgentRun.stageKey)) ?? stageOf(walk, run.stageKey);
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

/** The routes out of the Stage: a Resolve Stage carries its own, chained to its Publish. */
function routesOf(walk: Walk, stage: Stage): readonly Route[] {
  return walk.routes.get(stage.key) ?? stage.routes ?? [];
}

/** The Stage of `key`, which the walk's position or a route names. */
function stageOf(walk: Walk, key: string): Stage {
  const stage = walk.stages.find((candidate) => candidate.key === key);
  if (!stage) throw new Error(`The walk reached "${key}", which isn't among the Task's Stages.`);
  return stage;
}

/** The Stage the walk stands at, which the run must be of. */
function stageOfRun(walk: Walk, run: StageRun): Stage {
  const { key } = walk.position;
  if (key !== run.stageKey) {
    const expected = key === null ? "none, as the walk reached End" : `"${key}"`;
    throw new Error(
      `Stage run ${run.number} of Task ${run.taskId} ran "${run.stageKey}"; its Stages expected ${expected}.`,
    );
  }
  return stageOf(walk, key);
}

/**
 * Where the failed Stage goes back to, or undefined when it has no retries left. Its loop goes
 * back to an earlier Stage in the Pipeline's order; rounds the user allowed a Stage without a loop
 * run it again.
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
  const failedIndex = walk.stages.findIndex(({ key }) => key === failed.key);
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
    key: onFailure ? onFailure.goBackTo : failed.key,
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
