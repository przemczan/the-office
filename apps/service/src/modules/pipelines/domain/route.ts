/**
 * A route out of a Stage (spec §2.3, "A Pipeline is a flow"): to a later Stage by its key, or to the
 * Pipeline's End (`null`), and a condition that must hold for the walk to follow it, `null` holding
 * always.
 */
export interface Route {
  readonly to: string | null;
  /** The name of the Stage it leads to when it was last saved, for its words alone. */
  readonly toName?: string;
  readonly condition: ConditionGroup | null;
}

/** All of (AND) or Any of (OR) its tests and nested groups, weighed in order. */
export interface ConditionGroup {
  readonly combine: "all" | "any";
  readonly tests: (ConditionTest | ConditionGroup)[];
}

export type ConditionTest = StageTest | DefinitionOfDoneTest | CommandTest;

/** What a Stage test says of its Stage's latest run. */
export type StageTestOutcome = "done" | "failed" | "skipped" | "changed" | "unchanged";

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

/** Where a Stage stands on the flow editor's canvas: the columns left to right give the order. */
export interface StagePlace {
  readonly column: number;
  readonly row: number;
}

/** The one route out of a straight line's Stage: to `to`, always. */
export function plainRoute(to: string | null): Route {
  return { to, condition: null };
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

/** The keys of the Project commands the routes' conditions run, each once. */
export function commandKeysOfRoutes(routes: readonly Route[]): readonly string[] {
  const keys = routes.flatMap(({ condition }) =>
    condition
      ? testsOf(condition).flatMap(({ test }) => (test.kind === "command" ? [test.key] : []))
      : [],
  );
  return [...new Set(keys)];
}
