import { isDeepStrictEqual } from "node:util";
import type { FlowStage } from "./flow.js";
import type { StageProblemAt, StageProblemLevel } from "./pipeline.js";
import { PUBLISH_RESULT_NAMES } from "./publish-result.js";
import {
  agentChoiceOf,
  isConditionGroup,
  unnamedRoutes,
  type ConditionGroup,
  type ConditionTest,
  type Route,
  type StageTest,
} from "./route.js";

/** One Stage whose routes a Proposal changes: its routes as they were and as proposed. */
export interface StageRouteChange {
  readonly stageKey: string;
  readonly stageName: string;
  /** Empty for a Stage the Proposal adds. */
  readonly from: readonly Route[];
  /** Empty for a Stage the Proposal removes. */
  readonly to: readonly Route[];
}

/** A problem of the check as a Proposal keeps it, with no field left out. */
export interface KeptStageProblem {
  readonly stageKey: string | null;
  readonly at: StageProblemAt | null;
  readonly level: StageProblemLevel;
  readonly text: string;
}

/**
 * What a Proposal of a Pipeline does to its routes (spec §2.3, "Agents propose route and condition
 * changes"), and the check's answer when it was drafted, which holds warnings alone.
 */
export interface ProposedRoutes {
  readonly stages: readonly StageRouteChange[];
  readonly check: readonly KeptStageProblem[];
}

/**
 * Each Stage whose routes differ between the flows `from` and `to`, weighed as kept (targets,
 * conditions and limits), the Stages' names in them left out: `to`'s in its order, then those it removes in `from`'s.
 */
export function routeChangesOf(
  from: readonly FlowStage[],
  to: readonly FlowStage[],
): StageRouteChange[] {
  const before = new Map(from.map((stage) => [stage.key, stage]));
  const after = new Set(to.map(({ key }) => key));
  const changed = to.flatMap((stage) => {
    const routesBefore = before.get(stage.key)?.routes ?? [];
    return sameRoutes(routesBefore, stage.routes)
      ? []
      : [routeChange(stage, routesBefore, stage.routes)];
  });
  const removed = from
    .filter(({ key }) => !after.has(key))
    .map((stage) => routeChange(stage, stage.routes, []));
  return [...changed, ...removed];
}

function routeChange(
  { key, name }: FlowStage,
  from: readonly Route[],
  to: readonly Route[],
): StageRouteChange {
  return { stageKey: key, stageName: name, from, to };
}

function sameRoutes(one: readonly Route[], other: readonly Route[]): boolean {
  return isDeepStrictEqual(asKept(unnamedRoutes(one)), asKept(unnamedRoutes(other)));
}

/** As the database keeps it: a field left undefined is the same as one left out. */
function asKept(routes: readonly Route[]): unknown {
  return JSON.parse(JSON.stringify(routes));
}

/**
 * A Stage's routes, weighed in order, each with its limit, No limit saying nothing: "to Implement
 * when …, at most 3 times, otherwise to Publish always".
 */
export function routesWords(routes: readonly Route[]): string {
  return routes
    .map((route, index) => `${index === 0 ? "" : "otherwise "}${routeWords(route)}`)
    .join(", ");
}

function routeWords(route: Route): string {
  const { to, toName, condition, limit } = route;
  const place = to === null ? "End" : (toName ?? to);
  const choice = agentChoiceOf(route);
  const when =
    choice !== undefined
      ? `to ${place} if the Agent chooses: "${choice}"`
      : condition
        ? `to ${place} when ${groupWords(condition)}`
        : `to ${place} always`;
  return limit === null ? when : `${when}, at most ${limit === 1 ? "once" : `${limit} times`}`;
}

function groupWords({ combine, tests }: ConditionGroup): string {
  if (tests.length === 0) return combine === "all" ? "always" : "never";
  return tests
    .map((test) => (isConditionGroup(test) ? `(${groupWords(test)})` : testWords(test)))
    .join(combine === "all" ? " and " : " or ");
}

/** A test in the spec's words (spec §2.3, "The built-in conditions"). */
function testWords(test: ConditionTest): string {
  switch (test.kind) {
    case "definitionOfDone":
      return test.is === "all-met"
        ? "the Definition of Done is all Reported met"
        : "some of the Definition of Done is not Reported met";
    case "command":
      return `the command ${test.key} exits 0`;
    case "choice":
      return `the Agent chooses: "${test.words}"`;
    case "stage": {
      const stage = test.stage === null ? "the previous Stage" : (test.stageName ?? test.stage);
      return `${stage} ${stageOutcomeWords(test)}`;
    }
  }
}

function stageOutcomeWords(test: StageTest): string {
  switch (test.is) {
    case "done":
      return "ended Done";
    case "failed":
      return "ended Failed";
    case "skipped":
      return "was Skipped";
    case "changed":
      return "changed files";
    case "unchanged":
      return "changed no files";
    case "ran":
      return `ran ${test.times} or more times`;
    case "published":
    case "nothing-to-publish":
    case "conflict":
    case "after-publishing-failed":
      return `ended ${PUBLISH_RESULT_NAMES[test.is]}`;
  }
}
