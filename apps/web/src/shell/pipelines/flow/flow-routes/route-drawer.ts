import type {
  FlowBox,
  FlowLine,
  FlowOrientation,
  FlowPoint,
  MeasuredStage,
} from "../flow-layout.ts";

/**
 * The route drawer boundary (docs/design/pipeline-route-drawing.html, "The drawer boundary"): one
 * function per way of drawing, each with the same input and output, apart from React and the DOM.
 * The flow editor's canvas draws whatever the chosen one returns.
 */

/** How the routes between Stages are drawn, as the Route drawing switch names it. */
export type RouteDrawing = "right-angles" | "curves" | "straight-lines";

export const ROUTE_DRAWINGS: readonly RouteDrawing[] = ["right-angles", "curves", "straight-lines"];

export const DEFAULT_ROUTE_DRAWING: RouteDrawing = "right-angles";

/** The ≤N× mark's size at --text-2xs, its border included (flow-canvas.css). */
export const LIMIT_MARK = { width: 40, height: 18 } as const;

export interface RouteScene {
  readonly orientation: FlowOrientation;
  /** Each card's box and its rows' ports. */
  readonly stages: ReadonlyMap<string, MeasuredStage>;
  /** Undefined until End is measured: no line to End is drawn. */
  readonly end: FlowBox | undefined;
  /** The first Stage's key: the start marker keeps its place on it. */
  readonly start: string | undefined;
  /** Routes on and back alike, then a Proposal's; a line's limit only adds its mark. */
  readonly lines: readonly FlowLine[];
  /** The ≤N× mark's box. */
  readonly mark: { readonly width: number; readonly height: number };
}

export interface DrawnRoute {
  readonly line: FlowLine;
  /** The line's SVG path, which the hit line under it follows too. */
  readonly d: string;
  /** The arrow head's polygon points, its tip on the target's edge. */
  readonly arrow: string;
  /** The middle of its ≤N× mark; undefined with no limit, or no room for one. */
  readonly mark: FlowPoint | undefined;
  /** The line leaves its row's port, so the row shows its dot. */
  readonly fromPort: boolean;
  /** The line from edge to edge as straight steps: its corners unrounded, a curve in short steps. */
  readonly points: readonly FlowPoint[];
}

export interface DrawnRoutes {
  /** In the lines' order; a line with an end not measured yet is left out. */
  readonly routes: readonly DrawnRoute[];
  /** Around every path, arrow and mark; undefined with nothing drawn. */
  readonly bounds: FlowBox | undefined;
}

/** For dragging on a large Pipeline: what was last drawn in full, and what is being moved. */
export interface RoughDrawing {
  readonly previous: DrawnRoutes;
  /** The Stage being dragged, by its key; null for End. */
  readonly moved: string | null;
}

export type RouteDrawer = (scene: RouteScene, rough?: RoughDrawing) => DrawnRoutes;
