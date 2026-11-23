import type { ConditionGroup, Route, Stage } from "@the-office/contracts";
import { conflictOnlyStages } from "./conflict-chain.ts";
import { endedResults, inFlowOrder, isFailureRoute, isRouteBack } from "./flow-model.ts";

/**
 * Whether a Pipeline still reads as The Office's move to routes back and Publish Stages left it
 * (spec §2.3.5, "The move to routes back and Publish Stages"), and what the moved-flow note says of
 * it: each Stage on row 0, in a column of its own, one route with no condition to the next and from
 * the last to End. Where the Stage after one was optional, the routes are to it while the
 * Definition of Done has some not Reported met, otherwise to the first Stage after it that wasn't
 * optional, or End. A failure route back, as an On failure setting became, and a Publish Stage's
 * Conflict route are left out of the comparison, and so are the conflict chain's Stages drawn in
 * under the Publish. The Stages keep `optional`, which only the previous release reads, so the
 * note can tell how a Stage became routes.
 */

export function isConvertedFlow(stages: readonly Stage[]): boolean {
  const order = mainLine(stages);
  if (order.length === 0) return false;
  return order.every(
    (stage, index) =>
      stage.place?.row === 0 &&
      stage.place.column > (order[index - 1]?.place?.column ?? -1) &&
      sameRoutes(
        (stage.routes ?? []).filter(
          (route) =>
            !(isFailureRoute(route) && isRouteBack(stages, stage.key, route.to)) &&
            !isDrawnConflictRoute(stage, route),
        ),
        convertedRoutes(order, index),
      ),
  );
}

/**
 * For each Stage that was optional, how the conversion made it routes: "Glossary check was
 * optional: …". None when no Stage after the first was.
 */
export function optionalStageSentences(stages: readonly Stage[]): readonly string[] {
  const order = mainLine(stages);
  return order.flatMap((stage, index) => {
    const before = order[index - 1];
    if (!stage.optional || !before) return [];
    const onward = order.slice(index + 1).find(({ optional }) => !optional)?.name ?? "End";
    return [
      `${stage.name} was optional: skipped when the Definition of Done was already met. That setting is now two routes out of ${before.name}: to ${stage.name} when the Definition of Done has some not Reported met, otherwise straight to ${onward}. It runs and passes by the same Stages as before.`,
    ];
  });
}

/** The Stages in the Pipeline's order, but the conflict chain the move drew in. */
function mainLine(stages: readonly Stage[]): readonly Stage[] {
  const order = inFlowOrder(stages);
  const chain = conflictOnlyStages(order);
  return order.filter(({ key }) => !chain.has(key));
}

/** Whether the route is a Publish Stage's Conflict route as the move draws it, taking that result alone. */
function isDrawnConflictRoute(stage: Stage, route: Route): boolean {
  const results = stage.kind === "publish" ? endedResults(route) : undefined;
  return results?.length === 1 && results[0] === "conflict";
}

function convertedRoutes(order: readonly Stage[], index: number): readonly Route[] {
  const next = order[index + 1];
  if (!next) return [{ to: null, condition: null }];
  if (!next.optional) return [{ to: next.key, condition: null }];
  const onward = order.slice(index + 1).find(({ optional }) => !optional);
  return [
    { to: next.key, condition: WHILE_SOME_NOT_MET },
    { to: onward?.key ?? null, condition: null },
  ];
}

const WHILE_SOME_NOT_MET: ConditionGroup = {
  combine: "all",
  tests: [{ kind: "definitionOfDone", is: "some-not-met" }],
};

/** The same targets and conditions, whatever order the stored keys came back in. */
function sameRoutes(one: readonly Route[], other: readonly Route[]): boolean {
  return (
    one.length === other.length &&
    one.every((route, index) => {
      const like = other[index];
      return (
        like !== undefined &&
        route.to === like.to &&
        (route.condition === null
          ? like.condition === null
          : like.condition !== null && isWhileSomeNotMet(route.condition))
      );
    })
  );
}

function isWhileSomeNotMet({ combine, tests }: ConditionGroup): boolean {
  const [only] = tests;
  return (
    combine === "all" &&
    tests.length === 1 &&
    only !== undefined &&
    "kind" in only &&
    only.kind === "definitionOfDone" &&
    only.is === "some-not-met"
  );
}
