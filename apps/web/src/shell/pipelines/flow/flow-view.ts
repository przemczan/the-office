import type { Route, Stage, StageProblem } from "@the-office/contracts";
import { atMostWords, limitMark, routeTargetName, routeWhen } from "./condition-words.ts";
import type { FlowPick } from "./flow-pick.ts";
import { type FlowDrop, limitOf, type MoveDirection } from "./flow-model.ts";
import type { FlowOrientation } from "./flow-layout.ts";

/**
 * What the flow canvas shows of a Stage, and the edits it asks the host for: the canvas never edits
 * Stages itself, so its host applies them with flow-model.
 */
export type FlowCanvasEdit =
  | { readonly kind: "move"; readonly key: string; readonly direction: MoveDirection }
  | { readonly kind: "drop"; readonly key: string; readonly drop: FlowDrop }
  | { readonly kind: "draw-route"; readonly from: string; readonly to: string | null }
  | { readonly kind: "remove-route"; readonly key: string; readonly routeIndex: number };

/** A Stage's own problems: on it as a whole, not on a route. */
export function stageProblemsOf(
  problems: readonly StageProblem[],
  key: string,
): readonly StageProblem[] {
  return problems.filter(
    ({ stageKey, at }) => stageKey === key && (at === null || at.kind === "stage"),
  );
}

export function routeHasProblem(
  problems: readonly StageProblem[],
  key: string,
  routeIndex: number,
): boolean {
  return problems.some(
    ({ stageKey, at }) => stageKey === key && at?.kind === "route" && at.routeIndex === routeIndex,
  );
}

/** The problems on a route as a whole or on its condition. */
export function routeProblems(
  problems: readonly StageProblem[],
  key: string,
  routeIndex: number,
): readonly StageProblem[] {
  return problems.filter(
    ({ stageKey, at }) => stageKey === key && at?.kind === "route" && at.routeIndex === routeIndex,
  );
}

/** Whether every route out carries a condition, so when none holds the walk stops and asks. */
export function noneHoldsAsks(stage: Stage): boolean {
  const routes = stage.routes ?? [];
  return routes.length > 0 && routes.every(({ condition }) => condition !== null);
}

export const NONE_HOLDS_WORDS = "When none holds, you're asked";

/** "Route from Tests to Implement", with ", at most 3 times" on a route with a limit. */
export function routeName(from: Stage, route: Route, stages: readonly Stage[]): string {
  const limit = limitOf(stages, from.key, route);
  const most = limit === null ? "" : `, ${atMostWords(limit)}`;
  return `Route from ${from.name} to ${routeTargetName(route, stages)}${most}`;
}

/**
 * A route's line: where it leads, when ("when …", "when it fails", "always", "otherwise") and its
 * limit's mark ("≤3×", none for No limit).
 */
export function routeLine(
  from: Stage,
  route: Route,
  index: number,
  stages: readonly Stage[],
): { readonly target: string; readonly when: string; readonly mark: string } {
  return {
    target: routeTargetName(route, stages),
    when: routeWhen(route, from, stages, index),
    mark: limitMark(limitOf(stages, from.key, route)),
  };
}

export function isPickedStage(picked: FlowPick | undefined, key: string): boolean {
  return picked?.kind === "stage" && picked.key === key;
}

export function isPickedRoute(
  picked: FlowPick | undefined,
  key: string,
  routeIndex: number,
): boolean {
  return picked?.kind === "route" && picked.key === key && picked.routeIndex === routeIndex;
}

const ACROSS_KEYS: Readonly<Record<string, MoveDirection>> = {
  ArrowLeft: "earlier",
  ArrowRight: "later",
  ArrowUp: "up",
  ArrowDown: "down",
};

/** Down, the Pipeline's order runs top to bottom and a column's rows side by side. */
const DOWN_KEYS: Readonly<Record<string, MoveDirection>> = {
  ArrowUp: "earlier",
  ArrowDown: "later",
  ArrowLeft: "up",
  ArrowRight: "down",
};

export function arrowDirection(
  key: string,
  orientation: FlowOrientation,
): MoveDirection | undefined {
  return (orientation === "across" ? ACROSS_KEYS : DOWN_KEYS)[key];
}
