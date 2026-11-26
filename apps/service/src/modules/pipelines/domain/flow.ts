import {
  defaultRouteLimit,
  namedRoutes,
  plainRoute,
  type GivenRoute,
  type Route,
  type StagePlace,
  type StagePosition,
} from "./route.js";
import { positionsFromPlaces, withFilledPositions } from "./positions.js";
import { withPublishStages } from "./publish-stages.js";
import { withRoutesBack } from "./routes-back.js";
import type { AgentStage, Gate, PublishStage, ScriptStage, Stage } from "./stage.js";

/**
 * A Stage of a flow: one that carries its routes and its position, as a Pipeline's always do. A
 * flow's Stages are in the Pipeline's order, the order of their list (spec §2.3).
 */
export type FlowStage<Of extends Stage = Stage> = Of & {
  readonly routes: Route[];
  readonly position: StagePosition;
};

/**
 * A Stage of a flow as the conversions read it, before it has a position: on its old grid place,
 * which a list from before positions gives and the conflict chain is drawn in.
 */
export type GridStage<Of extends Stage = Stage> = Of & {
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
export function straightLineFlow<Of extends Stage>(stages: readonly Of[]): GridStage<Of>[] {
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
 * `stages` as a flow, in the Pipeline's order: converted by `straightLineFlow` when none carries
 * routes, as a row a rolled-back release rewrote or a Proposal still sending a plain list gives
 * them; otherwise as they are, a Stage missing its routes getting none (which the check refuses).
 * A kept on-failure setting reads as a failure route back (`withRoutesBack`), a kept Script
 * `publish` Stage as a Publish Stage with its conflict chain (`withPublishStages`), and a route given
 * without a limit takes the default for where it leads. A list where no Stage has a position is from
 * before positions (or a rollback's): once its chain is drawn, it is sorted by its places, a Stage
 * without one in its index's column, as the Pipeline's order was then, and each place becomes a
 * position (`positionsFromPlaces`). In any other list a Stage without a position, the chain's drawn
 * in among them, stands beside the one before it (`withFilledPositions`).
 */
export function asFlow<Of extends Stage>(stages: readonly Of[]): FlowStage<Of>[] {
  const given: readonly Stage[] = stages;
  const fromPlaces = given.every(({ position }) => position === undefined);
  const gridded: GridStage[] = given.every(({ routes }) => routes === undefined)
    ? straightLineFlow(given)
    : given.map((stage, index) => ({
        ...stage,
        routes: stage.routes ?? [],
        place: stage.place ?? { column: index, row: 0 },
      }));
  // The conflict chain it draws in are Stages of their own kinds; the others keep their fields.
  const drawn = withPublishStages(withRoutesBack(gridded));
  const positioned = fromPlaces
    ? positionedByPlaces(withRouteLimits(inPlaceOrder(drawn)))
    : withFilledPositions(withRouteLimits(drawn));
  // A place is only written for the previous release (`withPlacesForThePreviousRelease`).
  return positioned.map(({ place: _place, ...stage }) => stage) as FlowStage<Of>[];
}

/** Stages by their old places: the columns left to right, then the rows; ties keep their order. */
function inPlaceOrder<Of extends GridStage>(stages: readonly Of[]): Of[] {
  return stages.toSorted(
    (one, other) => one.place.column - other.place.column || one.place.row - other.place.row,
  );
}

function positionedByPlaces(stages: readonly GridStage[]): FlowStage[] {
  const positions = positionsFromPlaces(stages);
  return stages.map((stage, index) => ({ ...stage, position: positions[index] ?? { x: 0, y: 0 } }));
}

/**
 * `stages` with every route given without a limit taking the default for where it leads (spec
 * §2.3, "A route's limit"): at most 3 times back, to its own Stage or one before it in the
 * Pipeline's order, and No limit on. Every route kept before routes had limits led on.
 */
function withRouteLimits<Of extends GridStage>(stages: readonly Of[]): Of[] {
  const limited = limitedRoutes(stages);
  return stages.map((stage, index) => ({ ...stage, routes: limited[index] ?? [] }));
}

/** A Stage as the editor or an agent gives it, before its routes' missing limits are set. */
export type GivenStage = Given<AgentStage> | Given<ScriptStage> | Given<Gate> | Given<PublishStage>;

type Given<Of extends Stage> = Omit<Of, "routes"> & { readonly routes?: readonly GivenRoute[] };

/**
 * Stages as given, in the Pipeline's order, each route without a limit taking the default for where
 * it leads, as `asFlow` gives it: what an edit or a Proposal hands the domain.
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
  readonly routes?: readonly GivenRoute[];
}

function limitedRoutes(stages: readonly RoutedStage[]): (Route[] | undefined)[] {
  const order = orderIndexes(stages);
  return stages.map(({ key, routes }) => {
    const from = order.get(key) ?? 0;
    return routes?.map((route): Route => ({
      ...route,
      limit:
        route.limit === undefined ? defaultRouteLimit(leadsBack(from, route, order)) : route.limit,
    }));
  });
}

/** Each Stage's index in the Pipeline's order, its list's, by its key. */
function orderIndexes(stages: readonly { readonly key: string }[]): ReadonlyMap<string, number> {
  return new Map(stages.map(({ key }, index) => [key, index]));
}

function leadsBack(from: number, { to }: GivenRoute, order: ReadonlyMap<string, number>): boolean {
  const target = to === null ? undefined : order.get(to);
  return target !== undefined && target <= from;
}

/**
 * Whether a route from `fromKey` to `toKey` leads back (spec §2.3, "The Pipeline's order"): to its
 * own Stage or one before it among `stages` in the Pipeline's order. End never is. Where Stages
 * stand never changes it.
 */
export function isRouteBack(
  stages: readonly { readonly key: string }[],
  fromKey: string,
  toKey: string | null,
): boolean {
  const order = orderIndexes(stages);
  const from = order.get(fromKey);
  return from !== undefined && leadsBack(from, { to: toKey, condition: null }, order);
}

/**
 * A flow an agent proposed, ready to be judged and kept: `asFlow`'s, in the order given, a Stage
 * left without a position standing beside the one before it, and every route naming the Stages it
 * leads to and tests by their names among `stages`.
 */
export function namedFlow(stages: readonly Stage[]): FlowStage[] {
  const names = new Map(stages.map(({ key, name }) => [key, name]));
  return asFlow(stages).map((stage) => ({ ...stage, routes: namedRoutes(stage.routes, names) }));
}

/**
 * `stages` as kept, in the Pipeline's order, each with `place: { column: index, row: 0 }` beside
 * its position, so the previous release, which reads the order from places, sees the same order
 * and walks the same flow after a rollback.
 */
export function withPlacesForThePreviousRelease<Of extends FlowStage>(stages: readonly Of[]): Of[] {
  return stages.map((stage, index) => ({ ...stage, place: { column: index, row: 0 } }));
}

/** A Stage without where it stands on the canvas, as rules that never read layout compare it. */
export function withoutLayout<Of extends Stage>({
  position: _position,
  place: _place,
  ...stage
}: Of): Omit<Of, "position" | "place"> {
  return stage;
}

/**
 * A Proposal's Stages as applying it keeps them (spec §2.3.5, "Proposals"): each Stage it adds or
 * moves from where it stood when drafted (`from`) stands where the Proposal puts it (`to`), and every
 * other where it stands `now`, as positions are layout and the user may have moved Stages since.
 */
export function withProposedPositions(
  now: readonly Stage[],
  from: readonly Stage[],
  to: readonly Stage[],
): FlowStage[] {
  const drafted = new Map(asFlow(from).map(({ key, position }) => [key, position]));
  const standing = new Map(asFlow(now).map(({ key, position }) => [key, position]));
  return asFlow(to).map((stage) => {
    const stands = standing.get(stage.key);
    return stands && samePosition(drafted.get(stage.key), stage.position)
      ? { ...stage, position: stands }
      : stage;
  });
}

/**
 * Where End stands once a Proposal is applied: where the Proposal puts it (`to`) when that moves it
 * from where it stood when drafted (`from`), else where it stands `now`.
 */
export function proposedEndPosition(
  now: StagePosition | undefined,
  from: StagePosition | undefined,
  to: StagePosition | undefined,
): StagePosition | undefined {
  return to === undefined || samePosition(from, to) ? now : to;
}

function samePosition(one: StagePosition | undefined, other: StagePosition): boolean {
  return one !== undefined && one.x === other.x && one.y === other.y;
}

/** Whether `stages` are a straight line as `straightLineFlow` draws them, so a list can edit them. */
export function isStraightLine(stages: readonly FlowStage[]): boolean {
  return stages.every(
    (stage, index) =>
      stage.routes.length === 1 &&
      stage.routes[0]?.condition === null &&
      stage.routes[0].to === (stages[index + 1]?.key ?? null),
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
