import { unmetStatements } from "./definition-of-done-reports.js";
import {
  type ConditionGroup,
  type ConditionTest,
  type DefinitionOfDoneTest,
  isConditionGroup,
  type Route,
  type StageTest,
} from "./route.js";
import type { StageRun } from "./stage-run.js";

/**
 * What weighing a test or a condition answers (spec §2.3): it holds, it doesn't, or The Office
 * can't weigh it, with why, which doesn't count as not holding.
 */
export type Weight =
  | { readonly kind: "holds" }
  | { readonly kind: "does-not-hold" }
  | { readonly kind: "cannot-be-weighed"; readonly why: string };

const HOLDS: Weight = { kind: "holds" };
const DOES_NOT_HOLD: Weight = { kind: "does-not-hold" };

/** A Project-command test, by its place among the routes out of the Stage the walk left. */
export interface CommandTest {
  readonly key: string;
  /** The route's place among the Stage's routes out, from 0. */
  readonly routeIndex: number;
  /** The test's place in the route's condition: its index in each nested group in turn, from 0. */
  readonly testPath: readonly number[];
}

/**
 * The recorded result of a Project-command test (spec §2.3, "The Project-command condition"), on
 * the run the routes leave; undefined while the command hasn't been weighed, so it is to run.
 */
export type CommandResults = (test: CommandTest) => Weight | undefined;

/** What a route's condition is weighed on. */
export interface Weighing {
  /** The key of the Stage the routes leave, the one a test of the previous Stage reads. */
  readonly stageKey: string;
  /** The Task's Stage runs so far, oldest first, the leaving Stage's ended run last. */
  readonly runs: readonly StageRun[];
  readonly definitionOfDone: readonly string[];
  readonly commands: CommandResults;
}

/**
 * What weighing a Stage's routes found: the route to follow, none, one it can't weigh, or a
 * Project-command test whose command is to run before weighing goes on.
 */
export type RouteChoice =
  | { readonly kind: "follow"; readonly route: Route }
  | { readonly kind: "none-holds" }
  | { readonly kind: "cannot-be-weighed"; readonly route: Route; readonly why: string }
  | { readonly kind: "run-command"; readonly route: Route; readonly test: CommandTest };

/** What weighing a group answers: a weight, or the command test to run first. */
export type GroupWeight = Weight | { readonly kind: "run-command"; readonly test: CommandTest };

/**
 * Weighs `routes` in their order and stops at the first that holds (spec §2.3, "Which route the
 * walk follows"). A route The Office can't weigh stops it too, as a later route may only be
 * followed once that one is known not to hold; so does a command test not run yet, which is run
 * only once weighing reaches it. Routes `followable` leaves out are passed by, each of the others
 * keeping its place among all of `routes`, which a command test's recorded result is found by.
 */
export function weighRoutes(
  routes: readonly Route[],
  weighing: Weighing,
  followable: (route: Route) => boolean = () => true,
): RouteChoice {
  for (const [routeIndex, route] of routes.entries()) {
    if (!followable(route)) continue;
    const weight = route.condition
      ? weighGroup(route.condition, weighing, { routeIndex, testPath: [] })
      : HOLDS;
    switch (weight.kind) {
      case "holds":
        return { kind: "follow", route };
      case "cannot-be-weighed":
        return { kind: "cannot-be-weighed", route, why: weight.why };
      case "run-command":
        return { kind: "run-command", route, test: weight.test };
      case "does-not-hold":
        continue;
    }
  }
  return { kind: "none-holds" };
}

/** Where a group sits among the routes, for the command tests in it. */
interface GroupPlace {
  readonly routeIndex: number;
  readonly testPath: readonly number[];
}

/**
 * Weighs a group's tests in order, stopping once its result is settled: All of at the first test
 * that doesn't hold, Any of at the first that does. A test that can't be weighed leaves the result
 * open, so the next ones are still weighed and may settle it. A command test not run yet stops it
 * until the command's result is recorded, so no later test runs first.
 */
export function weighGroup(
  group: ConditionGroup,
  weighing: Weighing,
  place: GroupPlace = { routeIndex: 0, testPath: [] },
): GroupWeight {
  const settledBy = group.combine === "all" ? "does-not-hold" : "holds";
  let unweighed: Weight | undefined;
  for (const [index, test] of group.tests.entries()) {
    const at = { routeIndex: place.routeIndex, testPath: [...place.testPath, index] };
    const weight = isConditionGroup(test)
      ? weighGroup(test, weighing, at)
      : weighTest(test, weighing, at);
    if (weight.kind === settledBy || weight.kind === "run-command") return weight;
    if (weight.kind === "cannot-be-weighed") unweighed ??= weight;
  }
  return unweighed ?? (group.combine === "all" ? HOLDS : DOES_NOT_HOLD);
}

function weighTest(test: ConditionTest, weighing: Weighing, at: GroupPlace): GroupWeight {
  switch (test.kind) {
    case "stage":
      return weighStageTest(test, weighing);
    case "definitionOfDone":
      return weighDefinitionOfDoneTest(test, weighing);
    case "command": {
      const commandTest = { key: test.key, ...at };
      return weighing.commands(commandTest) ?? { kind: "run-command", test: commandTest };
    }
  }
}

/**
 * A Stage test reads its Stage's latest run that ended by itself, held and interrupted runs left
 * out, or counts every run of it; a Stage that never ran holds no outcome or file test.
 */
function weighStageTest(test: StageTest, { stageKey, runs }: Weighing): Weight {
  const key = test.stage ?? stageKey;
  const runsOfStage = runs.filter((run) => run.stageKey === key);
  if (test.is === "ran") return weightOf(runsOfStage.length >= test.times);
  const latest = runsOfStage.findLast(endedByItself);
  if (!latest?.outcome) return DOES_NOT_HOLD;
  const { outcome, changedFiles } = latest;
  switch (test.is) {
    case "done":
      return weightOf(outcome.status === "done" && !outcome.skipped);
    case "failed":
      return weightOf(outcome.status === "failed");
    case "skipped":
      return weightOf(outcome.status === "done" && outcome.skipped === true);
    // A run kept before changed files were recorded holds neither.
    case "changed":
      return weightOf(changedFiles !== undefined && changedFiles.length > 0);
    case "unchanged":
      return weightOf(changedFiles !== undefined && changedFiles.length === 0);
  }
}

function endedByItself({ outcome }: StageRun): boolean {
  if (!outcome) return false;
  if (outcome.status === "failed") return outcome.interrupted === undefined;
  return outcome.status === "done";
}

/** An Out of reach statement isn't Reported met, so it counts as not met. */
function weighDefinitionOfDoneTest(
  test: DefinitionOfDoneTest,
  { definitionOfDone, runs }: Weighing,
): Weight {
  const allMet = unmetStatements(definitionOfDone, runs).length === 0;
  return weightOf(test.is === "all-met" ? allMet : !allMet);
}

function weightOf(holds: boolean): Weight {
  return holds ? HOLDS : DOES_NOT_HOLD;
}

/**
 * Whether the route carries a failure on (spec §2.3, "When a Stage fails"): its condition is the
 * previous Stage's "ended Failed" test, on its own or within an All of group at its top.
 */
export function carriesAFailure({ condition }: Route, stageKey: string): boolean {
  if (!condition) return false;
  const endedFailed = condition.tests.some(
    (test) =>
      !isConditionGroup(test) &&
      test.kind === "stage" &&
      (test.stage === null || test.stage === stageKey) &&
      test.is === "failed",
  );
  return endedFailed && (condition.combine === "all" || condition.tests.length === 1);
}
