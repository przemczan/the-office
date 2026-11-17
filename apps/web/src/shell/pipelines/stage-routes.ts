import type { Route, Stage } from "@the-office/contracts";
import { removeStage, type AddedStage } from "./stage-edits.ts";

/**
 * The routes and places the list editor keeps on a list of Stages (spec §2.3), until the flow
 * editor comes. On a straight line each Stage has one route that always holds, to the Stage after
 * it, the last to End, and stands in its own column on row 0, in order: the list editor derives
 * them again after each change. Any other flow (for now only a converted optional Stage makes one,
 * with a Definition of Done condition) keeps its routes and places, and its order can't change.
 */

/**
 * Whether the Stages are a straight line, by their routes alone, as those give the columns. A Stage
 * with no routes yet, such as one from a Stage template or a new Pipeline's, fits any line.
 */
export function isStraightLine(stages: readonly Stage[]): boolean {
  return stages.every(
    (stage, index) => stage.routes === undefined || isStraightRoute(stage, nextKey(stages, index)),
  );
}

/** The Stages as a straight line in their order, each route and place kept where it already is one. */
export function straightLine(stages: readonly Stage[]): readonly Stage[] {
  return stages.map((stage, index) => {
    const to = nextKey(stages, index);
    const routes: Route[] =
      stage.routes && isStraightRoute(stage, to) ? stage.routes : [{ to, condition: null }];
    const place =
      stage.place?.column === index && stage.place.row === 0
        ? stage.place
        : { column: index, row: 0 };
    return { ...stage, routes, place };
  });
}

/**
 * The Stages with `added`'s new Stage among them. On a straight line the line is derived again; on
 * any other flow the new Stage goes after the last, in a column of its own, and every route to End
 * leads to it, as it leads to End.
 */
export function addToFlow(stages: readonly Stage[], added: AddedStage): AddedStage {
  if (isStraightLine(stages)) return { stages: straightLine(added.stages), index: added.index };
  const stage = added.stages[added.index];
  if (!stage) return added;
  const column = Math.max(-1, ...stages.map(({ place }) => place?.column ?? -1)) + 1;
  const last: Stage = {
    ...stage,
    routes: [{ to: null, condition: null }],
    place: { column, row: 0 },
  };
  return {
    stages: [...stages.map((other) => redirected(other, null, stage.key)), last],
    index: stages.length,
  };
}

/**
 * The Stages without the one at `index`. On a straight line the line is derived again; on any other
 * flow every route into it leads where its route out led, the one that always holds when it has
 * one, every other route and place kept, and a flow that is a straight line then is derived again.
 */
export function removeFromFlow(stages: readonly Stage[], index: number): readonly Stage[] {
  const gone = stages[index];
  const after = removeStage(stages, index);
  if (!gone || isStraightLine(stages)) return straightLine(after);
  const out = gone.routes?.find(({ condition }) => condition === null) ?? gone.routes?.at(-1);
  const flow = after.map((stage) => redirected(stage, gone.key, out?.to ?? null));
  return isStraightLine(flow) ? straightLine(flow) : flow;
}

function isStraightRoute(stage: Stage, to: string | null): boolean {
  const [route, ...more] = stage.routes ?? [];
  return route !== undefined && more.length === 0 && route.to === to && route.condition === null;
}

function nextKey(stages: readonly Stage[], index: number): string | null {
  return stages[index + 1]?.key ?? null;
}

/**
 * The Stage with every route to `from` (a Stage's key, or null for End) leading to `to`, less any
 * route the one after it makes needless: one that always holds and leads to the same place.
 */
function redirected(stage: Stage, from: string | null, to: string | null): Stage {
  if (!stage.routes?.some((route) => route.to === from)) return stage;
  const routes = stage.routes
    .map((route): Route => {
      if (route.to !== from) return route;
      // Its old name is no longer the name of where it leads.
      const { toName: _toName, ...kept } = route;
      return { ...kept, to };
    })
    .reduceRight<Route[]>((later, route) => {
      const next = later[0];
      return next?.condition === null && next.to === route.to ? later : [route, ...later];
    }, []);
  return { ...stage, routes };
}
