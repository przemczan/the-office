import type { StageProblem } from "@the-office/contracts";

/**
 * What is picked in the flow editor (docs/design/pipeline-flow.html), opened in the panel under the
 * canvas: a Stage, its On failure, one of its routes, or a test of that route's condition by its
 * indexes (`[0, 1]`, as the service's `StageProblemAt.testPath`). Always by the Stage's key, never
 * its index, as the draft's order changes under it.
 */
export type FlowPick =
  | { readonly kind: "stage"; readonly key: string }
  | { readonly kind: "onFailure"; readonly key: string }
  | {
      readonly kind: "route";
      readonly key: string;
      readonly routeIndex: number;
      readonly testPath?: readonly number[];
    };

/** Where a problem of the service's check is, as a pick; undefined for the Pipeline as a whole. */
export function pickOfProblem({ stageKey, at }: StageProblem): FlowPick | undefined {
  if (stageKey === null) return undefined;
  switch (at?.kind) {
    case undefined:
    case "stage":
      return { kind: "stage", key: stageKey };
    case "onFailure":
      return { kind: "onFailure", key: stageKey };
    case "route":
      return at.testPath === undefined
        ? { kind: "route", key: stageKey, routeIndex: at.routeIndex }
        : { kind: "route", key: stageKey, routeIndex: at.routeIndex, testPath: at.testPath };
  }
}

/** A problem's key for a list: its Stage, where on it and its words, never its index. */
export function problemKey({ stageKey, at, text }: StageProblem): string {
  return JSON.stringify([stageKey, at, text]);
}
