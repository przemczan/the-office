import type { Route, Stage, StagePosition, StageProblem } from "@the-office/contracts";
import { atMostWords, limitMark, routeTargetName, routeWhen } from "./condition-words.ts";
import type { FlowPick } from "./flow-pick.ts";
import { type FlowPositions, limitOf } from "./flow-model.ts";

/**
 * What the flow canvas shows of a Stage, and the edits the canvas and the editor ask the host for:
 * neither edits Stages itself, so its host applies them with flow-model.
 */
export type FlowCanvasEdit =
  /**
   * A Stage (its key) or End (null) moved on the canvas; `beside` names the card it would have
   * covered, when it was put beside it instead.
   */
  | {
      readonly kind: "move-to";
      readonly key: string | null;
      readonly position: StagePosition;
      readonly beside?: string | null;
    }
  | { readonly kind: "draw-route"; readonly from: string; readonly to: string | null }
  | { readonly kind: "remove-route"; readonly key: string; readonly routeIndex: number }
  /** Auto-align laid every Stage and End out; `before` is where they stood, for its Undo. */
  | { readonly kind: "auto-align"; readonly laid: FlowPositions; readonly before: FlowPositions }
  | { readonly kind: "undo-auto-align"; readonly before: FlowPositions };

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

/** An arrow key's step: through the Pipeline's order, and with Shift a grid step on the canvas. */
export interface ArrowStep {
  readonly by: -1 | 1;
  readonly dx: -1 | 0 | 1;
  readonly dy: -1 | 0 | 1;
}

const ARROW_STEPS: Readonly<Record<string, ArrowStep>> = {
  ArrowLeft: { by: -1, dx: -1, dy: 0 },
  ArrowRight: { by: 1, dx: 1, dy: 0 },
  ArrowUp: { by: -1, dx: 0, dy: -1 },
  ArrowDown: { by: 1, dx: 0, dy: 1 },
};

export function arrowStep(key: string): ArrowStep | undefined {
  return ARROW_STEPS[key];
}
