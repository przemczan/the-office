import type { Stage } from "@the-office/contracts";
import { routeTargetName } from "./condition-words.ts";
import type { FlowOrientation } from "./flow-layout.ts";
import { isRouteBack, ROUTE_BACK_LIMIT } from "./flow-model.ts";

/**
 * The flow editor's own words (docs/design/pipeline-flow.html): its head's summary, the hint above
 * the canvas and what an edit just did, said there in its place.
 */

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "4 Stages · 5 routes · 2 routes back": a route back is one to its own Stage or an earlier one. */
export function flowSummary(stages: readonly Stage[]): string {
  const routes = stages.flatMap(({ key, routes: out }) =>
    (out ?? []).map(({ to }) => ({ key, to })),
  );
  const back = routes.filter(({ key, to }) => isRouteBack(stages, key, to)).length;
  return [
    counted(stages.length, "Stage", "Stages"),
    counted(routes.length, "route", "routes"),
    counted(back, "route back", "routes back"),
  ].join(" · ");
}

/** How to move around the canvas (docs/design/pipeline-editor.html), after how to edit on it. */
const MOVE_AROUND =
  " Drag the canvas with the right mouse button to move around; scroll zooms around the pointer, and F fits the whole Pipeline.";

/** How to use the editor, when no edit has just said something else. */
export function howToHint(orientation: FlowOrientation, readOnly: boolean): string {
  if (readOnly) return `Pick a Stage or a route to read it below.${MOVE_AROUND}`;
  if (orientation === "down") {
    return "Press a Stage or a route to edit it below. The Pipeline reads top to bottom here, as its Stages stand from left to right on a wider screen. Move and Routes out do everything without dragging; drag from a Stage's + to draw a route.";
  }
  return `Drag a Stage anywhere: it snaps to the grid and to other Stages; hold Alt (⌥) to place it freely, Shift to keep it in line. Drag from its + to any Stage, itself or an earlier one too, or to End, to draw a route; pick a route to set its condition and its limit. Auto-align lays out the whole Pipeline. Without a mouse: Tab to a Stage, Shift + arrows move it, Enter opens it below.${MOVE_AROUND}`;
}

/**
 * What adding a Stage did: put it after `before` in the order (as the last Stage when none was
 * picked), beside it on the canvas.
 */
export function addedHint(added: Stage, before: Stage | undefined, last: boolean): string {
  const where = !before
    ? "as the first Stage"
    : last
      ? `as the last Stage, beside ${before.name} on the canvas`
      : `after ${before.name} in the Pipeline's order, beside it on the canvas`;
  return `${added.name} was added ${where}. Drag it where it goes, then draw its routes: drag from a Stage's + to another Stage or to End. Without dragging: Move and Routes out, below.`;
}

/** A dragged card that would have covered another was put beside it. */
export function besideHint(moved: string, covered: string): string {
  return `${moved} was put beside ${covered}, so it doesn't cover it.`;
}

/**
 * What Move earlier or Move later did to the order: where the Stage now is, each route that now
 * leads back or on, and where walks now start, if that changed.
 */
export function movedInOrderHint(
  before: readonly Stage[],
  after: readonly Stage[],
  key: string,
): string {
  const index = after.findIndex((stage) => stage.key === key);
  const moved = after[index];
  if (!moved) return "";
  const turned = after.flatMap((stage) =>
    (stage.routes ?? []).flatMap((route) => {
      const back = isRouteBack(after, stage.key, route.to);
      if (back === isRouteBack(before, stage.key, route.to)) return [];
      const target = routeTargetName(route, after);
      return [`The route from ${stage.name} to ${target} now leads ${back ? "back" : "on"}.`];
    }),
  );
  const first = after[0];
  const start = first && first.key !== before[0]?.key ? [`Walks now start at ${first.name}.`] : [];
  return [
    `${moved.name} is now ${index + 1} of ${after.length} in the Pipeline's order; it stays where it is on the canvas.`,
    ...turned,
    ...start,
  ].join(" ");
}

/** Auto-align's words: done, undone and failed. */
export function autoAlignedHint(count: number): string {
  return `Auto-align laid out the ${counted(count, "Stage", "Stages")} from left to right in the Pipeline's order.`;
}

export const AUTO_ALIGN_UNDONE = "The Stages are back where they were before Auto-align.";

export const AUTO_ALIGN_FAILED =
  "Auto-align couldn't load its layout code, so nothing moved. Check the connection, then press Auto-align again.";

export function removedHint(gone: Stage): string {
  return `${gone.name} was removed. Each route that led into it now leads where its one route out led, so a straight line stays one.`;
}

export function onRouteHint(from: Stage, added: Stage): string {
  return `${added.name} was put on the route from ${from.name}: that route now leads to it, its condition and limit kept, and one route with no condition leads on from it.`;
}

export function routeRemovedHint(from: Stage, target: string): string {
  return `The route from ${from.name} to ${target} was removed.`;
}

/**
 * What drawing a route from `from` (as it was before) to `to` did: picked the route already there,
 * or drew one, asking for its condition when `from` has others, and for its limit when it leads
 * back.
 */
export function drawnHint(from: Stage, to: string | null, stages: readonly Stage[]): string {
  const routes = from.routes ?? [];
  const where = routeTargetName({ to, condition: null }, stages);
  const existing = routes.find((route) => route.to === to);
  if (existing) {
    return `${from.name} already has a route to ${where}: it is picked below. Two cases that lead there are one route whose condition joins them with Any of.`;
  }
  if (isRouteBack(stages, from.key, to)) {
    return `Route drawn from ${from.name} back to ${where}, at most ${ROUTE_BACK_LIMIT} times: set its condition and its limit below.`;
  }
  return routes.length > 0
    ? `Route drawn from ${from.name} to ${where}. As ${from.name} has other routes out, set when it is followed, below.`
    : `Route drawn from ${from.name} to ${where}.`;
}
