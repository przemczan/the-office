import type { Route, Stage, StageProblem } from "@the-office/contracts";
import { routeTargetName, routeWhen } from "./condition-words.ts";
import type { FlowPick } from "./flow-pick.ts";
import type { FlowDrop, MoveDirection } from "./flow-model.ts";
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

/** A Stage's own problems: on it as a whole, not on a route or its On failure. */
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

export function loopHasProblem(problems: readonly StageProblem[], key: string): boolean {
  return problems.some(({ stageKey, at }) => stageKey === key && at?.kind === "onFailure");
}

/** Whether every route out carries a condition, so when none holds the walk stops and asks. */
export function noneHoldsAsks(stage: Stage): boolean {
  const routes = stage.routes ?? [];
  return routes.length > 0 && routes.every(({ condition }) => condition !== null);
}

export const NONE_HOLDS_WORDS = "When none holds, you're asked";

export function routeName(from: Stage, route: Route, stages: readonly Stage[]): string {
  return `Route from ${from.name} to ${routeTargetName(route, stages)}`;
}

/** A route's line: where it leads, and when ("when …", "always", "otherwise"). */
export function routeLine(
  from: Stage,
  route: Route,
  index: number,
  stages: readonly Stage[],
): { readonly target: string; readonly when: string } {
  return { target: routeTargetName(route, stages), when: routeWhen(route, from, stages, index) };
}

function times(count: number): string {
  return count === 1 ? "1 time" : `${count} times`;
}

/** A Stage's On failure loop in words, or undefined without one. */
export function loopWords(
  stage: Stage,
  stages: readonly Stage[],
): { readonly to: string; readonly rounds: number; readonly name: string } | undefined {
  if (stage.kind === "gate" || !stage.onFailure) return undefined;
  const { goBackTo, rounds } = stage.onFailure;
  const to = stages.find(({ key }) => key === goBackTo)?.name ?? goBackTo;
  return {
    to,
    rounds,
    name: `On failure, ${stage.name} goes back to ${to}, at most ${times(rounds)}`,
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
