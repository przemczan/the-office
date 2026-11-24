/**
 * How an edge of the Task graph shows while a Task is hovered or focused: the arrows into it, from
 * its blockers, red, or green while that blocker is Done; the arrows out of it, to the Tasks waiting
 * for it, blue; every other edge dimmed.
 */
export type EdgeHighlight = "into" | "into-done" | "out" | "dimmed";

export function edgeHighlight(
  edge: { readonly from: string; readonly to: string; readonly blockerDone: boolean },
  highlighted: string | undefined,
): EdgeHighlight | undefined {
  if (highlighted === undefined) return undefined;
  if (edge.to === highlighted) return edge.blockerDone ? "into-done" : "into";
  if (edge.from === highlighted) return "out";
  return "dimmed";
}
