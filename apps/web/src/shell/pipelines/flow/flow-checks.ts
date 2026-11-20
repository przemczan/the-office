import type { ConditionGroup, Stage, StageProblem } from "@the-office/contracts";
import { isGroup, type TestPath } from "./condition-edits.ts";
import { routeTargetName } from "./condition-words.ts";
import { inFlowOrder } from "./flow-model.ts";

/**
 * What the flow editor refuses on its own, beside the service's check: a condition group with no
 * test yet (docs/design/pipeline-flow.html, "Also refused"), which the walk would read as always
 * holding (All of) or never (Any of). Worded and placed as the check's own problems, so it shows
 * on its group and above the bar and holds Save the same way.
 */
export function flowProblems(stages: readonly Stage[]): readonly StageProblem[] {
  return inFlowOrder(stages).flatMap((stage, stageIndex) =>
    (stage.routes ?? []).flatMap((route, routeIndex) =>
      route.condition
        ? emptyGroupsOf(route.condition).map((testPath): StageProblem => ({
            stageKey: stage.key,
            at: { kind: "route", routeIndex, testPath: [...testPath] },
            level: "problem",
            text: `Stage ${stageIndex + 1} · ${stage.name.trim() || stage.key}: its route to ${routeTargetName(route, stages)} has a group with no test yet: add a test, or remove the group.`,
          }))
        : [],
    ),
  );
}

/** The paths of `group` and its nested groups that hold no test. */
function emptyGroupsOf(group: ConditionGroup, path: TestPath = []): readonly TestPath[] {
  const nested = group.tests.flatMap((item, index) =>
    isGroup(item) ? emptyGroupsOf(item, [...path, index]) : [],
  );
  return group.tests.length === 0 ? [path, ...nested] : nested;
}
