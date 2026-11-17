import type { Stage } from "@the-office/contracts";

/**
 * Stages as a plain list, without their routes and places, which the service draws again as a
 * straight line. A test that leaves out or adds Stages to a Pipeline's sends this, as the routes it
 * read may lead to a Stage that's gone.
 */
export function asStageList(stages: readonly Stage[]): Stage[] {
  return stages.map(({ routes: _routes, place: _place, ...stage }) => stage);
}
