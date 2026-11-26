import { isMarked, type FlowBox, type FlowLine, type FlowPoint } from "../flow-layout.ts";
import { type MarkRule, markSpots } from "./mark-spots.ts";
import type { DrawnRoute, DrawnRoutes, RouteScene } from "./route-drawer.ts";
import {
  arrowAt,
  boxAround,
  bottom,
  type Pt,
  right,
  type RouteShape,
  shapeHeading,
  shapePath,
  shapePoints,
} from "./route-geometry.ts";

/**
 * The frame every drawer works in: the flow running left to right. A canvas running down (the
 * narrow view) is the same drawing with x and y swapped, so each rule is written once
 * (docs/design/pipeline-route-drawing.html, "Narrow view").
 */

export interface FrameCard {
  /** The Stage's key; null for End. */
  readonly key: string | null;
  readonly box: FlowBox;
  /** Each route row's port along the right edge, by the route's index; none in the narrow view. */
  readonly rows: readonly number[];
}

export interface FrameLine {
  readonly line: FlowLine;
  readonly from: FrameCard;
  readonly to: FrameCard;
  /** Its place in the Pipeline's order, which settles every tie. */
  readonly order: number;
}

export interface RouteFrame {
  readonly narrow: boolean;
  /** Every Stage, then End. */
  readonly cards: readonly FrameCard[];
  /** The lines whose two ends are measured. */
  readonly lines: readonly FrameLine[];
  readonly mark: { readonly width: number; readonly height: number };
  /** The first Stage, whose left edge's middle the start marker keeps. */
  readonly start: FrameCard | undefined;
  /** What no line runs through: every card, and the start marker. */
  readonly obstacles: readonly FlowBox[];
}

/** A line as its drawer shaped it, in the frame. */
export interface FramedRoute {
  readonly line: FrameLine;
  readonly shape: RouteShape;
  readonly fromPort: boolean;
}

/** The line stops this far short of its target's edge, where the arrow head takes over. */
const ARROW_TRIM = 6;
/** The start marker's dot and its short line, left of the first Stage (flow-layout's startPath). */
const START_MARKER = { reach: 30, height: 12 } as const;

const swapBox = ({ x, y, width, height }: FlowBox): FlowBox => ({
  x: y,
  y: x,
  width: height,
  height: width,
});

export function routeFrame(scene: RouteScene): RouteFrame {
  const narrow = scene.orientation === "down";
  const inFrame = (box: FlowBox): FlowBox => (narrow ? swapBox(box) : box);
  const stages = new Map<string, FrameCard>(
    [...scene.stages].map(([key, { box, rowCentres }]) => [
      key,
      { key, box: inFrame(box), rows: narrow ? [] : rowCentres },
    ]),
  );
  const end: FrameCard | undefined = scene.end && { key: null, box: inFrame(scene.end), rows: [] };
  const cards = [...stages.values(), ...(end ? [end] : [])];
  const start = scene.start === undefined ? undefined : stages.get(scene.start);
  const lines = scene.lines.flatMap((line, order): FrameLine[] => {
    const from = stages.get(line.fromKey);
    const to = line.to === null ? end : stages.get(line.to);
    return from && to ? [{ line, from, to, order }] : [];
  });
  return {
    narrow,
    cards,
    lines,
    mark: narrow ? { width: scene.mark.height, height: scene.mark.width } : scene.mark,
    start,
    obstacles: [...cards.map(({ box }) => box), ...(start ? [startMarkerBox(start.box)] : [])],
  };
}

function startMarkerBox(first: FlowBox): FlowBox {
  return {
    x: first.x - START_MARKER.reach,
    y: first.y + first.height / 2 - START_MARKER.height / 2,
    width: START_MARKER.reach,
    height: START_MARKER.height,
  };
}

/** The framed routes as the canvas draws them: each one's path, arrow and mark, and their bounds. */
export function drawnRoutes(
  frame: RouteFrame,
  routes: readonly FramedRoute[],
  rule: MarkRule,
): DrawnRoutes {
  const lines = routes.map(({ shape }) => shapePoints(shape));
  const marks = markSpots(
    routes.map(({ line }, index) => ({ points: lines[index]!, marked: isMarked(line.line) })),
    frame,
    rule,
  );
  const out = (point: Pt): Pt => (frame.narrow ? [point[1], point[0]] : point);
  const drawn = routes.map(({ line, shape, fromPort }, index): DrawnRoute => {
    const shown: RouteShape = {
      start: out(shape.start),
      radius: shape.radius,
      pieces: shape.pieces.map(({ to, bend }) => ({
        to: out(to),
        ...(bend ? { bend: [out(bend[0]), out(bend[1])] as const } : {}),
      })),
    };
    const mark = marks[index];
    return {
      line: line.line,
      d: shapePath(shown, ARROW_TRIM),
      arrow: arrowAt(shown.pieces.at(-1)?.to ?? shown.start, shapeHeading(shown)),
      mark: mark && toPoint(out(mark)),
      fromPort,
      points: lines[index]!.map((point) => toPoint(out(point))),
    };
  });
  const [width, height] = out([frame.mark.width, frame.mark.height]);
  return { routes: drawn, bounds: boundsOf(drawn, { width, height }) };
}

const toPoint = ([x, y]: Pt): FlowPoint => ({ x, y });

/** Half the line's stroke and half the arrow head's width, which reach past the line itself. */
const LINE_REACH = 4;

function boundsOf(
  routes: readonly DrawnRoute[],
  mark: { readonly width: number; readonly height: number },
): FlowBox | undefined {
  const boxes = routes.flatMap(({ points, mark: at }) => [
    ...points.map(({ x, y }) => boxAround([x, y], 2 * LINE_REACH, 2 * LINE_REACH)),
    ...(at ? [boxAround([at.x, at.y], mark.width, mark.height)] : []),
  ]);
  return unionOf(boxes);
}

/** The box around every box given; undefined for none. */
export function unionOf(boxes: readonly FlowBox[]): FlowBox | undefined {
  if (boxes.length === 0) return undefined;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map(right)) - x,
    height: Math.max(...boxes.map(bottom)) - y,
  };
}

/** The line a route was drawn as, by its line's id. */
export function routesById(drawn: DrawnRoutes): ReadonlyMap<string, DrawnRoute> {
  return new Map(drawn.routes.map((route) => [route.line.id, route]));
}
