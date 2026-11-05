/** A Stage's button on the rail, for `focusStage`. */
export function stageElementId(stageKey: string): string {
  return `rail-stage-${stageKey}`;
}

/**
 * Moves focus back to a Stage on the rail as its history closes, which scrolls it into view.
 */
export function focusStage(stageKey: string): void {
  document.getElementById(stageElementId(stageKey))?.focus();
}
