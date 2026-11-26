import type { FlowStage } from "./flow.js";
import type { PublishResult } from "./publish-result.js";
import { testsOf, type Route } from "./route.js";
import { isPublishStage } from "./stage.js";

/**
 * Whether `route` out of the Stage `stageKey` takes the Publish result `result` (spec §2.3.4,
 * "Publish's results"): its condition tests that the Stage itself ended with it.
 */
export function takesPublishResult(
  route: Route,
  stageKey: string,
  result: Exclude<PublishResult, "failed">,
): boolean {
  if (!route.condition) return false;
  return testsOf(route.condition).some(
    ({ test }) =>
      test.kind === "stage" &&
      (test.stage === null || test.stage === stageKey) &&
      test.is === result,
  );
}

/** Whether `route` out of the Stage `stage` is a Publish Stage's Conflict route. */
export function isConflictRoute(route: Route, stage: FlowStage): boolean {
  return isPublishStage(stage) && takesPublishResult(route, stage.key, "conflict");
}

/**
 * The keys of the Stages of the conflict chain (spec §2.3.4, "Conflicts in the flow"): those a
 * Publish Stage's Conflict route leads to, and the Stages after them, until a Publish Stage, that
 * the walk can't reach from its start without passing a Conflict route. Such a Stage runs only
 * after a conflict. The walk starts at the first Stage in the Pipeline's order not of the chain, as
 * a chain drawn before a Publish that is first stands before it.
 */
export function conflictOnlyStages(flow: readonly FlowStage[]): ReadonlySet<string> {
  const byKey = new Map(flow.map((stage) => [stage.key, stage]));
  const conflictTargets = flow.flatMap((stage) =>
    stage.routes.flatMap((route) =>
      isConflictRoute(route, stage) && route.to !== null ? [route.to] : [],
    ),
  );
  const afterConflict = new Set(
    [...reached(byKey, conflictTargets, (_route, from) => !isPublishStage(from))].filter(
      (key) => !isPublishStage(byKey.get(key)),
    ),
  );
  const start = flow.find(({ key }) => !afterConflict.has(key)) ?? flow[0];
  if (!start) return new Set();
  const withoutConflict = reached(
    byKey,
    [start.key],
    (route, from) => !isConflictRoute(route, from),
  );
  return new Set([...afterConflict].filter((key) => !withoutConflict.has(key)));
}

/** The keys a path of routes `follows` keeps reaches from `from`, those Stages included. */
function reached(
  byKey: ReadonlyMap<string, FlowStage>,
  from: readonly string[],
  follows: (route: Route, from: FlowStage) => boolean,
): ReadonlySet<string> {
  const found = new Set(from.filter((key) => byKey.has(key)));
  const toVisit = [...found];
  for (let key = toVisit.pop(); key !== undefined; key = toVisit.pop()) {
    const stage = byKey.get(key);
    if (!stage) continue;
    for (const route of stage.routes) {
      if (route.to === null || found.has(route.to) || !follows(route, stage)) continue;
      found.add(route.to);
      toVisit.push(route.to);
    }
  }
  return found;
}
