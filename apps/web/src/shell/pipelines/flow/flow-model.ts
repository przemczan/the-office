import type { ConditionGroup, Route, Stage, StagePlace } from "@the-office/contracts";
import { namedAmong, removeStage } from "../stage-edits.ts";

/**
 * The flow editor's edits of a Pipeline's Stages (docs/design/pipeline-flow.html), each answering
 * the new Stages. A Stage's place gives the Pipeline's order: columns left to right, then rows top to
 * bottom. After an edit that moves places, the Stages come back in that order with empty columns and
 * rows closed up. What makes a flow unusable (a route leading back, a Stage no route reaches) is the
 * service's check to say, so these never refuse an edit for it: the check names it, in words.
 *
 * A Task's started Stages are locked (`LockedStages`): no edit moves one, and the columns up to the
 * last holding one are frozen, so none is made or closed up there and the locked Stages keep their
 * places. What still breaks a lock, such as a Stage put on a locked Stage's route, the check names.
 */

export type MoveDirection = "earlier" | "later" | "up" | "down";

/** Where a dragged Stage is dropped: a cell, or with `newColumn` a new column put in at `column`. */
export interface FlowDrop {
  readonly column: number;
  readonly row: number;
  readonly newColumn: boolean;
}

/** The Stages after an addition, and the added Stage's key, which the editor then picks. */
export interface StageAddedToFlow {
  readonly stages: readonly Stage[];
  readonly key: string;
}

/** A Stage's routes after a route is drawn, and the drawn route's index, which is then picked. */
export interface RoutesDrawn {
  readonly routes: readonly Route[];
  readonly routeIndex: number;
}

/** The Stages after a route is drawn, and the drawn route's index among its Stage's routes. */
export interface RouteDrawn {
  readonly stages: readonly Stage[];
  readonly routeIndex: number;
}

/** The keys of a Task's started Stages, which stay where they are: a Set, or a Map by key. */
export type LockedStages = Pick<ReadonlySet<string>, "has">;

export const NOTHING_LOCKED: LockedStages = new Set<string>();

/** A Stage with no place yet sorts after every placed one; only `asFlow` gives it one. */
const UNPLACED: StagePlace = { column: Number.MAX_SAFE_INTEGER, row: 0 };

/**
 * The condition a route drawn beside others starts with: none of its tests yet, so its panel opens
 * on it and flow-checks says it still needs one, rather than it holding always and hiding the rest.
 */
const UNSET_CONDITION: ConditionGroup = { combine: "all", tests: [] };

export function stageNamed(stages: readonly Stage[], key: string): Stage | undefined {
  return stages.find((stage) => stage.key === key);
}

export function inFlowOrder(stages: readonly Stage[]): readonly Stage[] {
  return stages.toSorted(byPlace);
}

/**
 * The Stages as a flow, each given what it lacks: a Stage with no place (a new Pipeline's, one from
 * a Stage template) a column of its own after the last, and one with no routes a route that always
 * holds to the next Stage in order, the last to End.
 */
export function asFlow(stages: readonly Stage[]): readonly Stage[] {
  let column = lastColumn(stages);
  const placed = stages.map((stage) => {
    if (stage.place) return stage;
    column += 1;
    return { ...stage, place: { column, row: 0 } };
  });
  const order = inFlowOrder(placed);
  return closedUp(
    order.map((stage, index) =>
      stage.routes ? stage : { ...stage, routes: [{ to: nextKey(order, index), condition: null }] },
    ),
  );
}

/**
 * The Stages as they are when each has its place and routes, else as `asFlow` gives them: a flow
 * already whole isn't closed up, so a Task's started Stages keep the places the service has.
 */
export function asWholeFlow(stages: readonly Stage[]): readonly Stage[] {
  return stages.every(({ place, routes }) => place && routes) ? stages : asFlow(stages);
}

/**
 * The Stages with `stage` added, a name and key no other has, unconnected: in a column of its own
 * right after the picked Stage's, a row below it, or with none picked after the last, on row 0.
 */
export function withStageAdded(
  stages: readonly Stage[],
  stage: Stage,
  afterKey: string | undefined,
  locked: LockedStages = NOTHING_LOCKED,
): StageAddedToFlow {
  const picked = afterKey === undefined ? undefined : stageNamed(stages, afterKey);
  const column = picked ? placeOf(picked).column + 1 : lastColumn(stages) + 1;
  const place = {
    column: Math.max(column, frozenColumns(stages, locked)),
    row: picked ? placeOf(picked).row + 1 : 0,
  };
  const added: Stage = { ...namedAmong(stage, stages), routes: [], place };
  return {
    stages: closedUp([...shiftedFrom(stages, place.column), added], locked),
    key: added.key,
  };
}

/**
 * How many columns, from the first, are frozen: up to the last holding a locked Stage, none when
 * none is locked.
 */
export function frozenColumns(stages: readonly Stage[], locked: LockedStages): number {
  return Math.max(
    0,
    ...stages.flatMap((stage) => (locked.has(stage.key) ? [placeOf(stage).column + 1] : [])),
  );
}

/**
 * Whether Move earlier, later, up or down would change the flow: not for a Stage alone in the first
 * or last column, on the top row, or the only one in the bottom row.
 */
export function canMoveStage(
  stages: readonly Stage[],
  key: string,
  direction: MoveDirection,
  locked: LockedStages = NOTHING_LOCKED,
): boolean {
  return !samePlaces(stages, withStageMoved(stages, key, direction, locked));
}

/**
 * The Stages with one moved a step without dragging. Alone in its column, earlier and later swap its
 * column with the neighbouring one, so a straight line keeps a Stage a column; sharing its column,
 * it goes into the neighbouring column (a new first one before the first). Up and down swap it
 * with the Stage on the neighbouring row of its column, if any. A locked Stage stays, and so does a
 * frozen column.
 */
export function withStageMoved(
  stages: readonly Stage[],
  key: string,
  direction: MoveDirection,
  locked: LockedStages = NOTHING_LOCKED,
): readonly Stage[] {
  const stage = stageNamed(stages, key);
  if (!stage || locked.has(key)) return stages;
  const { column, row } = placeOf(stage);
  switch (direction) {
    case "up":
      return row === 0 ? stages : withRowSwapped(stages, stage, row - 1, locked);
    case "down":
      return withRowSwapped(stages, stage, row + 1, locked);
    case "earlier":
    case "later": {
      const to = direction === "earlier" ? column - 1 : column + 1;
      if (isAlone(stages, stage)) return withColumnsSwapped(stages, column, to, locked);
      return to < 0
        ? withStageDropped(stages, key, { column: 0, row, newColumn: true }, locked)
        : withStageDropped(stages, key, { column: to, row, newColumn: false }, locked);
    }
  }
}

/**
 * The Stages with one dropped where it was dragged: into the cell, or the first free row below it
 * in that column, or with `newColumn` into a new column at `column`, later columns shifting right.
 * A locked Stage stays, and no new column goes in among the frozen ones (`canDropAt`).
 */
export function withStageDropped(
  stages: readonly Stage[],
  key: string,
  drop: FlowDrop,
  locked: LockedStages = NOTHING_LOCKED,
): readonly Stage[] {
  const { column, row, newColumn } = drop;
  const moving = stageNamed(stages, key);
  if (!moving || locked.has(key) || !canDropAt(stages, drop, locked)) return stages;
  const at = Math.max(0, column);
  const others = stages.filter((stage) => stage !== moving);
  const around = newColumn ? shiftedFrom(others, at) : others;
  let free = Math.max(0, row);
  while (around.some((stage) => samePlace(placeOf(stage), { column: at, row: free }))) free += 1;
  return closedUp([...around, placedAt(moving, { column: at, row: free })], locked);
}

/** Whether a drop is offered: anywhere but a new column before the last frozen one. */
export function canDropAt(stages: readonly Stage[], drop: FlowDrop, locked: LockedStages): boolean {
  return !drop.newColumn || drop.column >= frozenColumns(stages, locked);
}

/** The key of the Stage before (-1) or after (1) `key` in the Pipeline's order, if any. */
export function stepInOrder(stages: readonly Stage[], key: string, by: -1 | 1): string | undefined {
  const order = inFlowOrder(stages);
  const index = order.findIndex((stage) => stage.key === key);
  return index < 0 ? undefined : order[index + by]?.key;
}

/** The Stages in columns strictly before `key`'s, in the Pipeline's order. */
export function earlierStages(stages: readonly Stage[], key: string): readonly Stage[] {
  return byColumn(stages, key, (column, own) => column < own);
}

/** The Stages in columns strictly after `key`'s, in the Pipeline's order: where a route may lead. */
export function laterStages(stages: readonly Stage[], key: string): readonly Stage[] {
  return byColumn(stages, key, (column, own) => column > own);
}

/** The Stages a failure of `key` may go back to: earlier columns' Stages that work, not Gates. */
export function flowFailureTargets(stages: readonly Stage[], key: string): readonly Stage[] {
  return earlierStages(stages, key).filter((stage) => stage.kind !== "gate");
}

/**
 * The routes with one drawn to `to` (a Stage's key, or null for End). The first route needs no
 * condition; a later one goes in before the first route with none, as that one always holds and
 * must go last, with a condition still to set. A route to where one already leads is that one.
 */
export function routesWithDrawn(routes: readonly Route[], to: string | null): RoutesDrawn {
  const existing = routes.findIndex((route) => route.to === to);
  if (existing >= 0) return { routes, routeIndex: existing };
  if (routes.length === 0) return { routes: [{ to, condition: null }], routeIndex: 0 };
  const open = routes.findIndex((route) => route.condition === null);
  const routeIndex = open >= 0 ? open : routes.length;
  return {
    routes: routes.toSpliced(routeIndex, 0, { to, condition: UNSET_CONDITION }),
    routeIndex,
  };
}

export function routesWithout(routes: readonly Route[], index: number): readonly Route[] {
  return index >= 0 && index < routes.length ? routes.toSpliced(index, 1) : routes;
}

/** Whether the route can move a step in the order its Stage's routes are weighed. */
export function canMoveRouteAmong(routes: readonly Route[], index: number, by: -1 | 1): boolean {
  return index >= 0 && index < routes.length && index + by >= 0 && index + by < routes.length;
}

export function routesMoved(routes: readonly Route[], index: number, by: -1 | 1): readonly Route[] {
  const route = routes[index];
  const other = routes[index + by];
  if (!route || !other) return routes;
  return routes.with(index, other).with(index + by, route);
}

/** The route leading to `to` instead; its saved name was the old target's, so it goes. */
export function routesWithTarget(
  routes: readonly Route[],
  index: number,
  to: string | null,
): readonly Route[] {
  const route = routes[index];
  return route ? routes.with(index, { ...withoutToName(route), to }) : routes;
}

export function routesWithCondition(
  routes: readonly Route[],
  index: number,
  condition: ConditionGroup | null,
): readonly Route[] {
  const route = routes[index];
  return route ? routes.with(index, { ...route, condition }) : routes;
}

/**
 * The Stages with a route drawn from `fromKey` to `to`, as `routesWithDrawn` draws it. A route
 * leading back is drawn too, for the check to say why it can't stay. The index is -1 when no Stage
 * has the key.
 */
export function withRouteDrawn(
  stages: readonly Stage[],
  fromKey: string,
  to: string | null,
): RouteDrawn {
  const from = stageNamed(stages, fromKey);
  if (!from) return { stages, routeIndex: -1 };
  const drawn = routesWithDrawn(from.routes ?? [], to);
  return { stages: withRoutes(stages, fromKey, () => drawn.routes), routeIndex: drawn.routeIndex };
}

export function withRouteRemoved(
  stages: readonly Stage[],
  key: string,
  routeIndex: number,
): readonly Stage[] {
  return withRoutes(stages, key, (routes) => routesWithout(routes, routeIndex));
}

export function canMoveRoute(
  stages: readonly Stage[],
  key: string,
  routeIndex: number,
  by: -1 | 1,
): boolean {
  return canMoveRouteAmong(stageNamed(stages, key)?.routes ?? [], routeIndex, by);
}

export function withRouteMoved(
  stages: readonly Stage[],
  key: string,
  routeIndex: number,
  by: -1 | 1,
): readonly Stage[] {
  return withRoutes(stages, key, (routes) => routesMoved(routes, routeIndex, by));
}

export function withRouteTarget(
  stages: readonly Stage[],
  key: string,
  routeIndex: number,
  to: string | null,
): readonly Stage[] {
  return withRoutes(stages, key, (routes) => routesWithTarget(routes, routeIndex, to));
}

export function withRouteCondition(
  stages: readonly Stage[],
  key: string,
  routeIndex: number,
  condition: ConditionGroup | null,
): readonly Stage[] {
  return withRoutes(stages, key, (routes) => routesWithCondition(routes, routeIndex, condition));
}

/**
 * The Stages with `stage` put on a route: the route leads to it, its condition kept, and it leads
 * on where the route led, by one route that always holds. It takes a column of its own right after
 * the route's Stage (or after the frozen ones), on its row. With no such route, nothing changes and
 * `key` stays the route's Stage's.
 */
export function withStageOnRoute(
  stages: readonly Stage[],
  key: string,
  routeIndex: number,
  stage: Stage,
  locked: LockedStages = NOTHING_LOCKED,
): StageAddedToFlow {
  const from = stageNamed(stages, key);
  const route = from?.routes?.[routeIndex];
  if (!from || !route) return { stages, key };
  const { column, row } = placeOf(from);
  const onward: Route = { ...route, condition: null };
  const at = Math.max(column + 1, frozenColumns(stages, locked));
  const added: Stage = {
    ...namedAmong(stage, stages),
    routes: [onward],
    place: { column: at, row },
  };
  const flow = withRoutes(shiftedFrom(stages, at), key, (routes) =>
    routesWithTarget(routes, routeIndex, added.key),
  );
  return { stages: closedUp([...flow, added], locked), key: added.key };
}

/**
 * The Stages without `key`, its routes carried along: each route into it leads where its one route
 * out led, so a straight line stays one. With several
 * routes out, or none, the routes into it go, and the check says where a route is now missing.
 * Every On failure going back to it is cleared.
 */
export function withStageRemovedFromFlow(
  stages: readonly Stage[],
  key: string,
  locked: LockedStages = NOTHING_LOCKED,
): readonly Stage[] {
  const index = stages.findIndex((stage) => stage.key === key);
  const gone = stages[index];
  if (!gone) return stages;
  const out = (gone.routes ?? []).filter((route) => route.to !== key);
  const onward = out.length === 1 ? out[0] : undefined;
  return closedUp(
    removeStage(stages, index).map((stage) =>
      stage.routes?.some((route) => route.to === key)
        ? { ...stage, routes: [...carried(stage.routes, key, onward)] }
        : stage,
    ),
    locked,
  );
}

/** Every route to `key` leading where `onward` leads, or gone with none, less any made needless. */
function carried(routes: readonly Route[], key: string, onward: Route | undefined): Route[] {
  return withoutNeedless(
    routes.flatMap((route): Route[] => {
      if (route.to !== key) return [route];
      if (!onward) return [];
      const { toName } = onward;
      return [
        { ...withoutToName(route), to: onward.to, ...(toName === undefined ? {} : { toName }) },
      ];
    }),
  );
}

/** The routes less any just before a route that always holds and leads to the same place. */
function withoutNeedless(routes: readonly Route[]): Route[] {
  return routes.reduceRight<Route[]>((later, route) => {
    const next = later[0];
    return next?.condition === null && next.to === route.to ? later : [route, ...later];
  }, []);
}

function withoutToName(route: Route): Route {
  const { toName: _toName, ...rest } = route;
  return rest;
}

function withRoutes(
  stages: readonly Stage[],
  key: string,
  edit: (routes: readonly Route[]) => readonly Route[],
): readonly Stage[] {
  return stages.map((stage) =>
    stage.key === key ? { ...stage, routes: [...edit(stage.routes ?? [])] } : stage,
  );
}

function withRowSwapped(
  stages: readonly Stage[],
  stage: Stage,
  row: number,
  locked: LockedStages,
): readonly Stage[] {
  const { column, row: own } = placeOf(stage);
  const there = stages.find((other) => samePlace(placeOf(other), { column, row }));
  if (there && locked.has(there.key)) return stages;
  return closedUp(
    stages.map((other) => {
      if (other === stage) return placedAt(other, { column, row });
      return samePlace(placeOf(other), { column, row })
        ? placedAt(other, { column, row: own })
        : other;
    }),
    locked,
  );
}

function withColumnsSwapped(
  stages: readonly Stage[],
  one: number,
  other: number,
  locked: LockedStages,
): readonly Stage[] {
  const first = Math.min(one, other);
  if (first < frozenColumns(stages, locked) || Math.max(one, other) > lastColumn(stages))
    return stages;
  return closedUp(
    stages.map((stage) => {
      const { column, row } = placeOf(stage);
      if (column === one) return placedAt(stage, { column: other, row });
      if (column === other) return placedAt(stage, { column: one, row });
      return stage;
    }),
    locked,
  );
}

function isAlone(stages: readonly Stage[], stage: Stage): boolean {
  const { column } = placeOf(stage);
  return !stages.some((other) => other !== stage && placeOf(other).column === column);
}

/** The Stages with every column from `column` on moved one to the right, making room there. */
function shiftedFrom(stages: readonly Stage[], column: number): readonly Stage[] {
  return stages.map((stage) => {
    const place = placeOf(stage);
    return place.column >= column ? placedAt(stage, { ...place, column: place.column + 1 }) : stage;
  });
}

function byColumn(
  stages: readonly Stage[],
  key: string,
  keeps: (column: number, own: number) => boolean,
): readonly Stage[] {
  const stage = stageNamed(stages, key);
  if (!stage) return [];
  const own = placeOf(stage).column;
  return inFlowOrder(stages).filter((other) => keeps(placeOf(other).column, own));
}

/**
 * The Stages in the Pipeline's order with the columns and rows no Stage stands in closed up, each
 * numbered from 0. Rows close up across the flow, not column by column, so a Stage put a row below
 * another stays below it. The frozen columns, and the rows a Stage in them stands in, stay as they
 * are, so the locked Stages keep their places.
 */
function closedUp(
  stages: readonly Stage[],
  locked: LockedStages = NOTHING_LOCKED,
): readonly Stage[] {
  const frozen = frozenColumns(stages, locked);
  const frozenRows = new Set(
    stages.flatMap((stage) => (placeOf(stage).column < frozen ? [placeOf(stage).row] : [])),
  );
  const columns = closing(
    stages.map((stage) => placeOf(stage).column),
    (column) => column < frozen,
  );
  const rows = closing(
    stages.map((stage) => placeOf(stage).row),
    (row) => frozenRows.has(row),
  );
  return inFlowOrder(
    stages.map((stage) => {
      const { column, row } = placeOf(stage);
      return placedAt(stage, { column: columns.get(column) ?? column, row: rows.get(row) ?? row });
    }),
  );
}

/**
 * Each of `numbers` renumbered from 0 with the gaps closed, but a `kept` one staying as it is; as
 * a number never grows by it, the order holds and none takes a kept one's.
 */
function closing(
  numbers: readonly number[],
  kept: (number: number) => boolean,
): ReadonlyMap<number, number> {
  const renumbered = new Map<number, number>();
  let previous = -1;
  for (const number of [...new Set(numbers)].toSorted((one, other) => one - other)) {
    previous = kept(number) ? number : previous + 1;
    renumbered.set(number, previous);
  }
  return renumbered;
}

function placeOf(stage: Stage): StagePlace {
  return stage.place ?? UNPLACED;
}

function placedAt(stage: Stage, place: StagePlace): Stage {
  return stage.place && samePlace(stage.place, place) ? stage : { ...stage, place };
}

function samePlace(one: StagePlace, other: StagePlace): boolean {
  return one.column === other.column && one.row === other.row;
}

function samePlaces(one: readonly Stage[], other: readonly Stage[]): boolean {
  if (one === other) return true;
  return one.every((stage) => {
    const moved = stageNamed(other, stage.key);
    return moved !== undefined && samePlace(placeOf(stage), placeOf(moved));
  });
}

function lastColumn(stages: readonly Stage[]): number {
  return Math.max(-1, ...stages.flatMap(({ place }) => (place ? [place.column] : [])));
}

function byPlace(one: Stage, other: Stage): number {
  const a = placeOf(one);
  const b = placeOf(other);
  return a.column - b.column || a.row - b.row;
}

function nextKey(order: readonly Stage[], index: number): string | null {
  return order[index + 1]?.key ?? null;
}
