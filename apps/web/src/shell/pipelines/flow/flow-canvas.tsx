import type { Stage, StageProblem } from "@the-office/contracts";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./flow-canvas.css";
import {
  drawingStart,
  endCellOf,
  flowGridSize,
  flowLines,
  type FlowOrientation,
  flowRoom,
  type FlowRoutePath,
  gridCellOf,
  listsRoutes,
  loopLanes,
  loopPaths,
  placeOf,
  routePaths,
  startPath,
} from "./flow-layout.ts";
import { type FlowLocks, type FlowOverlay, type FlowStageMarks, NO_LOCKS } from "./flow-marks.ts";
import { canDropAt, canMoveStage, inFlowOrder, stepInOrder } from "./flow-model.ts";
import type { FlowPick } from "./flow-pick.ts";
import { FlowStageCard } from "./flow-stage-card.tsx";
import { limitMark } from "./condition-words.ts";
import {
  arrowDirection,
  type FlowCanvasEdit,
  isPickedRoute,
  routeHasProblem,
  routeName,
  stageProblemsOf,
} from "./flow-view.ts";
import { type FlowOverviewShape, useFlowViewport } from "./flow-viewport-context.ts";
import { type FlowDrag, useFlowDrag } from "./use-flow-drag.ts";
import { type FlowView, useFlowMeasure } from "./use-flow-measure.ts";

export type { FlowCanvasEdit } from "./flow-view.ts";

export interface FlowCanvasProps {
  /** In the flow's order, each with its place and routes. */
  readonly stages: readonly Stage[];
  readonly picked: FlowPick | undefined;
  /** Without it nothing is picked: a press reads only. */
  readonly onPick?: (pick: FlowPick | undefined) => void;
  readonly problems: readonly StageProblem[];
  readonly warnings: readonly StageProblem[];
  readonly whoWorks: (stage: Stage) => string;
  /** Nothing moves: no +, no dragging, no keyboard edits. */
  readonly readOnly?: boolean;
  readonly marks?: FlowStageMarks;
  readonly overlay?: FlowOverlay;
  /**
   * A Task's started Stages: each with its lock, none dragged, moved or drawn from; trying to drag
   * one says why it stays.
   */
  readonly locked?: FlowLocks;
  readonly onEdit?: (edit: FlowCanvasEdit) => void;
}

const NO_MARKS: FlowStageMarks = new Map();

/**
 * The flow editor's canvas (docs/design/pipeline-flow.html): the Stages in a grid of places, End
 * after the last column, and the routes, on and back, drawn over it in one SVG from the boxes the
 * grid laid out, each with a limit marked ≤N× on its line. It asks the host for every edit through `onEdit`. A card keeps its size:
 * the FlowViewport around it (docs/design/pipeline-editor.html) moves and zooms it.
 */
export function FlowCanvas(props: FlowCanvasProps): ReactNode {
  const { stages, readOnly = false, marks = NO_MARKS, locked = NO_LOCKS } = props;
  const canvas = useRef<HTMLDivElement>(null);
  const viewport = useFlowViewport();
  const orientation = viewport?.orientation ?? "across";
  const namesOnly = viewport?.namesOnly ?? false;
  const view = useFlowMeasure(canvas, orientation);
  const lines = useMemo(() => flowLines(stages, props.overlay), [stages, props.overlay]);
  const loops = useMemo(() => loopLanes(stages), [stages]);
  const room = flowRoom(stages, lines, loops, orientation);
  const drawn: readonly FlowRoutePath[] = [
    ...routePaths(stages, lines, view.measure, orientation),
    ...loopPaths(loops, view.measure, orientation),
  ];
  const size = flowGridSize(stages);
  const canDrag = (key: string): boolean =>
    !readOnly && orientation === "across" && !locked.has(key);
  const canDraw = (key: string): boolean => !readOnly && !locked.has(key);
  const whyStays = (key: string): string | undefined => {
    const stage = stages.find((each) => each.key === key);
    if (!stage || readOnly || orientation !== "across" || !locked.has(key)) return undefined;
    return `${stage.name} has started, so it stays where it is.`;
  };
  const [told, setTold] = useState<FlowToldWhy | undefined>();
  const forget = useCallback(() => setTold(undefined), []);
  const dragging = useFlowDrag({
    canvas,
    canDrag,
    canDrop: (drop) => canDropAt(stages, drop, locked),
    canDraw,
    onEdit: props.onEdit,
    onDragMove: viewport?.followDrag,
    saysWhyItStays: (key) => whyStays(key) !== undefined,
    onStays: (key, { clientX, clientY }) => {
      const words = whyStays(key);
      if (words) setTold({ words, x: clientX, y: clientY, at: Date.now() });
    },
  });
  useOverviewAndPick(view, props.picked, viewport);
  const focusAfter = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const key = focusAfter.current;
    focusAfter.current = undefined;
    if (key !== undefined) stagePick(canvas.current, key)?.focus();
  });
  const pick = (next: FlowPick | undefined): void => {
    if (!dragging.endsDrag()) props.onPick?.(next);
  };
  const onStageKey = (event: KeyboardEvent<HTMLButtonElement>, key: string): void => {
    const direction = arrowDirection(event.key, orientation);
    if (!direction) return;
    event.preventDefault();
    if (event.shiftKey) {
      if (readOnly || !canMoveStage(stages, key, direction, locked)) return;
      focusAfter.current = key;
      props.onPick?.({ kind: "stage", key });
      props.onEdit?.({ kind: "move", key, direction });
      return;
    }
    const next = stepInOrder(stages, key, direction === "earlier" || direction === "up" ? -1 : 1);
    if (next === undefined) return;
    stagePick(canvas.current, next)?.focus();
    props.onPick?.({ kind: "stage", key: next });
  };
  const style = {
    ...(orientation === "down" && viewport ? { width: viewport.width } : {}),
    "--flow-columns": size.columns,
    "--flow-rows": size.rows,
    "--flow-loop-room": `${room.loops}px`,
    "--flow-detour-room": `${room.detours}px`,
  } as CSSProperties;
  return (
    <div
      ref={canvas}
      role="region"
      aria-label="Flow"
      className={canvasClass(readOnly, namesOnly, dragging.drag)}
      data-orientation={orientation}
      style={style}
      onKeyDown={(event) => removeRouteByKey(event, props)}
      onPointerMove={dragging.onPointerMove}
      onPointerUp={dragging.onPointerUp}
      onPointerCancel={dragging.onPointerCancel}
    >
      <div className="flow-canvas-grid">
        {inFlowOrder(stages).map((stage) => (
          <FlowStageCard
            key={stage.key}
            stage={stage}
            stages={stages}
            cell={gridCellOf(placeOf(stages, stage), orientation)}
            who={props.whoWorks(stage)}
            picked={props.picked}
            ownProblems={stageProblemsOf(props.problems, stage.key)}
            problems={props.problems}
            warningWords={warningWords(props.warnings, stage.key)}
            mark={marks.get(stage.key)}
            lockedNote={locked.get(stage.key)}
            listsRoutes={!namesOnly && listsRoutes(stage, stages)}
            showsHandle={canDraw(stage.key)}
            draggable={canDrag(stage.key)}
            dragging={stageOffset(dragging.drag, stage.key)}
            target={dragging.drag?.kind === "route" && dragging.drag.target === stage.key}
            onPick={pick}
            onStageKey={onStageKey}
            onStagePointer={dragging.onStagePointer}
            onHandlePointer={dragging.onHandlePointer}
          />
        ))}
        <div
          className={`flow-canvas-end${dragging.drag?.kind === "route" && dragging.drag.target === null ? " flow-canvas-end--target" : ""}`}
          role="img"
          aria-label="End"
          data-flow-end=""
          style={endCellOf(size, orientation)}
        >
          End
        </div>
      </div>
      <FlowLines
        {...props}
        stages={stages}
        view={view}
        orientation={orientation}
        routes={drawn}
        drag={dragging.drag}
        onPick={pick}
      />
      <LimitMarks routes={drawn} picked={props.picked} problems={props.problems} />
      {told && <FlowToldWhyToast key={told.at} told={told} onGone={forget} />}
      {dragging.drag?.kind === "stage" && dragging.drag.at && (
        <div
          className={`flow-canvas-drop${dragging.drag.at.drop.newColumn ? " flow-canvas-drop--column" : ""}`}
          style={{
            left: dragging.drag.at.ghost.x,
            top: dragging.drag.at.ghost.y,
            width: dragging.drag.at.ghost.width,
            height: dragging.drag.at.ghost.height,
          }}
        />
      )}
    </div>
  );
}

function canvasClass(readOnly: boolean, namesOnly: boolean, drag: FlowDrag | undefined): string {
  return [
    "flow-canvas",
    readOnly && "flow-canvas--read-only",
    namesOnly && "flow-canvas--names-only",
    drag?.kind === "route" && "flow-canvas--drawing",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Gives the viewport the Stages' blocks for its Overview, and brings a newly picked Stage (by Tab or
 * a problem's link) into view.
 */
function useOverviewAndPick(
  view: FlowView,
  picked: FlowPick | undefined,
  viewport: ReturnType<typeof useFlowViewport>,
): void {
  const pickedKey = picked?.key;
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!viewport) return;
    viewport.showOverview(overviewShape(view, pickedKey));
    if (pickedKey === shown.current) return;
    shown.current = pickedKey;
    const box = pickedKey === undefined ? undefined : view.measure.stages.get(pickedKey)?.box;
    if (box) viewport.bringIntoView(box);
  }, [view, pickedKey, viewport]);
}

function overviewShape(view: FlowView, pickedKey: string | undefined): FlowOverviewShape {
  return {
    blocks: [...view.measure.stages].map(([key, { box }]) => ({
      key,
      box,
      tone: key === pickedKey ? "picked" : "plain",
    })),
    end: view.measure.end,
  };
}

interface FlowToldWhy {
  readonly words: string;
  /** Where the pointer was, on the screen. */
  readonly x: number;
  readonly y: number;
  /** Each try says it again, its timer started afresh (the toast's key). */
  readonly at: number;
}

const TOLD_FOR_MS = 3200;

/**
 * Why a Stage stays, by the pointer. On the body, as the canvas is scaled by the viewport and the
 * words must stay readable whatever its zoom.
 */
function FlowToldWhyToast({
  told,
  onGone,
}: {
  readonly told: FlowToldWhy;
  readonly onGone: () => void;
}): ReactNode {
  useEffect(() => {
    const timer = window.setTimeout(onGone, TOLD_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [onGone]);
  return createPortal(
    <div
      className="flow-canvas-told"
      role="status"
      // Kept inside the window when the pointer is near its right or bottom edge.
      style={{
        left: `min(${told.x + 14}px, calc(100vw - 308px))`,
        top: `min(${told.y + 16}px, calc(100vh - 72px))`,
      }}
    >
      {told.words}
    </div>,
    document.body,
  );
}

function stagePick(canvas: HTMLElement | null, key: string): HTMLButtonElement | null {
  const card = [...(canvas?.querySelectorAll<HTMLElement>("[data-flow-stage]") ?? [])].find(
    (element) => element.dataset.flowStage === key,
  );
  return card?.querySelector<HTMLButtonElement>(".flow-canvas-stage-pick") ?? null;
}

function stageOffset(
  drag: FlowDrag | undefined,
  key: string,
): { dx: number; dy: number } | undefined {
  return drag?.kind === "stage" && drag.key === key && drag.moved
    ? { dx: drag.dx, dy: drag.dy }
    : undefined;
}

function warningWords(warnings: readonly StageProblem[], key: string): string {
  return warnings
    .filter(({ stageKey }) => stageKey === key)
    .map(({ text }) => text)
    .join(" ");
}

/** Delete or Backspace removes the route the focus is on, else the one picked. */
function removeRouteByKey(event: KeyboardEvent<HTMLElement>, props: FlowCanvasProps): void {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (props.readOnly || !props.onEdit) return;
  const focused = (event.target as Element).closest<HTMLElement>("[data-flow-route]");
  const [key, index] = focused?.dataset.flowRoute?.split(":") ?? [];
  const route =
    key !== undefined && index !== undefined
      ? { key, routeIndex: Number(index) }
      : props.picked?.kind === "route"
        ? props.picked
        : undefined;
  if (!route || props.locked?.has(route.key)) return;
  event.preventDefault();
  props.onEdit({ kind: "remove-route", key: route.key, routeIndex: route.routeIndex });
}

interface FlowLinesProps extends Omit<FlowCanvasProps, "onPick"> {
  readonly view: FlowView;
  readonly orientation: FlowOrientation;
  /** The routes on, then the routes back. */
  readonly routes: readonly FlowRoutePath[];
  readonly drag: FlowDrag | undefined;
  readonly onPick: (pick: FlowPick) => void;
}

/** The routes and where the walk starts, with a hit line under each route to press. */
function FlowLines(props: FlowLinesProps): ReactNode {
  const { view, orientation, routes } = props;
  const start = startPath(inFlowOrder(props.stages)[0], view.measure, orientation);
  return (
    <svg className="flow-canvas-lines" width={view.width} height={view.height} focusable="false">
      <g aria-hidden="true">
        {start && (
          <>
            <circle className="flow-canvas-start" cx={start.dot.x} cy={start.dot.y} r={4} />
            <path className="flow-canvas-start-line" d={start.d} />
            <polygon className="flow-canvas-start" points={start.arrow} />
          </>
        )}
        {routes.map((path) => (
          <g key={path.line.id} className={routeClass(props, path)}>
            <path className="flow-canvas-line" d={path.d} />
            <polygon className="flow-canvas-arrow" points={path.arrow} />
          </g>
        ))}
        <DrawingLine {...props} />
      </g>
      <g>
        {routes.map((path) => (
          <RouteHit key={path.line.id} {...props} path={path} />
        ))}
      </g>
    </svg>
  );
}

function routeClass(props: FlowLinesProps, { line }: FlowRoutePath): string {
  const { routeIndex, fromKey, look } = line;
  const picked = routeIndex !== undefined && isPickedRoute(props.picked, fromKey, routeIndex);
  const problem = routeIndex !== undefined && routeHasProblem(props.problems, fromKey, routeIndex);
  return [
    "flow-canvas-route-line",
    `flow-canvas-route-line--${look}`,
    problem && "flow-canvas-route-line--problem",
    picked && "flow-canvas-route-line--picked",
  ]
    .filter(Boolean)
    .join(" ");
}

function DrawingLine({ drag, view, orientation }: FlowLinesProps): ReactNode {
  if (drag?.kind !== "route") return null;
  const box = view.measure.stages.get(drag.from)?.box;
  if (!box) return null;
  const from = drawingStart(box, orientation);
  return (
    <path
      className="flow-canvas-drawing"
      d={`M${from.x},${from.y} L${drag.point.x},${drag.point.y}`}
    />
  );
}

/**
 * The wide, unseen line under a route that a press picks. A route its Stage doesn't list (its one
 * route, with no condition and No limit) has no line in the card, so this is where Tab reaches it.
 */
function RouteHit({
  path,
  stages,
  onPick,
}: FlowLinesProps & { readonly path: FlowRoutePath }): ReactNode {
  const { line } = path;
  const from = stages.find(({ key }) => key === line.fromKey);
  const route = line.routeIndex === undefined ? undefined : from?.routes?.[line.routeIndex];
  if (!from || !route || line.routeIndex === undefined) return null;
  const routeIndex = line.routeIndex;
  const choose = (): void => onPick({ kind: "route", key: from.key, routeIndex });
  const reachable = !listsRoutes(from, stages);
  return (
    <path
      className="flow-canvas-hit"
      d={path.d}
      data-flow-route={`${from.key}:${routeIndex}`}
      role={reachable ? "button" : undefined}
      tabIndex={reachable ? 0 : -1}
      aria-label={reachable ? routeName(from, route, stages) : undefined}
      aria-hidden={reachable ? undefined : true}
      onClick={choose}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        choose();
      }}
    />
  );
}

interface LimitMarksProps {
  readonly routes: readonly FlowRoutePath[];
  readonly picked: FlowPick | undefined;
  readonly problems: readonly StageProblem[];
}

/**
 * Each route's ≤N× mark on its line, for a route with a limit: in the route's own colour, never
 * pressed itself, as its line and its row pick it, whose names say the limit too.
 */
function LimitMarks({ routes, picked, problems }: LimitMarksProps): ReactNode {
  return (
    <div className="flow-canvas-marks" aria-hidden="true">
      {routes.map(({ line, mark }) => {
        const words = limitMark(line.limit);
        if (words === "") return null;
        const { fromKey, routeIndex, look } = line;
        const markClass = [
          "flow-canvas-limit-mark",
          `flow-canvas-limit-mark--${look}`,
          routeIndex !== undefined &&
            routeHasProblem(problems, fromKey, routeIndex) &&
            "flow-canvas-limit-mark--problem",
          routeIndex !== undefined &&
            isPickedRoute(picked, fromKey, routeIndex) &&
            "flow-canvas-limit-mark--picked",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <span
            key={line.id}
            className={markClass}
            data-flow-limit-mark={line.id}
            style={{ left: mark.x, top: mark.y }}
          >
            {words}
          </span>
        );
      })}
    </div>
  );
}
