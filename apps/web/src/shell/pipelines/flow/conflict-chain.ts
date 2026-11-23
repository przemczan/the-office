import type { ConditionGroup, ConditionTest, Route, Stage } from "@the-office/contracts";
import { isGroup } from "./condition-edits.ts";

/**
 * The keys of the conflict chain's Stages (spec §2.3.4, "Conflicts in the flow"), as the service's
 * `conflictOnlyStages` reads them: those a Publish Stage's Conflict route leads to, and the Stages
 * after them until a Publish Stage, that the walk can't reach from its start without passing a
 * Conflict route. Such a Stage runs only after a conflict. `ordered` is in the Pipeline's order; the
 * walk starts at its first Stage not of the chain, as a chain drawn before a Publish that is first
 * stands before it.
 */
export function conflictOnlyStages(ordered: readonly Stage[]): ReadonlySet<string> {
  const byKey = new Map(ordered.map((stage) => [stage.key, stage]));
  const conflictTargets = ordered.flatMap((stage) =>
    routesOf(stage).flatMap((route) =>
      isConflictRoute(stage, route) && route.to !== null ? [route.to] : [],
    ),
  );
  const afterConflict = new Set(
    [...reached(byKey, conflictTargets, (_route, from) => from.kind !== "publish")].filter(
      (key) => byKey.get(key)?.kind !== "publish",
    ),
  );
  const start = ordered.find(({ key }) => !afterConflict.has(key)) ?? ordered[0];
  if (!start) return new Set();
  const withoutConflict = reached(
    byKey,
    [start.key],
    (route, from) => !isConflictRoute(from, route),
  );
  return new Set([...afterConflict].filter((key) => !withoutConflict.has(key)));
}

/** Whether `route` is a Publish Stage's Conflict route: a test of it that the Stage ended Conflict. */
function isConflictRoute(stage: Stage, route: Route): boolean {
  if (stage.kind !== "publish" || route.condition === null) return false;
  return testsIn(route.condition).some(
    (test) =>
      test.kind === "stage" &&
      (test.stage === null || test.stage === stage.key) &&
      test.is === "conflict",
  );
}

function testsIn(group: ConditionGroup): readonly ConditionTest[] {
  return group.tests.flatMap((item) => (isGroup(item) ? testsIn(item) : [item]));
}

function routesOf(stage: Stage): readonly Route[] {
  return stage.routes ?? [];
}

/** The keys a path of routes `follows` keeps reaches from `from`, those Stages included. */
function reached(
  byKey: ReadonlyMap<string, Stage>,
  from: readonly string[],
  follows: (route: Route, from: Stage) => boolean,
): ReadonlySet<string> {
  const found = new Set(from.filter((key) => byKey.has(key)));
  const toVisit = [...found];
  for (let key = toVisit.pop(); key !== undefined; key = toVisit.pop()) {
    const stage = byKey.get(key);
    if (!stage) continue;
    for (const route of routesOf(stage)) {
      if (route.to === null || found.has(route.to) || !follows(route, stage)) continue;
      found.add(route.to);
      toVisit.push(route.to);
    }
  }
  return found;
}
