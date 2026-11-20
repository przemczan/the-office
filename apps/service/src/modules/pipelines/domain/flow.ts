import { namedRoutes, plainRoute, type Route, type StagePlace } from "./route.js";
import type { Stage } from "./stage.js";

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
    { to: next.key, condition: WHILE_SOME_NOT_MET },
    plainRoute(firstNotOptional?.key ?? null),
  ];
}

/**
 * `stages` as a flow: converted by `straightLineFlow` when none carries routes, as a row a
 * rolled-back release rewrote or a Proposal still sending a plain list gives them; otherwise as they
 * are, a Stage missing its routes getting none (which the check refuses) and one missing its place
 * its index's column on row 0.
 */
export function asFlow<Of extends Stage>(stages: readonly Of[]): FlowStage<Of>[] {
  if (stages.every(({ routes }) => routes === undefined)) return straightLineFlow(stages);
  return stages.map((stage, index) => ({
    ...stage,
    routes: stage.routes ?? [],
    place: stage.place ?? { column: index, row: 0 },
  }));
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

/** Whether a path of routes leads from the Stage `fromKey` to the Stage `toKey`. */
export function hasPath(stages: readonly FlowStage[], fromKey: string, toKey: string): boolean {
  return reachableFrom(stages, fromKey).has(toKey);
}
