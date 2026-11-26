import type {
  ConditionGroup,
  ConditionTest,
  Route,
  Stage,
  StageProblem,
  StageProblemAt,
} from "@the-office/contracts";
import { isGroup, type TestPath } from "./condition-edits.ts";
import { routeTargetName } from "./condition-words.ts";
import { choiceWordsOf } from "./flow-model.ts";

/**
 * What the flow editor refuses on its own, beside the service's check: a condition group with no
 * test yet (docs/spec/screens/pipeline-flow-editor.md, "Problems and warnings"), which the walk
 * would read as always holding (All of) or never (Any of); and, as the service's check refuses them
 * too, an Agent's choice anywhere but alone on an Agent Stage's route, with no words, or with the
 * words of an earlier choice of its Stage (spec §2.3, "Validation"), said at once as they are typed.
 * Worded and placed as the check's own problems, so it shows on its test or group and above the bar
 * and holds Save the same way; `byLevel` drops the service's copy of the same problem.
 */
export function flowProblems(stages: readonly Stage[]): readonly StageProblem[] {
  const ordered = stages;
  return ordered.flatMap((stage, stageIndex) => {
    const problem = (at: StageProblemAt, text: string): StageProblem => ({
      stageKey: stage.key,
      at,
      level: "problem",
      text: `Stage ${stageIndex + 1} · ${stage.name.trim() || stage.key}: ${text}`,
    });
    const routes = stage.routes ?? [];
    return routes.flatMap((route, routeIndex) => {
      if (!route.condition) return [];
      const at = { kind: "route", routeIndex } as const;
      const place = placeName(route, ordered);
      return [
        ...emptyGroupsOf(route.condition).map((testPath) =>
          problem(
            { ...at, testPath: [...testPath] },
            `its route to ${routeTargetName(route, stages)} has a group with no test yet: add a test, or remove the group.`,
          ),
        ),
        ...choiceRouteProblems(route, routes.slice(0, routeIndex)).map((text) =>
          problem(at, `its route to ${place} ${text}`),
        ),
        ...testsOf(route.condition).flatMap(({ test, testPath }) =>
          test.kind === "choice"
            ? choiceTestProblems(test.words, stage).map((text) =>
                problem(
                  { ...at, testPath: [...testPath] },
                  `a condition of its route to ${place} ${text}`,
                ),
              )
            : [],
        ),
      ];
    });
  });
}

/**
 * A choice is the only test of its route, and no two choice rows of a Stage share their words,
 * trimmed and whatever the case.
 */
function choiceRouteProblems(route: Route, earlierRoutes: readonly Route[]): readonly string[] {
  if (!route.condition || !testsOf(route.condition).some(({ test }) => test.kind === "choice")) {
    return [];
  }
  const words = choiceWordsOf(route);
  if (words === undefined) {
    return ["mixes the Agent's choice with other tests; a choice is the only test of its route."];
  }
  const same = wordsKey(words);
  if (same === "") return [];
  return earlierRoutes.some((earlier) => {
    const earlierWords = choiceWordsOf(earlier);
    return earlierWords !== undefined && wordsKey(earlierWords) === same;
  })
    ? ["has the same words as an earlier choice; give each choice its own words."]
    : [];
}

/** An Agent's choice is an Agent Stage's alone, and the Agent chooses it by its words. */
function choiceTestProblems(words: string, stage: Stage): readonly string[] {
  return [
    ...(stage.kind === "agent" ? [] : ["is the Agent's choice, which only an Agent Stage has."]),
    ...(words.trim() === "" ? ["is a choice with no words; say when the Agent chooses it."] : []),
  ];
}

function wordsKey(words: string): string {
  return words.trim().toLowerCase();
}

/** Where a route leads, named as the service's check names it. */
function placeName(route: Route, ordered: readonly Stage[]): string {
  if (route.to === null) return "End";
  return ordered.find(({ key }) => key === route.to)?.name.trim() || route.toName || route.to;
}

/** Every test of `group` and its nested groups, with its path. */
function testsOf(
  group: ConditionGroup,
  path: TestPath = [],
): readonly { readonly test: ConditionTest; readonly testPath: TestPath }[] {
  return group.tests.flatMap((item, index) =>
    isGroup(item) ? testsOf(item, [...path, index]) : [{ test: item, testPath: [...path, index] }],
  );
}

/** The paths of `group` and its nested groups that hold no test. */
function emptyGroupsOf(group: ConditionGroup, path: TestPath = []): readonly TestPath[] {
  const nested = group.tests.flatMap((item, index) =>
    isGroup(item) ? emptyGroupsOf(item, [...path, index]) : [],
  );
  return group.tests.length === 0 ? [path, ...nested] : nested;
}
