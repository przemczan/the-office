import { recordedCommandResults } from "./condition-command-results.js";
import { type RouteChoice, weighRoutes } from "./conditions.js";
import { reportedOutOfReach, unmetStatements } from "./definition-of-done-reports.js";
import { conflictOnlyStages, isConflictRoute, takesPublishResult } from "./conflict-handling.js";
import { asFlow, pipelineOrder, type FlowStage } from "./flow.js";
import { publishResultOf } from "./publish-result.js";
import { RESOLVE_GATE_KEY, RESOLVE_KEY, RESOLVE_TEST_KEY } from "./publish-stages.js";
import { choiceRoutesOf, isFailureRoute, namedRoutes, type Route } from "./route.js";
import { isPublishStage, type Stage } from "./stage.js";
import type { ConditionCommandTest } from "./stage-command-run.js";
import type {
  BudgetReached,
  CarriedFailure,
  GateDropReason,
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

/**
 * How often the walk followed a route (spec §2.3, "A route's limit"), and how often it may: the
 * route's limit with the times answers allowed past it, null for No limit.
 */
export interface RouteCount {
  readonly times: number;
  readonly limit: number | null;
}

/** The route the walk left a run by, by where it leads (null: End), with its count, this time included. */
export interface FollowedRoute extends RouteCount {
  readonly to: string | null;
}

/**
 * A route out of the Stage at its limit, named, with its count: `back` when it leads to its own
 * Stage or one before it.
 */
export interface RouteAtLimit {
  readonly route: Route;
  readonly times: number;
  readonly limit: number;
  readonly back: boolean;
}

/** What the walk stops to ask the user, before The Office words it as a Decision. */
export type WalkQuestion =
  /**
   * The Stage failed with no failure route left to follow (spec §2.3, "When a Stage fails"):
   * `atLimit` is the first that held but is used up, when one did, and `others` the Stage's other
   * routes out, by where they lead, which the walk may follow instead. A failed Script Stage
   * (Publish among them) may send the work back to `sendBackTo`, the last Agent Stage the walk ran
   * outside conflict handling; undefined for an Agent Stage, or when the walk ran none.
   */
  | {
      readonly kind: "no-retries-left";
      readonly stage: Stage;
      readonly error: string;
      readonly atLimit: RouteAtLimit | undefined;
      readonly others: readonly Route[];
      readonly sendBackTo: Stage | undefined;
    }
  /**
   * The route the ended Stage's walk would follow is at its limit (spec §2.3, "When a limit runs
   * out"), with the last run's error or Handover note (`note`) and the Stage's other routes out.
   */
  | {
      readonly kind: "route-limit";
      readonly stage: Stage;
      readonly atLimit: RouteAtLimit;
      readonly others: readonly Route[];
      readonly note: string | undefined;
    }
  /** The Task's tokens reached the Stage's budget before an engine call. */
  | { readonly kind: "budget"; readonly stage: Stage; readonly reached: BudgetReached }
  /**
   * The Office restarted during the Stage `RESTARTS_ASKED_AT` times in a row: it runs again only
   * once the user says so.
   */
  | { readonly kind: "restart"; readonly stage: Stage }
  /**
   * A Publish Stage ended Conflict and none of its routes takes it, or a Stage of conflict handling
   * failed with no failure route (spec §2.3.4, "Conflicts in the flow"): the user is asked directly.
   */
  | { readonly kind: "base-moved"; readonly stage: Stage; readonly error: string }
  | { readonly kind: "branch-moved"; readonly stage: Stage; readonly error: string }
  /** Publish shipped the work, but its after publishing line failed, and none of its routes takes it. */
  | { readonly kind: "after-publishing-failed"; readonly stage: Stage; readonly error: string }
  /**
   * The Definition of Done isn't reported met as the walk reaches `before`, the Publish Stage it
   * checks ahead of, or, undefined, as it follows a route to End. One more round would run
   * `again`, the last Agent Stage the walk ran outside conflict handling (or the Stage it just left
   * when there is none). `outOfReach` are those of `unmet` the reports say they can't verify, which
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
   * of the Stage it leads to. `choseNone` is set when the Stage is an Agent Stage with choice rows
   * that ended done with no choice made (spec §2.3, "How an Agent chooses its route").
   */
  | {
      readonly kind: "no-route-holds";
      readonly stage: Stage;
      readonly routes: readonly Route[];
      readonly why: string | undefined;
      readonly choseNone?: true;
    };

/** What the walk over a Task's Stages does next. */
export type NextMove =
  /**
   * Run the Stage; `carriedFailure` is set when a failure route or a round the user allowed led
   * there with a failure, and
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
  /** The user dropped the Task in a Decision or at a Gate, with the reason given at a Gate, if any. */
  | { readonly move: "drop"; readonly reason?: GateDropReason }
  /**
   * Run the Project command a condition of the routes out of `stage` names, for the test
   * `condition`, recording its result on `run`, the Stage's ended run, before the walk goes on
   * (spec §2.3, "The Project-command condition"). `route` is the count of the route weighed, the
   * times the walk followed it before.
   */
  | {
      readonly move: "weigh-command";
      readonly run: StageRun;
      readonly stage: Stage;
      readonly condition: ConditionCommandTest;
      readonly route: RouteCount;
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
  /** The Task's Stages as `asFlow` reads them, in the Pipeline's order. */
  readonly stages: readonly FlowStage[];
  /**
   * Each Stage as the moves and questions carry it, by its key: as given, unless `asFlow` drew it in
   * or read it as another kind (a kept Script `publish` Stage as a Publish Stage).
   */
  readonly shown: ReadonlyMap<string, Stage>;
  /** The keys of the conflict chain's Stages (`conflictOnlyStages`). */
  readonly chain: ReadonlySet<string>;
  /**
   * The first Stage in the Pipeline's order that isn't of the conflict chain (`conflictOnlyStages`):
   * the walk starts there, and the Definition of Done isn't checked before it.
   */
  readonly firstKey: string | undefined;
  readonly definitionOfDone: readonly string[];
  position: WalkPosition;
  /** The runs replayed so far, the current one last. */
  replayed: readonly StageRun[];
  /** The times the walk followed each route, by `routeId`. */
  readonly followed: Map<string, number>;
  /** The times answers allowed each route past its limit, by `routeId`. */
  readonly allowedPast: Map<string, number>;
  /**
   * The times answers ran each Stage that failed with no failure route again itself, by its key.
   */
  readonly ranAgain: Map<string, number>;
  /** The rounds the Definition of Done check's answers ran, which no route counts. */
  definitionOfDoneRounds: number;
  /** The route the walk left each run by, by the run's id. */
  readonly left: Map<string, FollowedRoute>;
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
  /**
   * Whether the walk is in conflict handling (spec §2.3.4, "Conflicts in the flow"): it followed a
   * Publish Stage's Conflict route and hasn't entered a Publish Stage, nor run a Stage outside the
   * conflict chain (one an answer or a Gate sent the work back to), since.
   */
  conflictHandling: boolean;
  /** The ids of the runs of conflict handling's Stages. */
  readonly conflictRuns: Set<string>;
}

/**
 * The restart in a row during one Stage that asks the user before it runs again, rather than going
 * on by itself, so a crash loop stops (spec §2.4).
 */
export const RESTARTS_ASKED_AT = 3;

/**
 * The one walk over a Task's Stages (spec §2.3), a flow: from the first Stage, as each Stage ends
 * it follows the first of its routes whose condition holds, to any Stage or to End, and asks the
 * user when none holds, or when that route is at its limit, never passing over it. A failing Stage
 * follows the first of its failure routes that holds and still has times left, passing over a used
 * up one to the next, and otherwise asks. The Definition of Done is checked as the walk enters a
 * Publish, or at End on a path that entered none, unless a Gate just before it was the check; each
 * Gate waits for the user, who may send the work back to an earlier Stage without using a route's
 * times. The position, each route's count, the user's answers and Gate actions are replayed from
 * the Task's Stage runs, oldest first, so they are kept nowhere else; a recorded run of a Stage a
 * route leads to is followed as it was, without weighing again. A route's count is per walk, over
 * the whole Task: going back again never resets it. A Project-command test's result is replayed
 * from the run the routes leave; one not recorded yet is asked for with `weigh-command`.
 */
export function nextMove(
  stages: readonly Stage[],
  runs: readonly StageRun[],
  definitionOfDone: readonly string[],
): NextMove {
  return replayAll(walkOver(stages, runs, definitionOfDone));
}

/**
 * The route the walk left each run by, by the run's id, with its count then (spec §2.3, "Which
 * route the walk follows"): only a run the next run followed by it, as the latest run's routes are
 * weighed with the Definition of Done, which only the walk itself reads. A history the walk can't
 * replay keeps the routes it followed up to there.
 */
export function routesFollowed(
  stages: readonly Stage[],
  runs: readonly StageRun[],
): ReadonlyMap<string, FollowedRoute> {
  const walk = walkOver(stages, runs, []);
  try {
    replayAll(walk);
  } catch {
    // The Task's page and its history still show the runs; the walk itself reports the fault.
  }
  const next = new Map(walk.runs.map((run, index) => [run.id, walk.runs[index + 1]?.stageKey]));
  return new Map([...walk.left].filter(([runId, { to }]) => to !== null && next.get(runId) === to));
}

/**
 * How often the walk over `runs` followed each of `routes` out of the Stage keyed `fromKey`, and how
 * often it may (spec §2.3, "A route's limit"), as the walk itself counts them. A history the walk
 * can't replay counts the routes it followed up to there.
 */
export function routeCounts(
  stages: readonly Stage[],
  runs: readonly StageRun[],
  fromKey: string,
  routes: readonly Route[],
): RouteCount[] {
  const walk = walkOver(stages, runs, []);
  try {
    replayAll(walk);
  } catch {
    // The walk itself reports the fault, as with `routesFollowed`.
  }
  return routes.map((route) => countOf(walk, fromKey, route));
}

function walkOver(
  stages: readonly Stage[],
  runs: readonly StageRun[],
  definitionOfDone: readonly string[],
): Walk {
  const flow = pipelineOrder(asFlow(stages));
  const chain = conflictOnlyStages(flow);
  // A chain drawn before a Publish that is first stands before it: the walk starts after it.
  const firstKey = flow.find(({ key }) => !chain.has(key))?.key;
  const given = new Map(stages.map((stage) => [stage.key, stage]));
  const shownStage = (stage: FlowStage): Stage => {
    const asGiven = given.get(stage.key);
    return asGiven?.kind === stage.kind ? asGiven : stage;
  };
  return {
    stages: flow,
    shown: new Map(flow.map((stage) => [stage.key, shownStage(stage)])),
    chain,
    firstKey,
    definitionOfDone,
    position: at(firstKey ?? null),
    replayed: [],
    followed: new Map(),
    allowedPast: new Map(),
    ranAgain: new Map(),
    definitionOfDoneRounds: 0,
    left: new Map(),
    runs: withOlderChainRunsMoved(flow, runs),
    calledMet: false,
    enteredPublish: false,
    conflictHandling: false,
    conflictRuns: new Set(),
  };
}

/** The keys of the conflict chain's Stages the conversion draws in, before any `-2`, `-3`… */
const DRAWN_CHAIN_KEYS: ReadonlySet<string> = new Set([
  RESOLVE_KEY,
  RESOLVE_TEST_KEY,
  RESOLVE_GATE_KEY,
]);

/** The drawn chain key `key` is one of, its `-2`, `-3`… left out; undefined for any other. */
function drawnChainKeyOf(key: string): string | undefined {
  const unnumbered = key.replace(/-\d+$/, "");
  return DRAWN_CHAIN_KEYS.has(unnumbered) ? unnumbered : undefined;
}

/**
 * `runs` with an older Task's runs of the conflict chain moved onto the chain of the Publish they
 * came from (spec §2.3.5): the releases before put `office:resolve…` before whichever Publish
 * went to Resolve first, while `withPublishStages` gives those keys to the first Publish in the
 * Pipeline and `-2`, `-3`… to the others. Only the runs before any run of that Publish's own keys
 * move, as this release records those.
 */
function withOlderChainRunsMoved(
  flow: readonly FlowStage[],
  runs: readonly StageRun[],
): readonly StageRun[] {
  const byKey = new Map(flow.map((stage) => [stage.key, stage]));
  // A conflict asked about before The Office resolved conflicts went to no Resolve.
  const conflicted = runs.find(
    (run) =>
      isPublishStage(byKey.get(run.stageKey)) &&
      publishResultOf(run) === "conflict" &&
      !decisionOf(run, "base-moved"),
  );
  const publish = conflicted && byKey.get(conflicted.stageKey);
  if (!publish) return runs;
  // The Publish's own drawn chain, from its Conflict route along routes between drawn Stages.
  const own = new Set(
    publish.routes.flatMap((route) =>
      isConflictRoute(route, publish) && route.to !== null && drawnChainKeyOf(route.to)
        ? [route.to]
        : [],
    ),
  );
  for (const key of own) {
    for (const { to } of byKey.get(key)?.routes ?? []) {
      if (to !== null && drawnChainKeyOf(to) !== undefined) own.add(to);
    }
  }
  const moved = new Map(
    [...own].flatMap((key) => {
      const older = drawnChainKeyOf(key);
      return older === undefined || older === key ? [] : [[older, key] as const];
    }),
  );
  if (moved.size === 0) return runs;
  const movedTo = new Set(moved.values());
  const ownSince = runs.findIndex(({ stageKey }) => movedTo.has(stageKey));
  return runs.map((run, index) => {
    const key = moved.get(run.stageKey);
    if (key === undefined || (ownSince >= 0 && index > ownSince)) return run;
    return { ...run, stageKey: key };
  });
}

/** Replays every run of the walk, oldest first, and answers what it does next. */
function replayAll(walk: Walk): NextMove {
  const { runs } = walk;
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
  // A run of a Stage outside the conflict chain ends conflict handling, however the walk got there:
  // a send-back from a failure or a Gate as much as a Publish entered (`goTo`).
  if (!walk.chain.has(stage.key)) walk.conflictHandling = false;
  if (walk.conflictHandling) walk.conflictRuns.add(run.id);
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
      if (isPublishStage(stage)) return afterPublish(walk, run, stage, outcome.error);
      if (outcome.budgetReached) return afterBudget(walk, run, stage, outcome.budgetReached);
      return afterFailure(walk, run, stage, outcome.error);
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
  const gateIndex = walk.stages.findIndex(({ key }) => key === gate.key);
  switch (action.kind) {
    case "continue":
      if (gateChecksDefinitionOfDone(walk.stages, gateIndex)) walk.calledMet = true;
      return advance(walk, run, gate);
    case "drop":
      return action.reason ? { move: "drop", reason: action.reason } : { move: "drop" };
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
 * A Stage failed (spec §2.3, "When a Stage fails"): only its failure routes count, the first that
 * holds and still has times left followed with the failure, a used-up one passed over to the next;
 * with none, the user is asked. A kept on-failure setting is the first of them (`asFlow`), so a Task
 * that went back by it before routes had limits goes on with the same count. A Stage of conflict
 * handling with no failure route that holds is put to the user directly (`afterConflictGaveUp`).
 */
function afterFailure(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  error: string,
): StoppingMove | undefined {
  if (decisionOf(run, "no-retries-left")) return afterNoRetriesLeft(walk, run, stage, error);
  const asked = decisionOf(run, "no-route-holds");
  if (asked) return afterNoRouteHolds(walk, run, stage, asked);
  if (decisionOf(run, "base-moved")) return afterConflictGaveUp(walk, run, stage, error);
  const routes = routesOf(walk, stage);
  const recorded = recordedNext(walk, routes, (route) => isFailureRoute(route, stage.key));
  if (recorded) return followRoute(walk, run, stage, recorded, { error, guided: {} });
  const { choice, usedUp } = weighFailureRoutes(walk, run, stage, routes);
  switch (choice.kind) {
    case "follow":
      return followRoute(walk, run, stage, choice.route, { error, guided: {} });
    case "none-holds":
      if (walk.conflictHandling && !usedUp) return afterConflictGaveUp(walk, run, stage, error);
      return afterNoRetriesLeft(walk, run, stage, error);
    case "cannot-be-weighed": {
      const failureRoutes = routes.filter((route) => isFailureRoute(route, stage.key));
      return noRouteHolds(walk, run, stage, choice.why, failureRoutes);
    }
    case "run-command":
      return weighCommand(walk, run, stage, choice);
  }
}

/**
 * Weighs the failed Stage's failure routes in their order: the first that holds and still has
 * times left is to follow, and `usedUp` is the first that held at its limit, passed over.
 */
function weighFailureRoutes(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  routes: readonly Route[],
): { readonly choice: RouteChoice; readonly usedUp: Route | undefined } {
  const passed = new Set<Route>();
  let usedUp: Route | undefined;
  for (;;) {
    const choice = weigh(
      walk,
      run,
      stage,
      routes,
      (route) => isFailureRoute(route, stage.key) && !passed.has(route),
    );
    if (choice.kind !== "follow" || hasTimesLeft(countOf(walk, stage.key, choice.route))) {
      return { choice, usedUp };
    }
    usedUp ??= choice.route;
    passed.add(choice.route);
  }
}

/**
 * The failed Stage has no failure route left to follow: the user, or the Consultant asked first,
 * follows the used-up one once more, goes on by another route, continues with the issues or drops
 * the Task. With none used up, once more runs the Stage itself again. An answer kept from before
 * routes had limits, more rounds, allows the used-up route that many times more.
 */
function afterNoRetriesLeft(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  error: string,
): StoppingMove | undefined {
  const { usedUp } = weighFailureRoutes(walk, run, stage, routesOf(walk, stage));
  const question = {
    kind: "no-retries-left",
    stage,
    error,
    atLimit: usedUp && atLimitOf(walk, stage, usedUp),
    others: usedUp ? otherRoutes(walk, stage, usedUp.to) : [],
    sendBackTo: stage.kind === "script" ? lastAgentStage(walk) : undefined,
  } as const;
  const waiting = waitingOn(run, "no-retries-left", question);
  if (waiting) return waiting;
  const answer = answerOf(run, "no-retries-left");
  switch (answer.kind) {
    case "send-back":
      walk.position = sentBackAfterFailure(walk, stage, error, answer);
      return undefined;
    case "more-rounds":
      if (!usedUp) throw new Error(`Stage "${stage.key}" got more rounds, yet has no route back.`);
      allowPast(walk, stage, usedUp, answer.rounds);
      return followRoute(walk, run, stage, usedUp, { error, guided: {} });
    case "one-more-round": {
      const guided = guidanceOf(answer);
      if (usedUp) {
        allowPast(walk, stage, usedUp, 1);
        return followRoute(walk, run, stage, usedUp, { error, guided });
      }
      const round = (walk.ranAgain.get(stage.key) ?? 0) + 1;
      walk.ranAgain.set(stage.key, round);
      walk.position = {
        key: stage.key,
        carriedFailure: { stageKey: stage.key, error, round, rounds: round, ...guided },
        sentBack: undefined,
      };
      return undefined;
    }
    case "follow-route":
      return followTo(walk, run, stage, answer.to);
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
 * A Publish Stage's run ended other than done (spec §2.3.4, "Publish's results"), read by its
 * result alone (`publishResultOf`): Conflict and After publishing failed follow the routes that take
 * them, each asking as its own when none does; Failed is a Stage's failure.
 */
function afterPublish(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  error: string,
): StoppingMove | undefined {
  const result = publishResultOf(run);
  switch (result) {
    case "conflict":
      // Asked about before (with no route to take it, or before the chain was the flow's own).
      if (decisionOf(run, "base-moved")) return afterConflictAsked(walk, run, stage, error);
      return followResult(walk, run, stage, error, "conflict");
    case "after-publishing-failed":
      if (decisionOf(run, "after-publishing-failed")) {
        return afterPublishingFailed(run, stage, error);
      }
      return followResult(walk, run, stage, error, "after-publishing-failed");
    default:
      return afterFailure(walk, run, stage, error);
  }
}

/**
 * Follows the first of the Publish Stage's routes that take its result `result` and hold, carrying
 * the run's error as a failure route does: following a Conflict route starts conflict handling. A
 * route at its limit asks, as every route does (spec §2.3, "When a limit runs out"). With none,
 * Conflict asks the user directly and After publishing failed asks as it always did.
 */
function followResult(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  error: string,
  result: "conflict" | "after-publishing-failed",
): StoppingMove | undefined {
  const asked = decisionOf(run, "no-route-holds");
  if (asked) return afterNoRouteHolds(walk, run, stage, asked);
  const failure = { error, guided: {} };
  if (decisionOf(run, "route-limit")) return afterRouteLimit(walk, run, stage, failure);
  const routes = routesOf(walk, stage);
  const takes = (route: Route): boolean => takesPublishResult(route, stage.key, result);
  const recorded = recordedNext(walk, routes, takes);
  if (recorded) return followRoute(walk, run, stage, recorded, failure);
  const choice = weigh(walk, run, stage, routes, takes);
  switch (choice.kind) {
    case "follow":
      return hasTimesLeft(countOf(walk, stage.key, choice.route))
        ? followRoute(walk, run, stage, choice.route, failure)
        : routeLimitReached(walk, run, stage, choice.route);
    case "none-holds":
      return result === "conflict"
        ? afterConflictAsked(walk, run, stage, error)
        : afterPublishingFailed(run, stage, error);
    case "cannot-be-weighed":
      return noRouteHolds(walk, run, stage, choice.why, routes.filter(takes));
    case "run-command":
      return weighCommand(walk, run, stage, choice);
  }
}

/**
 * A Publish Stage ended Conflict and none of its routes takes it, so the user is asked directly
 * (spec §2.3.4): they resolve it in the worktree and Publish runs again, using no round, or they
 * drop the Task. An older answer continuing without publishing still goes on by the Stage's routes.
 */
function afterConflictAsked(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  error: string,
): StoppingMove | undefined {
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
 * Publish shipped the work, but its after publishing line failed and none of its routes takes it
 * (spec §2.3.4): the user is asked straight away, through a Consultant first, using no round, as
 * going back can't unship it. Retry and Continue both stay at the Publish Stage: its next run finds
 * the publication kept and runs only the after line, or, after Continue, ends done with the failure
 * noted.
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
 * A Stage of conflict handling failed with no failure route that holds (spec §2.3.4, "Conflicts in
 * the flow"), or a Resolve run of an older release gave up: the user is asked directly, not a
 * Consultant first. Once they resolved it in the worktree the Stage runs again to commit it, words
 * of their own guide one more round of it, or they drop the Task.
 */
function afterConflictGaveUp(
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
      throw new Error(`Stage run ${run.id} was answered "${answer.kind}" after it gave up.`);
  }
}

/**
 * The Stage ended (spec §2.3, "Which route the walk follows"): the walk follows the route the user
 * chose in the run's Decision; the route to the Stage of the next recorded run, which the walk
 * followed then, so a replay doesn't weigh again; or the first route whose condition holds now,
 * failure routes left out, as they carry only a failure. With none holding, or one that can't be
 * weighed, the user is asked, and a command test whose result the run doesn't hold yet is weighed
 * first. The route that holds at its limit stops the walk and asks: it is never passed over. A
 * Publish run the user continued from after a Conflict leaves out the routes that take Conflict.
 */
function advance(walk: Walk, run: StageRun, stage: Stage): StoppingMove | undefined {
  const asked = decisionOf(run, "no-route-holds");
  if (asked) return afterNoRouteHolds(walk, run, stage, asked);
  if (decisionOf(run, "route-limit")) return afterRouteLimit(walk, run, stage);
  const routes = routesOf(walk, stage);
  const continuedFrom = isPublishStage(stage) ? publishResultOf(run) : undefined;
  const onward = (route: Route): boolean =>
    !isFailureRoute(route, stage.key) &&
    !(continuedFrom === "conflict" && takesPublishResult(route, stage.key, continuedFrom));
  const recorded = recordedNext(walk, routes, onward);
  if (recorded) return followRoute(walk, run, stage, recorded);
  const choice = weigh(walk, run, stage, routes, onward);
  switch (choice.kind) {
    case "follow":
      return hasTimesLeft(countOf(walk, stage.key, choice.route))
        ? followRoute(walk, run, stage, choice.route)
        : routeLimitReached(walk, run, stage, choice.route);
    case "none-holds":
      return noRouteHolds(walk, run, stage, undefined);
    case "cannot-be-weighed":
      return noRouteHolds(walk, run, stage, choice.why);
    case "run-command":
      return weighCommand(walk, run, stage, choice);
  }
}

/** Asks about the route the walk would follow out of the Stage, at its limit. */
function routeLimitReached(walk: Walk, run: StageRun, stage: Stage, route: Route): StoppingMove {
  return {
    move: "ask",
    run,
    question: {
      kind: "route-limit",
      stage,
      atLimit: atLimitOf(walk, stage, route),
      others: otherRoutes(walk, stage, route.to),
      note: lastWordsOf(run),
    },
  };
}

/**
 * The route among `routes` that `followable` keeps and leads to the Stage of the run recorded after
 * the one replayed now: the walk followed it then.
 */
function recordedNext(
  walk: Walk,
  routes: readonly Route[],
  followable: (route: Route) => boolean,
): Route | undefined {
  const recorded = walk.runs[walk.replayed.length];
  return recorded && routes.find((route) => followable(route) && route.to === recorded.stageKey);
}

/**
 * Weighs `routes` out of the Stage the run ended, only those `followable` keeps, each at its place
 * among all of them, so a command test's result recorded on the run stays its own.
 */
function weigh(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  routes: readonly Route[],
  followable: (route: Route) => boolean,
): RouteChoice {
  return weighRoutes(
    routes,
    {
      stageKey: stage.key,
      runs: walk.replayed,
      publishStageKeys: new Set(walk.stages.filter(isPublishStage).map(({ key }) => key)),
      definitionOfDone: walk.definitionOfDone,
      commands: recordedCommandResults(run),
    },
    followable,
  );
}

/** Asks for the result of the command test weighing reached, recording it on the run. */
function weighCommand(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  choice: Extract<RouteChoice, { kind: "run-command" }>,
): StoppingMove {
  return {
    move: "weigh-command",
    run,
    stage,
    condition: { ...choice.test, to: choice.route.to },
    route: countOf(walk, stage.key, choice.route),
  };
}

/**
 * The user's answer to the route-limit Decision (spec §2.3, "When a limit runs out"): follow the
 * route once more, one time past its limit, go on by another route, or drop the Task. Words given
 * with it go to the Stages after it as the run's route notes. A route taking a Publish result
 * carries `failure` once more, as it did before.
 */
function afterRouteLimit(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  failure?: { readonly error: string; readonly guided: Guided },
): StoppingMove | undefined {
  const decision = decisionOf(run, "route-limit");
  if (!decision?.answer) return { move: "wait", run };
  const { answer } = decision;
  switch (answer.kind) {
    case "one-more-round": {
      const route = routeAskedAbout(walk, stage, decision);
      allowPast(walk, stage, route, 1);
      return followRoute(walk, run, stage, route, failure);
    }
    case "follow-route":
      return followTo(walk, run, stage, answer.to);
    case "drop":
      return { move: "drop" };
    default:
      throw new Error(`Stage run ${run.id} was answered "${answer.kind}" at a route's limit.`);
  }
}

/** The route a route-limit Decision asked about, by where its follow-once-more option leads. */
function routeAskedAbout(walk: Walk, stage: Stage, decision: StageRunDecision): Route {
  const again = decision.options.find(({ kind }) => kind === "one-more-round");
  const to = again?.kind === "one-more-round" ? again.to : undefined;
  const route = routesOf(walk, stage).find(
    (candidate) => candidate.to === to && !isFailureRoute(candidate, stage.key),
  );
  if (to === undefined || !route) {
    throw new Error(`Decision ${decision.id} asks about no route out of "${stage.key}".`);
  }
  return route;
}

/**
 * The last run's error, or its Handover note, which the route-limit Decision shows; a Script
 * Stage's summary for a run with no note.
 */
function lastWordsOf({ outcome }: StageRun): string | undefined {
  if (outcome?.status === "failed") return outcome.error;
  return outcome?.handoverNote ?? (outcome?.status === "done" ? outcome.summary : undefined);
}

/** Asks the user where the walk goes on from the Stage, as none of its routes holds. */
function noRouteHolds(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  why: string | undefined,
  routes: readonly Route[] = routesOf(walk, stage),
): StoppingMove {
  return {
    move: "ask",
    run,
    question: {
      kind: "no-route-holds",
      stage,
      routes: named(walk, routes),
      why,
      ...(choseNone(run, stage, routes) && { choseNone: true }),
    },
  };
}

/**
 * The Agent Stage ended done by itself with choice rows among `routes` and no choice made, so none
 * of them held (spec §2.3, "How an Agent chooses its route").
 */
function choseNone(run: StageRun, stage: Stage, routes: readonly Route[]): boolean {
  return (
    stage.kind === "agent" &&
    run.outcome?.status === "done" &&
    run.outcome.skipped !== true &&
    run.choice === undefined &&
    choiceRoutesOf(routes).length > 0
  );
}

/** The user's answer to the no-route-holds Decision: the route they chose, or Drop. */
function afterNoRouteHolds(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  decision: StageRunDecision,
): StoppingMove | undefined {
  const { answer } = decision;
  if (!answer) return { move: "wait", run };
  switch (answer.kind) {
    case "follow-route":
      return followTo(walk, run, stage, answer.to);
    case "drop":
      return { move: "drop" };
    default:
      throw new Error(`Stage run ${run.id} was answered "${answer.kind}" when no route held.`);
  }
}

/**
 * Follows the route out of the Stage to `to` that an answer chose, whatever its condition and its
 * count, counting it as any follow: one that isn't a failure route first, as a failure route may
 * lead where another does. A route no longer there is no route to count, and the walk goes on.
 */
function followTo(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  to: string | null,
): StoppingMove | undefined {
  const routes = routesOf(walk, stage).filter((route) => route.to === to);
  const route = routes.find((candidate) => !isFailureRoute(candidate, stage.key)) ?? routes[0];
  return route ? followRoute(walk, run, stage, route) : goTo(walk, run, to);
}

/**
 * Follows the route out of the Stage the run ended, counting the time on it and keeping it as the
 * route the walk left the run by. A failure route carries `failure` to the Stage it leads to, with
 * which time of how many this is. Following a Publish Stage's Conflict route starts conflict
 * handling.
 */
function followRoute(
  walk: Walk,
  run: StageRun,
  stage: Stage,
  route: Route,
  failure?: { readonly error: string; readonly guided: Guided },
): StoppingMove | undefined {
  const id = routeId(stage.key, route);
  const times = (walk.followed.get(id) ?? 0) + 1;
  const { limit } = countOf(walk, stage.key, route);
  const carriedFailure =
    failure && route.to !== null
      ? {
          stageKey: stage.key,
          error: failure.error,
          round: times,
          rounds: limit,
          ...failure.guided,
        }
      : undefined;
  if (isConflictRoute(route, flowStageOf(walk, stage.key))) walk.conflictHandling = true;
  const stopped = goTo(walk, run, route.to, carriedFailure);
  // The Definition of Done check before a Publish may stop the walk there, or send it elsewhere.
  if (stopped || walk.position.key !== route.to) return stopped;
  walk.followed.set(id, times);
  walk.left.set(run.id, { to: route.to, times, limit });
  return undefined;
}

/**
 * A route's count, by the Stage it leaves, where it leads and whether it is a failure route: a
 * Stage's routes are locked once it ran (`lockedStageProblems`), and only its failure route may
 * lead where another of its routes does.
 */
function routeId(fromKey: string, route: Route): string {
  return JSON.stringify([fromKey, route.to, isFailureRoute(route, fromKey)]);
}

function countOf(walk: Walk, fromKey: string, route: Route): RouteCount {
  const id = routeId(fromKey, route);
  const times = walk.followed.get(id) ?? 0;
  if (route.limit === null) return { times, limit: null };
  return { times, limit: route.limit + (walk.allowedPast.get(id) ?? 0) };
}

function hasTimesLeft({ times, limit }: RouteCount): boolean {
  return limit === null || times < limit;
}

/** An answer lets the route be followed `times` more past its limit. */
function allowPast(walk: Walk, stage: Stage, route: Route, times: number): void {
  const id = routeId(stage.key, route);
  walk.allowedPast.set(id, (walk.allowedPast.get(id) ?? 0) + times);
}

/** The route at its limit, named, with its count and whether it leads back. */
function atLimitOf(walk: Walk, stage: Stage, route: Route): RouteAtLimit {
  const { times, limit } = countOf(walk, stage.key, route);
  const [namedRoute = route] = named(walk, [route]);
  return { route: namedRoute, times, limit: limit ?? times, back: leadsBack(walk, stage, route) };
}

/** Whether the route leads back, to its own Stage or one before it in the Pipeline's order. */
function leadsBack(walk: Walk, stage: Stage, { to }: Route): boolean {
  if (to === null) return false;
  const keys = walk.stages.map(({ key }) => key);
  const target = keys.indexOf(to);
  return target >= 0 && target <= keys.indexOf(stage.key);
}

/** The Stage's routes out other than to `to`, one for each place they lead to, named. */
function otherRoutes(walk: Walk, stage: Stage, to: string | null): Route[] {
  const seen = new Set<string | null>([to]);
  return named(walk, routesOf(walk, stage)).filter((route) => {
    if (seen.has(route.to)) return false;
    seen.add(route.to);
    return true;
  });
}

/** `routes` with the names of the Stages they lead to and test, as the walk holds them. */
function named(walk: Walk, routes: readonly Route[]): Route[] {
  return namedRoutes(routes, new Map(walk.stages.map(({ key, name }) => [key, name])));
}

/**
 * Moves the walk to the Stage `to`, or End (null), carrying the failure a failure route carries
 * there. Before it enters a Publish Stage that isn't first, or at End on a path that entered none,
 * the Definition of Done must be reported met (spec §2.3), so an unmet statement is asked about
 * before anything is pushed or merged; not at the Publish conflict handling returns to, which ends
 * there.
 */
function goTo(
  walk: Walk,
  run: StageRun,
  to: string | null,
  carriedFailure?: CarriedFailure,
): StoppingMove | undefined {
  walk.position = { key: to, carriedFailure, sentBack: undefined };
  const next = to === null ? undefined : stageOf(walk, to);
  const returnsFromConflict = walk.conflictHandling && isPublishStage(next);
  if (isPublishStage(next)) walk.conflictHandling = false;
  const checksHere = next ? checksBefore(walk, next) : !walk.enteredPublish;
  if (next && checksHere) walk.enteredPublish = true;
  // A Decision recorded where the walk checked before (on a Publish run, at End) is replayed where
  // it is, whatever the check would find now.
  if (decisionOf(run, "definition-of-done")) return checkDefinitionOfDone(walk, run);
  if (!checksHere) return undefined;
  if (next) {
    // Conflict handling goes back to a Publish the check already let through.
    if (walk.calledMet || returnsFromConflict) return undefined;
    // Runs that went on past a Publish unchecked ran before the check moved there.
    if (run !== walk.runs.at(-1)) return undefined;
  }
  return checkDefinitionOfDone(walk, run);
}

/**
 * Whether the Gate at `index` of `stages`, a flow in the Pipeline's order, is the Definition of
 * Done check for the Publish Stage after it (spec §2.3), so its Continue calls the Definition of
 * Done met: no Agent Stage, whose report may change what is met, nor a later Gate stands between
 * them; Script Stages may. The conflict chain's Stages (`conflictOnlyStages`) don't count, and a
 * Gate of it is never the check.
 */
export function gateChecksDefinitionOfDone(stages: readonly FlowStage[], index: number): boolean {
  const gate = stages[index];
  const chain = conflictOnlyStages(stages);
  if (gate?.kind !== "gate" || chain.has(gate.key)) return false;
  for (const stage of stages.slice(index + 1)) {
    if (chain.has(stage.key)) continue;
    if (isPublishStage(stage)) return true;
    if (stage.kind !== "script") return false;
  }
  return false;
}

/**
 * Whether the walk checks the Definition of Done before entering `stage`: a Publish Stage that
 * isn't first in the Pipeline's order, as a first one has no Stage before it to check after. The
 * conflict chain's Stages, which stand before their Publish, don't count.
 */
function checksBefore(walk: Walk, stage: Stage): boolean {
  return isPublishStage(stage) && walk.firstKey !== stage.key;
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
      // No route: it uses none of a route's times (spec §2.3, "A route's limit").
      const round = walk.definitionOfDoneRounds + 1;
      walk.definitionOfDoneRounds = round;
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
    case "send-back":
      throw new Error(
        `Stage run ${run.id} was answered "${answer.kind}" at the Definition of Done.`,
      );
  }
}

/**
 * The Stage one more round of the Definition of Done check runs: the last Agent Stage the walk ran
 * outside conflict handling, or the Stage the run ended when there is none.
 */
function againStage(walk: Walk, run: StageRun): Stage {
  return lastAgentStage(walk) ?? stageOf(walk, run.stageKey);
}

/** The last Agent Stage the walk ran, never Resolve; undefined when it ran none. */
function lastAgentStage(walk: Walk): Stage | undefined {
  const agentStages = new Map(
    walk.stages.flatMap(({ key, kind }) => (kind === "agent" ? [[key, stageOf(walk, key)]] : [])),
  );
  const lastAgentRun = walk.replayed.findLast(
    ({ id, stageKey }) => agentStages.has(stageKey) && !walk.conflictRuns.has(id),
  );
  return lastAgentRun && agentStages.get(lastAgentRun.stageKey);
}

/**
 * Where a failed Script Stage's send-back goes (spec §2.3, "When a Stage fails"): to the Agent
 * Stage the answer names, carrying the failure and the words given, the walk going on from there by
 * its routes. It follows none of the failed Stage's routes, so its next failure asks again.
 */
function sentBackAfterFailure(
  walk: Walk,
  failed: Stage,
  error: string,
  answer: Extract<WalkAnswer, { readonly kind: "send-back" }>,
): WalkPosition {
  const target = stageOf(walk, answer.to);
  // The Decision offers only the last Agent Stage the walk ran, so another is a fault.
  if (target.kind !== "agent") {
    throw new Error(`Stage "${failed.key}" was sent back to "${answer.to}", no Agent Stage.`);
  }
  const round = (walk.ranAgain.get(failed.key) ?? 0) + 1;
  walk.ranAgain.set(failed.key, round);
  return {
    key: target.key,
    carriedFailure: { stageKey: failed.key, error, round, rounds: round, ...guidanceOf(answer) },
    sentBack: undefined,
  };
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

/** The routes out of the Stage, as `asFlow` reads them. */
function routesOf(walk: Walk, stage: Stage): readonly Route[] {
  return flowStageOf(walk, stage.key).routes;
}

/** The Stage of `key`, which the walk's position or a route names, as the moves carry it. */
function stageOf(walk: Walk, key: string): Stage {
  const stage = walk.shown.get(key);
  if (!stage) throw new Error(`The walk reached "${key}", which isn't among the Task's Stages.`);
  return stage;
}

/** The Stage of `key` as `asFlow` reads it, with its routes. */
function flowStageOf(walk: Walk, key: string): FlowStage {
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
 * What to do differently in a round, and whose words they are, as its carried failure keeps them.
 */
type Guided = Pick<CarriedFailure, "guidance" | "guidedBy">;

type GuidedAnswer = Extract<WalkAnswer, { readonly kind: "one-more-round" | "send-back" }>;

function guidanceOf({ guidance, guidedBy }: GuidedAnswer): Guided {
  return {
    ...(guidance !== undefined && { guidance }),
    ...(guidance !== undefined && guidedBy !== undefined && { guidedBy }),
  };
}
