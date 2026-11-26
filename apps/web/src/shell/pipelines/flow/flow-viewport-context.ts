import { createContext, useContext } from "react";
import type { FlowBox, FlowOrientation } from "./flow-layout.ts";

/** A Stage's block in the Overview, in the canvas's own pixels. */
export interface FlowOverviewBlock {
  readonly key: string;
  readonly box: FlowBox;
  readonly tone: "plain" | "picked";
}

export interface FlowOverviewShape {
  readonly blocks: readonly FlowOverviewBlock[];
  readonly end: FlowBox | undefined;
}

/**
 * What a FlowViewport tells the canvas inside it, and what the canvas tells it back: the canvas
 * draws by the viewport's zoom and width, and gives it the Stages' boxes for the Overview and for
 * bringing a picked Stage into view.
 */
export interface FlowViewportLink {
  /** Under 60%, a Stage card shows only its kind mark and its name. */
  readonly namesOnly: boolean;
  /** From the viewport's width: down under 560px. */
  readonly orientation: FlowOrientation;
  /** The viewport's width, which a flow running down fills. */
  readonly width: number;
  readonly showOverview: (shape: FlowOverviewShape) => void;
  /** Moves the view just enough to show `box`, in the canvas's pixels. */
  readonly bringIntoView: (box: FlowBox) => void;
  /** The view's zoom, from 0.25 to 1: snapping's reach is in screen pixels. */
  readonly zoom: number;
  /** Fits the whole Pipeline in view, as Fit does (after Auto-align). */
  readonly fit: () => void;
  /**
   * Moves the view by `dx`, `dy` canvas pixels, so the cards stay where they were on the screen when
   * the canvas's box grows left or up.
   */
  readonly shiftBy: (dx: number, dy: number) => void;
  /** While a Stage or a route is dragged: near the viewport's edge, the view follows. */
  readonly followDrag: (point: { readonly clientX: number; readonly clientY: number }) => void;
}

export const FlowViewportContext = createContext<FlowViewportLink | undefined>(undefined);

/** The viewport around the canvas, or undefined for a canvas drawn alone. */
export function useFlowViewport(): FlowViewportLink | undefined {
  return useContext(FlowViewportContext);
}
