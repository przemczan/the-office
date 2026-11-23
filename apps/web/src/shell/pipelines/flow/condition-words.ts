import type {
  ConditionGroup,
  ConditionTest,
  Route,
  RouteLimit,
  Stage,
} from "@the-office/contracts";
import { isGroup, type DefinitionOfDoneIs, type StageTestIs } from "./condition-edits.ts";
import { isFailureRoute, limitOf } from "./flow-model.ts";

/**
 * A route's condition in plain words (docs/design/pipeline-flow.html): "Followed when Implement changed files and either the Definition of Done has
 * some not Reported met or Tests ran 2 or more times." `from` is the route's own Stage, which a test
 * of `stage: null` names; `stages` the flow, which names every other.
 */

/**
 * What words need of the Stage a route leaves: its name, its routes for their order, and its kind
 * when known, as an Agent Stage's failure route reads "when it fails".
 */
export type RouteSource = Pick<Stage, "name" | "routes"> & { readonly kind?: Stage["kind"] };

/** The second select of a Stage test, and its words after the Stage's name. */
export const STAGE_TEST_WORDS: Readonly<Record<StageTestIs, string>> = {
  done: "ended Done",
  failed: "ended Failed",
  skipped: "was Skipped",
  changed: "changed files",
  unchanged: "changed no files",
  ran: "ran N or more times",
};

/** The second select of a Definition of Done test, and its words after "the Definition of Done". */
export const DEFINITION_OF_DONE_TEST_WORDS: Readonly<Record<DefinitionOfDoneIs, string>> = {
  "all-met": "is all Reported met",
  "some-not-met": "has some not Reported met",
};

/** Words for a list of a route's own lines on the canvas ("short") or for its panel. */
export interface WordsOptions {
  /** A command test as "docs-changed exits 0" rather than "the Project command docs-changed …". */
  readonly short?: boolean;
}

/** The first select's choice of the route's own Stage: "The previous Stage (Tests)". */
export function previousStageLabel(from: Stage): string {
  return `The previous Stage (${from.name})`;
}

/**
 * A Stage's name by its key; a Stage no longer in the flow by the name it was saved with, or its
 * key, as a condition or route still names it until it is fixed.
 */
export function stageNameOrGone(
  key: string,
  stageName: string | undefined,
  stages: readonly Stage[],
): string {
  return stages.find((stage) => stage.key === key)?.name ?? stageName ?? key;
}

export function testWords(
  test: ConditionTest,
  from: RouteSource,
  stages: readonly Stage[],
  { short = false }: WordsOptions = {},
): string {
  switch (test.kind) {
    case "definitionOfDone":
      return `the Definition of Done ${DEFINITION_OF_DONE_TEST_WORDS[test.is]}`;
    case "command":
      return short
        ? `${test.key || "a command"} exits 0`
        : `the Project command ${test.key || "(none picked)"} exits 0`;
    case "stage": {
      const name =
        test.stage === null ? from.name : stageNameOrGone(test.stage, test.stageName, stages);
      const is = test.is === "ran" ? `ran ${test.times} or more times` : STAGE_TEST_WORDS[test.is];
      return `${name} ${is}`;
    }
  }
}

/**
 * A group's tests joined by "and" or "or"; a nested group of two reads "both … and …" or
 * "either … or …", of more "all of: …" or "any of: …", so where it ends stays plain.
 */
export function groupWords(
  group: ConditionGroup,
  from: RouteSource,
  stages: readonly Stage[],
  options: WordsOptions = {},
): string {
  return nestedWords(group, from, stages, options, 0);
}

/** Where a route leads: its Stage's name, or End. */
export function routeTargetName(route: Route, stages: readonly Stage[]): string {
  return route.to === null ? "End" : stageNameOrGone(route.to, route.toName, stages);
}

/**
 * When a route is followed, as its line inside its Stage reads: "when …" ("when it fails" for an
 * Agent Stage's failure route), or with no condition "always" when it is the first route,
 * "otherwise" after another.
 */
export function routeWhen(
  route: Route,
  from: RouteSource,
  stages: readonly Stage[],
  routeIndex = indexOf(route, from),
): string {
  if (from.kind === "agent" && isFailureRoute(route)) return "when it fails";
  if (route.condition !== null) {
    return `when ${groupWords(route.condition, from, stages, { short: true })}`;
  }
  return routeIndex > 0 ? "otherwise" : "always";
}

/** A limit's mark, "≤3×", or none for No limit. */
export function limitMark(limit: RouteLimit | undefined): string {
  return limit === null || limit === undefined ? "" : `≤${limit}×`;
}

/** "at most 3 times", "at most 1 time". */
export function atMostWords(limit: number): string {
  return `at most ${limit} ${limit === 1 ? "time" : "times"}`;
}

/**
 * When a route is followed and its limit, as a sentence under its condition in the panel: "Followed
 * when Tests ended Failed, at most 3 times in a walk; then you're asked (or the CTO first)."
 */
export function followedWhen(
  route: Route,
  from: Stage,
  stages: readonly Stage[],
  routeIndex = indexOf(route, from),
): string {
  const limit = limitOf(stages, from.key, route);
  const limited =
    limit === null ? "" : `, ${atMostWords(limit)} in a walk; then you're asked (or the CTO first)`;
  const withLimit = `${limited || ", with no limit"}.`;
  if (from.kind === "agent" && isFailureRoute(route)) {
    return `Followed when ${from.name} fails${withLimit}`;
  }
  if (route.condition !== null) {
    return `Followed when ${groupWords(route.condition, from, stages)}${withLimit}`;
  }
  const count = from.routes?.length ?? 0;
  if (count <= 1) return `Always followed: it is ${from.name}'s one route out${limited}.`;
  return routeIndex === count - 1
    ? `Followed otherwise, when no route before it holds${withLimit}`
    : "Always holds, so no route after it can be followed.";
}

function nestedWords(
  group: ConditionGroup,
  from: RouteSource,
  stages: readonly Stage[],
  options: WordsOptions,
  depth: number,
): string {
  const parts = group.tests.map((item) =>
    isGroup(item)
      ? nestedWords(item, from, stages, options, depth + 1)
      : testWords(item, from, stages, options),
  );
  const [only] = parts;
  if (only === undefined) return "no test yet";
  if (parts.length === 1) return only;
  const all = group.combine === "all";
  const joined = listJoin(parts, all ? "and" : "or");
  if (depth === 0) return joined;
  if (parts.length === 2) return `${all ? "both" : "either"} ${joined}`;
  return `${all ? "all of" : "any of"}: ${joined}`;
}

function listJoin(parts: readonly string[], word: string): string {
  const last = parts.at(-1) ?? "";
  if (parts.length < 2) return last;
  return `${parts.slice(0, -1).join(", ")} ${word} ${last}`;
}

/** The route's index among its Stage's; a route that isn't one of them counts as the first. */
function indexOf(route: Route, from: RouteSource): number {
  return Math.max(0, from.routes?.indexOf(route) ?? 0);
}
