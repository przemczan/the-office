import type { Stage } from "@the-office/contracts";
import { routeTargetName } from "./condition-words.ts";
import type { FlowOrientation } from "./flow-layout.ts";

/**
 * The flow editor's own words (docs/design/pipeline-flow.html): its head's summary, the hint above
 * the canvas and what an edit just did, said there in its place.
 */

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "4 Stages · 5 routes · 3 On failure loops". */
export function flowSummary(stages: readonly Stage[]): string {
  const routes = stages.reduce((total, stage) => total + (stage.routes?.length ?? 0), 0);
  const loops = stages.filter((stage) => stage.kind !== "gate" && stage.onFailure).length;
  return [
    counted(stages.length, "Stage", "Stages"),
    counted(routes, "route", "routes"),
    counted(loops, "On failure loop", "On failure loops"),
  ].join(" · ");
}

export type FlowEditorView = "flow" | "list";

/** How to use the editor, when no edit has just said something else. */
export function howToHint(
  view: FlowEditorView,
  orientation: FlowOrientation,
  readOnly: boolean,
): string {
  if (readOnly) return "Pick a Stage or a route to read it below.";
  if (view === "list") {
    return "The same flow as a list, in the Pipeline's order: move a Stage with its arrows, and add or edit its routes under Routes out.";
  }
  if (orientation === "down") {
    return "Press a Stage or a route to edit it below. Move and Routes out do everything without dragging; drag from a Stage's + to draw a route.";
  }
  return "Drag a Stage to move it. Drag from its + to another Stage, or to End, to draw a route; pick a route to set its condition. Without a mouse: Tab to a Stage, Shift + arrows move it, Enter opens it below.";
}

export function addedHint(added: Stage, beside: Stage | undefined): string {
  return `${added.name} was added beside ${beside?.name ?? "the start"}. Drag it where it goes, then draw its routes: drag from a Stage's + to another Stage or to End. Without dragging: Move and Routes out, below.`;
}

export function removedHint(gone: Stage): string {
  return `${gone.name} was removed. Each route that led into it now leads where its one route out led, so a straight line stays one.`;
}

export function onRouteHint(from: Stage, added: Stage): string {
  return `${added.name} was put on the route from ${from.name}: that route now leads to it, its condition kept, and one route with no condition leads on from it.`;
}

export function routeRemovedHint(from: Stage, target: string): string {
  return `The route from ${from.name} to ${target} was removed.`;
}

/**
 * What drawing a route from `from` (as it was before) to `to` did: picked the route already there,
 * or drew one, asking for its condition when `from` has others.
 */
export function drawnHint(from: Stage, to: string | null, stages: readonly Stage[]): string {
  const routes = from.routes ?? [];
  const where = routeTargetName({ to, condition: null }, stages);
  const existing = routes.find((route) => route.to === to);
  if (existing) {
    return `${from.name} already has a route to ${where}: it is picked below. Two cases that lead there are one route whose condition joins them with Any of.`;
  }
  return routes.length > 0
    ? `Route drawn from ${from.name} to ${where}. As ${from.name} has other routes out, set when it is followed, below.`
    : `Route drawn from ${from.name} to ${where}.`;
}

/** How to use a Project Pipeline's editor, where Stages keep the base Pipeline's places. */
export function projectHowToHint(view: FlowEditorView, orientation: FlowOrientation): string {
  if (view === "list") {
    return "The same flow as a list, in the Pipeline's order: pick a Stage to edit it below, and its routes under Routes out. Each edit becomes a Stage change.";
  }
  if (orientation === "down") {
    return "Press a Stage or a route to edit it below: a route's edit becomes a Change routes Stage change, with its Undo. Drag from a Stage's + to draw a route.";
  }
  return "Pick a Stage or a route to edit it below: a route's edit becomes a Change routes Stage change, with its Undo, and an edit of one of a Stage's own fields a Change Stage change of only that field. A Project Pipeline's Stages keep the places its base Pipeline gives them.";
}
