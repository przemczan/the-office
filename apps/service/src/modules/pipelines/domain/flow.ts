import {
  defaultRouteLimit,
  namedRoutes,
  plainRoute,
  type GivenRoute,
  type Route,
  type StagePlace,
} from "./route.js";
import { withRoutesBack } from "./routes-back.js";
import type { AgentStage, Gate, ScriptStage, Stage } from "./stage.js";

/** A Stage of a flow: one that carries its routes and its place, as a Pipeline's always do. */
export type FlowStage<Of extends Stage = Stage> = Of & {
  readonly routes: Route[];
  readonly place: StagePlace;
};

/** The Definition of Done test an optional Stage's route carries: run it while something is unmet. */
const WHILE_SOME_NOT_MET: Route["condition"] = {
  combine: "all",
  tests: [{ kind: "definitionOfDone", is: "some-not-met" }],
};

/**
 * The conversion (spec §2.3, "Converting existing Pipelines"): `stages` as a straight line, each in
 * a column of its own on row 0, with one route with no condition to the next and from the last to
 * End. Where the Stage after one is optional, its routes are to that Stage while the Definition of
 * Done has some not Reported met, otherwise to the first Stage after it that isn't optional, or End,
 * which runs and passes by the Stages the optional setting did. The optional setting itself is kept,
 * as the previous release reads it. Migration 0163 writes the same in SQL.
 */
export function straightLineFlow<Of extends Stage>(stages: readonly Of[]): FlowStage<Of>[] {
  return stages.map((stage, index) => ({
    ...stage,
    routes: straightLineRoutes(stages, index),
    place: { column: index, row: 0 },
  }));
}

function straightLineRoutes(stages: readonly Stage[], index: number): Route[] {
  const next = stages[index + 1];
  if (!next) return [plainRoute(null)];
  if (!next.optional) return [plainRoute(next.key)];
  const firstNotOptional = stages.slice(index + 1).find(({ optional }) => !optional);
  return [
    { to: next.key, condition: WHILE_SOME_NOT_MET, limit: null },
    plainRoute(firstNotOptional?.key ?? null),
  ];
}

/**
 * `stages` as a flow: converted by `straightLineFlow` when none carries routes, as a row a
 * rolled-back release rewrote or a Proposal still sending a plain list gives them; otherwise as they
 * are, a Stage missing its routes getting none (which the check refuses) and one missing its place
 * its index's column on row 0. Then a kept on-failure setting reads as a failure route back
 * (`withRoutesBack`), and a route given without a limit takes the default for where it leads.
 */
export function asFlow<Of extends Stage>(stages: readonly Of[]): FlowStage<Of>[] {
  const given: readonly Stage[] = stages;
  const placed: FlowStage[] = given.every(({ routes }) => routes === undefined)
    ? straightLineFlow(given)
    : given.map((stage, index) => ({
        ...stage,
        routes: stage.routes ?? [],
        place: stage.place ?? { column: index, row: 0 },
      }));
  // Both only change routes, so each Stage keeps its own kind's fields.
  return withRouteLimits(withRoutesBack(placed)) as FlowStage<Of>[];
}

/**
 * `stages` with every route given without a limit taking the default for where it leads (spec
 * §2.3, "A route's limit"): at most 3 times back, to its own Stage or one before it in the
 * Pipeline's order, and No limit on. Every route kept before routes had limits led on.
 */
function withRouteLimits(stages: readonly FlowStage[]): FlowStage[] {
  const limited = limitedRoutes(stages);
  return stages.map((stage, index) => ({ ...stage, routes: limited[index] ?? [] }));
}

/** A Stage as the editor or an agent gives it, before its routes' missing limits are set. */
export type GivenStage = Given<AgentStage> | Given<ScriptStage> | Given<Gate>;

type Given<Of extends Stage> = Omit<Of, "routes"> & { readonly routes?: readonly GivenRoute[] };

/**
 * Stages as given, each route without a limit taking the default for where it leads, as `asFlow`
 * gives it, a Stage without a place standing in its index's column: what an edit or a Proposal
 * hands the domain.
 */
export function withGivenLimits(stages: readonly GivenStage[]): Stage[] {
  const limited = limitedRoutes(stages);
  return stages.map((stage, index) => {
    const routes = limited[index];
    return (routes === undefined ? stage : { ...stage, routes }) as Stage;
  });
}

interface RoutedStage {
  readonly key: string;
  readonly place?: StagePlace;
  readonly routes?: readonly GivenRoute[];
}

function limitedRoutes(stages: readonly RoutedStage[]): (Route[] | undefined)[] {
  const order = orderIndexes(
    stages.map(({ key, place }, index) => ({ key, place: place ?? { column: index, row: 0 } })),
  );
  return stages.map(({ key, routes }) => {
    const from = order.get(key) ?? 0;
    return routes?.map((route): Route => ({
      ...route,
      limit:
        route.limit === undefined ? defaultRouteLimit(leadsBack(from, route, order)) : route.limit,
    }));
  });
}

/** Each Stage's index in the Pipeline's order, by its key. */
function orderIndexes(
  stages: readonly { readonly key: string; readonly place: StagePlace }[],
): ReadonlyMap<string, number> {
  const ordered = stages.toSorted((one, other) => comparePlaces(one.place, other.place));
  return new Map(ordered.map(({ key }, index) => [key, index]));
}

function leadsBack(from: number, { to }: GivenRoute, order: ReadonlyMap<string, number>): boolean {
  const target = to === null ? undefined : order.get(to);
  return target !== undefined && target <= from;
}

/**
 * Whether a route from `fromKey` to `toKey` leads back (spec §2.3, "The Pipeline's order"): to its
 * own Stage or one before it among `stages` in the Pipeline's order. End never is.
 */
export function isRouteBack(
  stages: readonly FlowStage[],
  fromKey: string,
  toKey: string | null,
): boolean {
  const order = orderIndexes(stages);
  const from = order.get(fromKey);
  return from !== undefined && leadsBack(from, { to: toKey, condition: null }, order);
}

/**
 * A flow an agent proposed, ready to be judged and kept: `asFlow`'s, so a Stage left without a place
 * stands in the column of its index in the order given, and every route naming the Stages it leads
 * to and tests by their names among `stages`. In the Pipeline's order.
 */
export function placedInOrder(stages: readonly Stage[]): FlowStage[] {
  const names = new Map(stages.map(({ key, name }) => [key, name]));
  const named: FlowStage[] = asFlow(stages).map((stage) => ({
    ...stage,
    routes: namedRoutes(stage.routes, names),
  }));
  return pipelineOrder(named);
}

/**
 * `stages` in the Pipeline's order (spec §2.3): by their places, the columns left to right and a
 * column's Stages top to bottom; Stages at one place keep the order they came in.
 */
export function pipelineOrder<Of extends FlowStage>(stages: readonly Of[]): Of[] {
  return stages.toSorted((one, other) => comparePlaces(one.place, other.place));
}

/** Sorts places in the Pipeline's order: by column, then by row. */
export function comparePlaces(one: StagePlace, other: StagePlace): number {
  return one.column - other.column || one.row - other.row;
}

/** Whether `stages` are a straight line as `straightLineFlow` draws them, so a list can edit them. */
export function isStraightLine(stages: readonly FlowStage[]): boolean {
  const ordered = pipelineOrder(stages);
  return ordered.every(
    (stage, index) =>
      stage.place.column === index &&
      stage.place.row === 0 &&
      stage.routes.length === 1 &&
      stage.routes[0]?.condition === null &&
      stage.routes[0].to === (ordered[index + 1]?.key ?? null),
  );
}

/** The keys of the Stages a path of routes leads to from `fromKey`, whatever their conditions. */
export function reachableFrom(stages: readonly FlowStage[], fromKey: string): ReadonlySet<string> {
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const reached = new Set<string>([fromKey]);
  const toVisit = [fromKey];
  for (let key = toVisit.pop(); key !== undefined; key = toVisit.pop()) {
    for (const { to } of byKey.get(key)?.routes ?? []) {
      if (to !== null && !reached.has(to)) {
        reached.add(to);
        toVisit.push(to);
      }
    }
  }
  return reached;
}
