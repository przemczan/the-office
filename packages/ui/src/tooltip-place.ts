export type TooltipSide = "top" | "bottom" | "left" | "right";

/** What a tooltip keeps clear of the window's edges. */
export const TOOLTIP_WINDOW_MARGIN_PX = 8;

/** What it keeps clear of its trigger. */
const TRIGGER_GAP_PX = 6;

interface Size {
  readonly width: number;
  readonly height: number;
}

interface Box extends Size {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Where a tooltip goes, in the window's pixels. */
export interface TooltipPlace {
  readonly left: number;
  readonly top: number;
}

const OPPOSITE: Record<TooltipSide, TooltipSide> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

/**
 * Centred on the side asked for, or the opposite one when only that has the room, then shifted
 * along that side to stay within the window.
 */
export function tooltipPlace(
  trigger: Box,
  tooltip: Size,
  side: TooltipSide,
  view: Size,
): TooltipPlace {
  const chosen = sideWithRoom(trigger, tooltip, side, view);
  const centred = {
    left: trigger.left + (trigger.width - tooltip.width) / 2,
    top: trigger.top + (trigger.height - tooltip.height) / 2,
  };
  const beside: Record<TooltipSide, TooltipPlace> = {
    top: { ...centred, top: trigger.top - TRIGGER_GAP_PX - tooltip.height },
    bottom: { ...centred, top: trigger.bottom + TRIGGER_GAP_PX },
    left: { ...centred, left: trigger.left - TRIGGER_GAP_PX - tooltip.width },
    right: { ...centred, left: trigger.right + TRIGGER_GAP_PX },
  };
  const { left, top } = beside[chosen];
  return {
    left: withinWindow(left, tooltip.width, view.width),
    top: withinWindow(top, tooltip.height, view.height),
  };
}

function sideWithRoom(trigger: Box, tooltip: Size, side: TooltipSide, view: Size): TooltipSide {
  const room: Record<TooltipSide, number> = {
    top: trigger.top,
    bottom: view.height - trigger.bottom,
    left: trigger.left,
    right: view.width - trigger.right,
  };
  const needed =
    (side === "top" || side === "bottom" ? tooltip.height : tooltip.width) +
    TRIGGER_GAP_PX +
    TOOLTIP_WINDOW_MARGIN_PX;
  const opposite = OPPOSITE[side];
  return room[side] < needed && room[opposite] > room[side] ? opposite : side;
}

function withinWindow(start: number, size: number, viewSize: number): number {
  const furthest = viewSize - size - TOOLTIP_WINDOW_MARGIN_PX;
  return Math.max(TOOLTIP_WINDOW_MARGIN_PX, Math.min(start, furthest));
}
