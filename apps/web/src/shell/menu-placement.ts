export interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Placement {
  readonly top: number;
  readonly left: number;
}

/** The space between the trigger and its menu, and between the menu and the window's edge. */
const GAP = 4;
const MARGIN = 8;

/**
 * Where a menu goes in the window: below its trigger, or above it when there is no room below and
 * more above; lined up with the trigger's end or start, kept inside the window.
 */
export function menuPlacement(
  trigger: Box,
  menu: Size,
  viewport: Size,
  align: "start" | "end",
): Placement {
  const roomBelow = viewport.height - trigger.bottom - GAP - MARGIN;
  const roomAbove = trigger.top - GAP - MARGIN;
  const above = menu.height > roomBelow && roomAbove > roomBelow;
  const top = above ? trigger.top - GAP - menu.height : trigger.bottom + GAP;
  const left = align === "end" ? trigger.right - menu.width : trigger.left;
  return {
    top: Math.max(MARGIN, top),
    left: Math.min(Math.max(MARGIN, left), viewport.width - MARGIN - menu.width),
  };
}
