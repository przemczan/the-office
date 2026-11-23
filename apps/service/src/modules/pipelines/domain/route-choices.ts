import { asFlow } from "./flow.js";
import { routeCounts, type RouteCount } from "./pipeline-walk.js";
import { choiceRoutesOf, type Route } from "./route.js";
import type { Stage } from "./stage.js";
import type { ChosenRoute, StageRun } from "./stage-run.js";

/** The name `choose_route` takes for a route to End (spec §2.3, "How an Agent chooses its route"). */
export const END_ROUTE_KEY = "end";

/**
 * One of an Agent Stage's choice rows as its Agent reads it: the route, its words, the key the
 * Agent names it by (its target's, or `end`), its target's name and its count so far.
 */
export interface ChoiceRow {
  readonly route: Route;
  readonly words: string;
  readonly key: string;
  readonly targetName: string;
  readonly count: RouteCount;
}

/**
 * The choice rows of the Stage keyed `stageKey`, in their order, each with how often the walk
 * followed it so far over `runs` (spec §2.3, "A route's limit"); none when it isn't an Agent Stage.
 */
export function choiceRowsOf(
  stageKey: string,
  stages: readonly Stage[],
  runs: readonly StageRun[],
): ChoiceRow[] {
  const flow = asFlow(stages);
  const stage = flow.find(({ key }) => key === stageKey);
  if (stage?.kind !== "agent") return [];
  const choices = choiceRoutesOf(stage.routes);
  if (choices.length === 0) return [];
  const counts = routeCounts(
    stages,
    runs,
    stageKey,
    choices.map(({ route }) => route),
  );
  return choices.map(({ route, words }, index) => ({
    route,
    words,
    key: route.to ?? END_ROUTE_KEY,
    targetName: routeTargetName(flow, route.to),
    count: counts[index] ?? { times: 0, limit: route.limit },
  }));
}

/** Whether the Stage keyed `stageKey` is an Agent Stage with choice rows, offered `choose_route`. */
export function hasChoiceRows(stageKey: string, stages: readonly Stage[]): boolean {
  const stage = asFlow(stages).find(({ key }) => key === stageKey);
  return stage?.kind === "agent" && choiceRoutesOf(stage.routes).length > 0;
}

/** The name of the place a route leads to: its Stage's, or End. */
export function routeTargetName(stages: readonly Stage[], to: string | null): string {
  if (to === null) return "End";
  return stages.find(({ key }) => key === to)?.name ?? to;
}

/** A choice made, with the name of the place it leads to, as the Brief names it. */
export interface NamedChoice {
  readonly targetName: string;
  readonly reason: string;
}

export function namedChoice(stages: readonly Stage[], { to, reason }: ChosenRoute): NamedChoice {
  return { targetName: routeTargetName(stages, to), reason };
}

/** Whether the route was followed as many times as its limit allows. */
export function atItsLimit({ times, limit }: RouteCount): boolean {
  return limit !== null && times >= limit;
}

/** "followed 1 of at most 3 times", or with No limit "followed 2 times, with No limit". */
export function choiceCountWords({ times, limit }: RouteCount): string {
  if (limit === null) return `followed ${times} ${times === 1 ? "time" : "times"}, with No limit`;
  return `followed ${times} of at most ${limit} ${limit === 1 ? "time" : "times"}`;
}
