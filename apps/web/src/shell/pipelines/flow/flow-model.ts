import {
  publishResultSchema,
  type ConditionGroup,
  type PublishResult,
  type Route,
  type RouteLimit,
  type Stage,
  type StagePosition,
} from "@the-office/contracts";
import { namedAmong, removeStage } from "../stage-edits.ts";
import { isGroup } from "./condition-edits.ts";
import type { FlowBox } from "./flow-layout.ts";
import {
  CARD_WIDTH,
  estimatedBox,
  estimatedCardHeight,
  freeSpotBeside,
  STAGE_GAP,
} from "./flow-snap.ts";

/**
 * The flow editor's edits of a Pipeline's Stages (docs/design/pipeline-flow.html,
 * docs/design/pipeline-free-placement.html), each answering the new Stages. The Pipeline's order is
 * the order of the Stages' list: the first is where every walk starts, and a route to its own Stage
 * or an earlier one leads back. A Stage's position is layout alone: moving a Stage never changes the
 * order, and Move earlier and Move later never move it on the canvas. What makes a flow unusable (a
 * loop with no limit, a Stage no route reaches) is the service's check to say, so these never
 * refuse an edit for it: the check names it, in words.
 *
 * Every route has its limit (spec §2.3, "A route's limit"): one these make leading back starts at
 * `ROUTE_BACK_LIMIT`, one leading on at No limit. Moving a Stage keeps every limit.
 *
 * A Task's started Stages are locked (`LockedStages`): no edit changes one, and the order up to the
 * last started Stage is frozen, so no Stage is added among those or moved into them. Their positions
 * are never locked. What still breaks a lock, such as a Stage put on a locked Stage's route, the
 * check names.
 */

/** The limit a route leading back starts at: at most 3 times. */
export const ROUTE_BACK_LIMIT = 3;

/** An Agent Stage's When it fails: the built-in "the previous Stage ended Failed" on its own. */
export const FAILED_CONDITION: ConditionGroup = {
  combine: "all",
  tests: [{ kind: "stage", stage: null, is: "failed" }],
};

/** A Publish Stage's results, in the order When it ends… lists them (spec §2.3.4). */
export const PUBLISH_RESULTS: readonly PublishResult[] = publishResultSchema.options;

/**
 * The forms of a row of Routes out (spec §2.3, "The route forms"): When it fails and The Agent
 * chooses it, an Agent Stage's alone; When these hold; When it ends…, a Publish Stage's, naming its
 * results; and Otherwise, with no condition.
 */
export type RouteForm = "fails" | "chooses" | "holds" | "ends" | "otherwise";

/** The forms that keep the order the user sets, between When it fails and Otherwise. */
type OrderedForm = "chooses" | "holds" | "ends";

/** Move earlier and Move later: a step in the Pipeline's order. */
export type MoveDirection = "earlier" | "later";

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

/** The keys of a Task's started Stages, which stay as they are: a Set, or a Map by key. */
export type LockedStages = Pick<ReadonlySet<string>, "has">;

export const NOTHING_LOCKED: LockedStages = new Set<string>();

/**
 * The condition a route drawn beside others starts with: none of its tests yet, so its panel opens
 * on it and flow-checks says it still needs one, rather than it holding always and hiding the rest.
 */
const UNSET_CONDITION: ConditionGroup = { combine: "all", tests: [] };

export function stageNamed(stages: readonly Stage[], key: string): Stage | undefined {
  return stages.find((stage) => stage.key === key);
}

/**
 * The Stages as a flow, each given what it lacks, in their order: one with no routes a route that
 * always holds to the next Stage, the last to End; one with no position (a new Pipeline's, a plain
 * list's) a position by `withFilledPositions`. A list from before positions, where none has one but
 * they have places (a Proposal stored before the update), is first sorted by its places and each
 * place made a position, as the service converts them (`fromPlaces`).
 */
export function asFlow(stages: readonly Stage[]): readonly Stage[] {
  const ordered = fromPlaces(stages);
  return withFilledPositions(
    ordered.map((stage, index) =>
      stage.routes
        ? stage
        : {
            ...stage,
            routes: [{ to: ordered[index + 1]?.key ?? null, condition: null, limit: null }],
          },
    ),
  );
}

/** From one column of the old grid to the next: a card and the gap beside it. */
const COLUMN_PITCH = CARD_WIDTH + STAGE_GAP;
/** Between two rows of the old grid. */
const ROW_GAP = 22;

/**
 * A list from before positions in the order its places gave (columns, then rows; ties keep their
 * order), each place a position on the old grid: its column's x, and below the rows above it, each
 * as tall as its tallest card, 22 apart. Any other list as it is.
 */
function fromPlaces(stages: readonly Stage[]): readonly Stage[] {
  if (stages.some(({ position }) => position) || !stages.some(({ place }) => place)) return stages;
  const placed = stages.map((stage, index) => ({
    stage,
    place: stage.place ?? { column: index, row: 0 },
  }));
  const rowHeights = new Map<number, number>();
  for (const { stage, place } of placed) {
    rowHeights.set(place.row, Math.max(rowHeights.get(place.row) ?? 0, estimatedCardHeight(stage)));
  }
  return placed
    .toSorted(
      (one, other) => one.place.column - other.place.column || one.place.row - other.place.row,
    )
    .map(({ stage, place }) => {
      let y = 0;
      for (let row = 0; row < place.row; row += 1) y += (rowHeights.get(row) ?? 0) + ROW_GAP;
      return { ...stage, position: { x: place.column * COLUMN_PITCH, y } };
    });
}

/**
 * Each Stage with no position placed as the service places it (spec §2.3, "A Stage's position"): 76
 * right of the Stage before it, at its y, moving down by the grid's step until it covers no card by
 * the estimated heights. With none placed, the Stages stand in one row in their order.
 */
function withFilledPositions(stages: readonly Stage[]): readonly Stage[] {
  const boxes: FlowBox[] = stages.flatMap((stage) =>
    stage.position ? [estimatedBox(stage.position, stage)] : [],
  );
  const placed: Stage[] = [];
  for (const stage of stages) {
    if (stage.position) {
      placed.push(stage);
      continue;
    }
    const position = freeSpotBeside(
      boxOf(placed.at(-1)),
      estimatedBox({ x: 0, y: 0 }, stage),
      boxes,
    );
    boxes.push(estimatedBox(position, stage));
    placed.push({ ...stage, position });
  }
  return placed;
}

/** A Stage's box by its estimated height, at its position. */
function boxOf(stage: Stage | undefined): FlowBox | undefined {
  return stage?.position && estimatedBox(stage.position, stage);
}

/**
 * The Stages with `stage` added, a name and key no other has, unconnected: right after the picked
 * Stage in the order, or last with none picked, never among a Task's frozen Stages; on the canvas
 * beside the Stage before it.
 */
export function withStageAdded(
  stages: readonly Stage[],
  stage: Stage,
  afterKey: string | undefined,
  locked: LockedStages = NOTHING_LOCKED,
): StageAddedToFlow {
  const picked = afterKey === undefined ? -1 : stages.findIndex(({ key }) => key === afterKey);
  const at = Math.max(picked >= 0 ? picked + 1 : stages.length, frozenStages(stages, locked));
  const added = placedBeside(stages, { ...namedAmong(stage, stages), routes: [] }, stages[at - 1]);
  return { stages: stages.toSpliced(at, 0, added), key: added.key };
}

/** The Stage positioned beside `before` as a Stage with no position stands, clear of every card. */
function placedBeside(stages: readonly Stage[], stage: Stage, before: Stage | undefined): Stage {
  const boxes = stages.flatMap((each) => boxOf(each) ?? []);
  const position = freeSpotBeside(boxOf(before), estimatedBox({ x: 0, y: 0 }, stage), boxes);
  return { ...stage, position };
}

/**
 * How many Stages, from the first, are frozen in the order: up to the last locked one, none when
 * none is locked.
 */
export function frozenStages(stages: readonly Stage[], locked: LockedStages): number {
  return stages.findLastIndex(({ key }) => locked.has(key)) + 1;
}

/**
 * Whether Move earlier or Move later would change the order: not for the first or the last, a
 * locked Stage, or one that would go among a Task's frozen Stages.
 */
export function canMoveStage(
  stages: readonly Stage[],
  key: string,
  direction: MoveDirection,
  locked: LockedStages = NOTHING_LOCKED,
): boolean {
  return withStageMoved(stages, key, direction, locked) !== stages;
}

/**
 * The Stages with one swapped with the Stage before or after it in the order. Positions stay as
 * they are: the order is the list's.
 */
export function withStageMoved(
  stages: readonly Stage[],
  key: string,
  direction: MoveDirection,
  locked: LockedStages = NOTHING_LOCKED,
): readonly Stage[] {
  const index = stages.findIndex((stage) => stage.key === key);
  const to = direction === "earlier" ? index - 1 : index + 1;
  const stage = stages[index];
  const other = stages[to];
  if (!stage || !other || locked.has(key)) return stages;
  if (Math.min(index, to) < frozenStages(stages, locked)) return stages;
  return stages.with(index, other).with(to, stage);
}

/** The Stages with `key` at `position`, as moved on the canvas; the order stays. */
export function withStagePositioned(
  stages: readonly Stage[],
  key: string,
  position: StagePosition,
): readonly Stage[] {
  return stages.map((stage) => (stage.key === key ? { ...stage, position } : stage));
}

/** Every Stage's position by key, and End's (undefined where End has none of its own). */
export interface FlowPositions {
  readonly stages: ReadonlyMap<string, StagePosition>;
  readonly end: StagePosition | undefined;
}

/** Where the Stages and End stand now, as Auto-align's Undo puts them back. */
export function positionsOf(
  stages: readonly Stage[],
  end: StagePosition | undefined,
): FlowPositions {
  return {
    stages: new Map(stages.flatMap(({ key, position }) => (position ? [[key, position]] : []))),
    end,
  };
}

/** The Stages each at its position in `positions` (Auto-align, its Undo); the order stays. */
export function withPositions(
  stages: readonly Stage[],
  positions: FlowPositions,
): readonly Stage[] {
  return stages.map((stage) => {
    const position = positions.stages.get(stage.key);
    return position ? { ...stage, position } : stage;
  });
}

/** The key of the Stage before (-1) or after (1) `key` in the Pipeline's order, if any. */
export function stepInOrder(stages: readonly Stage[], key: string, by: -1 | 1): string | undefined {
  const index = stages.findIndex((stage) => stage.key === key);
  return index < 0 ? undefined : stages[index + by]?.key;
}

/** The Stages after `key` in the Pipeline's order: where a route leads on. */
export function laterStages(stages: readonly Stage[], key: string): readonly Stage[] {
  const index = stages.findIndex((stage) => stage.key === key);
  return index < 0 ? [] : stages.slice(index + 1);
}

/**
 * Whether a route from `fromKey` to `to` leads back: to its own Stage, or one before it in the
 * Pipeline's order. A route to End, or to a Stage the flow doesn't have, leads on.
 */
export function isRouteBack(stages: readonly Stage[], fromKey: string, to: string | null): boolean {
  if (to === null) return false;
  if (to === fromKey) return true;
  const from = stages.findIndex(({ key }) => key === fromKey);
  const target = stages.findIndex(({ key }) => key === to);
  return from >= 0 && target >= 0 && target < from;
}

/** The limit a route from `fromKey` to `to` starts at: 3 back, No limit on. */
export function defaultLimit(
  stages: readonly Stage[],
  fromKey: string,
  to: string | null,
): RouteLimit {
  return isRouteBack(stages, fromKey, to) ? ROUTE_BACK_LIMIT : null;
}

/** A route's limit, or, given without one, the default for where it leads. */
export function limitOf(stages: readonly Stage[], fromKey: string, route: Route): RouteLimit {
  return route.limit === undefined ? defaultLimit(stages, fromKey, route.to) : route.limit;
}

/** Whether the route's condition is "the previous Stage ended Failed" on its own. */
export function isFailureRoute({ condition }: Pick<Route, "condition">): boolean {
  const [test, ...others] = condition?.tests ?? [];
  return (
    others.length === 0 &&
    test !== undefined &&
    "kind" in test &&
    test.kind === "stage" &&
    test.stage === null &&
    test.is === "failed"
  );
}

/**
 * A choice row's condition (spec §2.3, "How an Agent chooses its route"): the Agent's choice in
 * `words`, the only test of its route.
 */
export function choiceCondition(words: string): ConditionGroup {
  return { combine: "all", tests: [{ kind: "choice", words }] };
}

/** The words of a choice row, its condition one choice test alone; undefined for any other route. */
export function choiceWordsOf({ condition }: Pick<Route, "condition">): string | undefined {
  const [test, ...others] = condition?.tests ?? [];
  if (test === undefined || others.length > 0 || isGroup(test) || test.kind !== "choice") {
    return undefined;
  }
  return test.words;
}

/**
 * The Publish Stage's results a route takes, when its condition is a When it ends… row's: each test
 * one of its own Stage's results, Failed being the "ended Failed" test. Undefined for any other
 * condition.
 */
export function endedResults({
  condition,
}: Pick<Route, "condition">): readonly PublishResult[] | undefined {
  if (condition === null) return undefined;
  const results = condition.tests.flatMap((test) =>
    !isGroup(test) && test.kind === "stage" && test.stage === null
      ? (publishResultSchema.safeParse(test.is).data ?? [])
      : [],
  );
  return results.length === condition.tests.length ? results : undefined;
}

/**
 * A When it ends… row's condition taking `results`, in the order they are listed: one alone as
 * "All of", as the service draws a Conflict route, several as "Any of", none yet as an empty group,
 * which the check asks to fill.
 */
export function endsCondition(results: readonly PublishResult[]): ConditionGroup {
  const taken = PUBLISH_RESULTS.filter((result) => results.includes(result));
  return {
    combine: taken.length > 1 ? "any" : "all",
    tests: taken.map((result) => ({ kind: "stage", stage: null, is: result })),
  };
}

/**
 * A row's form: When it fails and The Agent chooses it only on an Agent Stage, which has them apart
 * from its conditions; When it ends… only on a Publish Stage, for a condition of its results alone.
 */
export function routeFormOf(
  stage: Pick<Stage, "kind">,
  route: Pick<Route, "condition">,
): RouteForm {
  if (route.condition === null) return "otherwise";
  if (stage.kind === "publish" && endedResults(route) !== undefined) return "ends";
  if (stage.kind !== "agent") return "holds";
  if (isFailureRoute(route)) return "fails";
  return choiceWordsOf(route) === undefined ? "holds" : "chooses";
}

/**
 * The form a route drawn beside others takes on a Stage: a choice with no words yet on an Agent
 * Stage, When it ends… on a Publish Stage, When these hold on any other.
 */
function drawnForm(stage: Pick<Stage, "kind">): OrderedForm {
  if (stage.kind === "agent") return "chooses";
  return stage.kind === "publish" ? "ends" : "holds";
}

/**
 * The routes with one drawn to `to` (a Stage's key, or null for End), at `limit`. The first route
 * needs no condition; a later one goes in before the first route with none, as that one always
 * holds and must go last, with a condition still to set (of `form`: a choice with no words on an
 * Agent Stage, When it ends… on a Publish Stage). A route to where one already leads is that one.
 */
export function routesWithDrawn(
  routes: readonly Route[],
  to: string | null,
  limit: RouteLimit,
  form: OrderedForm = "holds",
): RoutesDrawn {
  const existing = routes.findIndex((route) => route.to === to);
  if (existing >= 0) return { routes, routeIndex: existing };
  if (routes.length === 0) return { routes: [{ to, condition: null, limit }], routeIndex: 0 };
  return routesWithAdded(routes, form, to, limit);
}

/**
 * The routes with a row of `form` added (Add a route): When it fails first; a choice, When these hold
 * and When it ends… before the first route with no condition, with its words or condition still to
 * set; and Otherwise last.
 */
export function routesWithAdded(
  routes: readonly Route[],
  form: RouteForm,
  to: string | null,
  limit: RouteLimit,
): RoutesDrawn {
  switch (form) {
    case "fails":
      return { routes: [{ to, condition: FAILED_CONDITION, limit }, ...routes], routeIndex: 0 };
    case "otherwise":
      return { routes: [...routes, { to, condition: null, limit }], routeIndex: routes.length };
    case "chooses":
    case "holds":
    case "ends": {
      const open = routes.findIndex((route) => route.condition === null);
      const routeIndex = open >= 0 ? open : routes.length;
      const condition =
        form === "ends"
          ? endsCondition([])
          : form === "chooses"
            ? choiceCondition("")
            : UNSET_CONDITION;
      return {
        routes: routes.toSpliced(routeIndex, 0, { to, condition, limit }),
        routeIndex,
      };
    }
  }
}

/**
 * The forms Add a route offers a Stage (docs/spec/screens/pipeline-flow-editor.md, "Routes out"): on
 * an Agent Stage The Agent chooses it, When these hold and When it fails; on a Publish Stage When it
 * ends…; on any other When these hold; then Otherwise. When it fails and Otherwise only while the
 * Stage has none.
 */
export function formsToAdd(stage: Stage): readonly RouteForm[] {
  const routes = stage.routes ?? [];
  const has = (form: RouteForm): boolean =>
    routes.some((route) => routeFormOf(stage, route) === form);
  const otherwise = has("otherwise") ? [] : (["otherwise"] as const);
  if (stage.kind === "agent") {
    return ["chooses", "holds", ...(has("fails") ? [] : (["fails"] as const)), ...otherwise];
  }
  return [drawnForm(stage), ...otherwise];
}

export function routesWithout(routes: readonly Route[], index: number): readonly Route[] {
  return index >= 0 && index < routes.length ? routes.toSpliced(index, 1) : routes;
}

/**
 * Whether the route can move a step in the order its Stage's routes are weighed: When it fails
 * stays first and Otherwise last, so neither moves and no row passes them.
 */
export function canMoveRouteAmong(
  stage: Pick<Stage, "kind">,
  routes: readonly Route[],
  index: number,
  by: -1 | 1,
): boolean {
  const route = routes[index];
  const other = routes[index + by];
  if (!route || !other) return false;
  return [route, other].every((each) => {
    const form = routeFormOf(stage, each);
    return form === "chooses" || form === "holds" || form === "ends";
  });
}

export function routesMoved(routes: readonly Route[], index: number, by: -1 | 1): readonly Route[] {
  const route = routes[index];
  const other = routes[index + by];
  if (!route || !other) return routes;
  return routes.with(index, other).with(index + by, route);
}

/**
 * The route leading to `to` instead, its limit kept; its saved name was the old target's, so it
 * goes.
 */
export function routesWithTarget(
  routes: readonly Route[],
  index: number,
  to: string | null,
): readonly Route[] {
  const route = routes[index];
  return route ? routes.with(index, { ...withoutToName(route), to }) : routes;
}

export function routesWithLimit(
  routes: readonly Route[],
  index: number,
  limit: RouteLimit,
): readonly Route[] {
  const route = routes[index];
  return route ? routes.with(index, { ...route, limit }) : routes;
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
 * The Stages with a route drawn from `fromKey` to `to`, as `routesWithDrawn` draws it, at the
 * default limit for where it leads. The index is -1 when no Stage has the key.
 */
export function withRouteDrawn(
  stages: readonly Stage[],
  fromKey: string,
  to: string | null,
): RouteDrawn {
  const from = stageNamed(stages, fromKey);
  if (!from) return { stages, routeIndex: -1 };
  const drawn = routesWithDrawn(
    from.routes ?? [],
    to,
    defaultLimit(stages, fromKey, to),
    drawnForm(from),
  );
  return { stages: withRoutes(stages, fromKey, () => drawn.routes), routeIndex: drawn.routeIndex };
}

/**
 * The Stages with a row of `form` added to `fromKey`'s routes (Add a route): to the first later
 * Stage it has no route to, or End, at the default limit for where it leads.
 */
export function withRouteAdded(
  stages: readonly Stage[],
  fromKey: string,
  form: RouteForm,
): RouteDrawn {
  const from = stageNamed(stages, fromKey);
  if (!from) return { stages, routeIndex: -1 };
  const routes = from.routes ?? [];
  const to =
    laterStages(stages, fromKey).find(({ key }) => !routes.some((route) => route.to === key))
      ?.key ?? null;
  const added = routesWithAdded(routes, form, to, defaultLimit(stages, fromKey, to));
  return { stages: withRoutes(stages, fromKey, () => added.routes), routeIndex: added.routeIndex };
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
  const stage = stageNamed(stages, key);
  return stage !== undefined && canMoveRouteAmong(stage, stage.routes ?? [], routeIndex, by);
}

export function withRouteMoved(
  stages: readonly Stage[],
  key: string,
  routeIndex: number,
  by: -1 | 1,
): readonly Stage[] {
  return withRoutes(stages, key, (routes) => routesMoved(routes, routeIndex, by));
}

/**
 * The route leading to `to` instead. Its limit stays while it leads the same way, back or on; one
 * turned from on to back, or back to on, takes the default for where it now leads.
 */
export function withRouteTarget(
  stages: readonly Stage[],
  key: string,
  routeIndex: number,
  to: string | null,
): readonly Stage[] {
  return withRoutes(stages, key, (routes) => {
    const route = routes[routeIndex];
    if (!route) return routes;
    return routesWithLimit(
      routesWithTarget(routes, routeIndex, to),
      routeIndex,
      limitLeading(stages, key, route, to),
    );
  });
}

export function withRouteLimit(
  stages: readonly Stage[],
  key: string,
  routeIndex: number,
  limit: RouteLimit,
): readonly Stage[] {
  return withRoutes(stages, key, (routes) => routesWithLimit(routes, routeIndex, limit));
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
 * The Stages with `stage` put on a route: the route leads to it, its condition and limit kept, and
 * it leads on where the route led, by one route that always holds, at the default limit for where
 * that leads. It goes right after the route's Stage in the order (or after a Task's frozen ones),
 * beside it on the canvas. With no such route, nothing changes and `key` stays the route's Stage's.
 */
export function withStageOnRoute(
  stages: readonly Stage[],
  key: string,
  routeIndex: number,
  stage: Stage,
  locked: LockedStages = NOTHING_LOCKED,
): StageAddedToFlow {
  const index = stages.findIndex((each) => each.key === key);
  const from = stages[index];
  const route = from?.routes?.[routeIndex];
  if (!from || !route) return { stages, key };
  const at = Math.max(index + 1, frozenStages(stages, locked));
  const named = placedBeside(stages, namedAmong(stage, stages), from);
  const flow = withRoutes(stages, key, (routes) => routesWithTarget(routes, routeIndex, named.key));
  const inserted = flow.toSpliced(at, 0, named);
  const onward: Route = {
    ...route,
    condition: null,
    limit: defaultLimit(inserted, named.key, route.to),
  };
  const added: Stage = { ...named, routes: [onward] };
  return { stages: inserted.with(at, added), key: added.key };
}

/**
 * The Stages without `key`, its routes carried along: each route into it leads where its one route
 * out led, so a straight line stays one, its limit kept while it leads the same way. With several
 * routes out, or none, the routes into it go, and the check says where a route is now missing.
 * Nothing else moves.
 */
export function withStageRemovedFromFlow(stages: readonly Stage[], key: string): readonly Stage[] {
  const index = stages.findIndex((stage) => stage.key === key);
  const gone = stages[index];
  if (!gone) return stages;
  const out = (gone.routes ?? []).filter((route) => route.to !== key);
  const onward = out.length === 1 ? out[0] : undefined;
  return removeStage(stages, index).map((stage) =>
    stage.routes?.some((route) => route.to === key)
      ? { ...stage, routes: [...carried(stages, stage, key, onward)] }
      : stage,
  );
}

/**
 * Every route of `from` to `key` leading where `onward` leads, or gone with none, less any made
 * needless. `stages` are the Stages with `key` still among them, whose order the others keep.
 */
function carried(
  stages: readonly Stage[],
  from: Stage,
  key: string,
  onward: Route | undefined,
): Route[] {
  return withoutNeedless(
    (from.routes ?? []).flatMap((route): Route[] => {
      if (route.to !== key) return [route];
      if (!onward) return [];
      const { toName } = onward;
      return [
        {
          ...withoutToName(route),
          to: onward.to,
          ...(toName === undefined ? {} : { toName }),
          limit: limitLeading(stages, from.key, route, onward.to),
        },
      ];
    }),
  );
}

/**
 * The limit of `route` out of `fromKey` once it leads to `to`: its own while it leads the same way,
 * back or on, else the default for where it now leads.
 */
function limitLeading(
  stages: readonly Stage[],
  fromKey: string,
  route: Route,
  to: string | null,
): RouteLimit {
  return isRouteBack(stages, fromKey, route.to) === isRouteBack(stages, fromKey, to)
    ? limitOf(stages, fromKey, route)
    : defaultLimit(stages, fromKey, to);
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
