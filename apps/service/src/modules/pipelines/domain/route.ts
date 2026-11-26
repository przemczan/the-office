import type { PublishResult } from "./publish-result.js";

/**
 * A route out of a Stage (spec §2.3, "A Pipeline is a flow"): to any Stage by its key, its own
 * included, or to the Pipeline's End (`null`), a condition that must hold for the walk to follow
 * it, `null` holding always, and its limit.
 */
export interface Route {
  readonly to: string | null;
  /** The name of the Stage it leads to when it was last saved, for its words alone. */
  readonly toName?: string;
  readonly condition: ConditionGroup | null;
  readonly limit: RouteLimit;
}

/**
 * "At most N times" in one walk, N from 1 to `ROUTE_LIMIT_MAX`; null is No limit (spec §2.3, "A
 * route's limit").
 */
export type RouteLimit = number | null;

export const ROUTE_LIMIT_MAX = 9;

/** The limit a route back starts at: one to its own Stage or one before it in the Pipeline's order. */
export const ROUTE_BACK_LIMIT = 3;

/** A route as given or kept, before `asFlow` sets its limit: absent takes the default. */
export type GivenRoute = Omit<Route, "limit"> & { readonly limit?: RouteLimit };

/** The limit a route takes when it is drawn, or given without one: 3 back, No limit on. */
export function defaultRouteLimit(leadsBack: boolean): RouteLimit {
  return leadsBack ? ROUTE_BACK_LIMIT : null;
}

/** The condition of a failure route as the forms write it: the previous Stage ended Failed. */
export const ENDED_FAILED: ConditionGroup = {
  combine: "all",
  tests: [{ kind: "stage", stage: null, is: "failed" }],
};

/** All of (AND) or Any of (OR) its tests and nested groups, weighed in order. */
export interface ConditionGroup {
  readonly combine: "all" | "any";
  readonly tests: (ConditionTest | ConditionGroup)[];
}

export type ConditionTest = StageTest | DefinitionOfDoneTest | CommandTest | ChoiceTest;

/**
 * What a Stage test says of its Stage's latest run: a Publish Stage's results besides Failed are
 * tested on a Publish Stage alone (spec §2.3.4, "Publish's results").
 */
export type StageTestOutcome =
  "done" | "failed" | "skipped" | "changed" | "unchanged" | Exclude<PublishResult, "failed">;

interface TestedStage {
  readonly kind: "stage";
  /** The key of the Stage it tests; null is the route's own Stage, the one the walk just left. */
  readonly stage: string | null;
  /** The tested Stage's name when it was last saved, for its words alone. */
  readonly stageName?: string;
}

/** A test of a Stage's latest run, or of how many times it ran, its latest run included. */
export type StageTest =
  | (TestedStage & { readonly is: StageTestOutcome })
  | (TestedStage & { readonly is: "ran"; readonly times: number });

export interface DefinitionOfDoneTest {
  readonly kind: "definitionOfDone";
  readonly is: "all-met" | "some-not-met";
}

/** Holds when the Project's command by `key` exits 0 (spec §2.3, "The Project-command condition"). */
export interface CommandTest {
  readonly kind: "command";
  readonly key: string;
}

/**
 * An Agent Stage's choice (spec §2.3, "How an Agent chooses its route"): a condition in plain words
 * for its Agent, which holds when the Agent chose the route with `choose_route`. It is the only test
 * of its route, which makes the route a choice row.
 */
export interface ChoiceTest {
  readonly kind: "choice";
  readonly words: string;
}

/** A choice row's condition, `words` its only test. */
export function choiceCondition(words: string): ConditionGroup {
  return { combine: "all", tests: [{ kind: "choice", words }] };
}

/** The words of `route`'s choice when it is a choice row, its condition one choice test alone. */
export function agentChoiceOf({ condition }: Route): string | undefined {
  const [test, ...others] = condition?.tests ?? [];
  if (!test || others.length > 0 || isConditionGroup(test) || test.kind !== "choice") {
    return undefined;
  }
  return test.words;
}

/** The choice rows of an Agent Stage's routes, with their words, in their order. */
export function choiceRoutesOf(
  routes: readonly Route[],
): { readonly route: Route; readonly words: string }[] {
  return routes.flatMap((route) => {
    const words = agentChoiceOf(route);
    return words === undefined ? [] : [{ route, words }];
  });
}

/** Whether `condition` has a choice test anywhere in it. */
export function hasChoiceTest(condition: ConditionGroup): boolean {
  return testsOf(condition).some(({ test }) => test.kind === "choice");
}

/**
 * Where a Stage stood on the flow editor's grid before Stages had a position: kept for the previous
 * release, which reads the Pipeline's order from it (`positions.ts`).
 */
export interface StagePlace {
  readonly column: number;
  readonly row: number;
}

/** Where a Stage's card, or End, stands on the canvas: its top-left corner, in canvas units. */
export interface StagePosition {
  readonly x: number;
  readonly y: number;
}

/** The one route out of a straight line's Stage: to `to`, always, with No limit. */
export function plainRoute(to: string | null): Route {
  return { to, condition: null, limit: null };
}

/**
 * Whether `route`, out of the Stage `stageKey`, is a failure route (spec §2.3, "When a Stage
 * fails"): its condition is that Stage's "ended Failed" test, on its own or within an All of group at
 * its top. Only such a route carries a failure on, and only it may lead where another route of the
 * Stage does.
 */
export function isFailureRoute({ condition }: Route, stageKey: string): boolean {
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

/** The test is a group of tests, not a test. */
export function isConditionGroup(test: ConditionTest | ConditionGroup): test is ConditionGroup {
  return "combine" in test;
}

/** Each test of `group`, nested ones too, with its indexes in the condition, `[0, 1]`. */
export function testsOf(
  group: ConditionGroup,
  path: readonly number[] = [],
): { readonly test: ConditionTest; readonly testPath: readonly number[] }[] {
  return group.tests.flatMap((test, index) => {
    const testPath = [...path, index];
    return isConditionGroup(test) ? testsOf(test, testPath) : [{ test, testPath }];
  });
}

/**
 * `routes` with the names of the Stages they lead to and test (`toName`, `stageName`) taken from
 * `names`, by key; a Stage `names` lacks keeps the name it had.
 */
export function namedRoutes(routes: readonly Route[], names: ReadonlyMap<string, string>): Route[] {
  return routes.map(({ to, toName, condition, limit }) => {
    const name = to === null ? undefined : (names.get(to) ?? toName);
    return {
      to,
      ...(name === undefined ? {} : { toName: name }),
      condition: condition && namedGroup(condition, names),
      limit,
    };
  });
}

function namedGroup(group: ConditionGroup, names: ReadonlyMap<string, string>): ConditionGroup {
  return {
    combine: group.combine,
    tests: group.tests.map((test) => {
      if (isConditionGroup(test)) return namedGroup(test, names);
      if (test.kind !== "stage" || test.stage === null) return test;
      const name = names.get(test.stage) ?? test.stageName;
      const { stageName: _stageName, ...unnamed } = test;
      return name === undefined ? unnamed : { ...unnamed, stageName: name };
    }),
  };
}

/** `routes` without the Stages' names, which are for their words alone: what a comparison weighs. */
export function unnamedRoutes(routes: readonly Route[]): Route[] {
  return routes.map(({ to, condition, limit }) => ({
    to,
    condition: condition && unnamedGroup(condition),
    limit,
  }));
}

function unnamedGroup(group: ConditionGroup): ConditionGroup {
  return {
    combine: group.combine,
    tests: group.tests.map((test) => {
      if (isConditionGroup(test)) return unnamedGroup(test);
      if (test.kind !== "stage") return test;
      const { stageName: _stageName, ...unnamed } = test;
      return unnamed;
    }),
  };
}

/** The keys of the Project commands the routes' conditions run, each once. */
export function commandKeysOfRoutes(routes: readonly Route[]): readonly string[] {
  const keys = routes.flatMap(({ condition }) =>
    condition
      ? testsOf(condition).flatMap(({ test }) => (test.kind === "command" ? [test.key] : []))
      : [],
  );
  return [...new Set(keys)];
}
