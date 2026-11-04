/** A Stage's button on the rail, for `focusStage`. */
export function stageElementId(stageKey: string): string {
  return `rail-stage-${stageKey}`;
}

/**
 * Moves focus to a Stage on the rail, which scrolls it into view and is where the rail hears its
 * arrow keys and Esc.
 */
export function focusStage(stageKey: string): void {
  document.getElementById(stageElementId(stageKey))?.focus();
}
