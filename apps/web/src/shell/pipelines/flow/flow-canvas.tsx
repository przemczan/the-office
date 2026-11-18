import type { Stage, StageProblem } from "@the-office/contracts";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import "./flow-canvas.css";
import {
  drawingStart,
  endCellOf,
  flowGridSize,
  flowLines,
  type FlowLoopPath,
  type FlowOrientation,
  flowRoom,
  type FlowRoutePath,
  gridCellOf,
  listsRoutes,
  loopLanes,
  loopPaths,
  orientationFor,
  placeOf,
  routePaths,
  startPath,
} from "./flow-layout.ts";
import type { FlowOverlay, FlowStageMarks } from "./flow-marks.ts";
import { canMoveStage, inFlowOrder, stepInOrder } from "./flow-model.ts";
import type { FlowPick } from "./flow-pick.ts";
import { FlowStageCard } from "./flow-stage-card.tsx";
import {
  arrowDirection,
  type FlowCanvasEdit,
  isPickedRoute,
  loopHasProblem,
  loopWords,
  routeHasProblem,
  routeName,
  stageProblemsOf,
} from "./flow-view.ts";
import { type FlowDrag, useFlowDrag } from "./use-flow-drag.ts";
import { type FlowView, useFlowMeasure } from "./use-flow-measure.ts";

export type { FlowCanvasEdit } from "./flow-view.ts";

export interface FlowCanvasProps {
  /** In the flow's order, each with its place and routes; a Project Pipeline's removed ones too. */
  readonly stages: readonly Stage[];
  readonly picked: FlowPick | undefined;
  /** Without it nothing is picked: a press reads only. */
  readonly onPick?: (pick: FlowPick | undefined) => void;
  readonly problems: readonly StageProblem[];
  readonly warnings: readonly StageProblem[];
  readonly whoWorks: (stage: Stage) => string;
  /** Nothing moves: no +, no dragging, no keyboard edits. */
  readonly readOnly?: boolean;
  /** False on a Project page: Stages keep the base Pipeline's places, though routes are drawn. */
  readonly draggable?: boolean;
  readonly marks?: FlowStageMarks;
  readonly overlay?: FlowOverlay;
  readonly onEdit?: (edit: FlowCanvasEdit) => void;
}

const NO_MARKS: FlowStageMarks = new Map();

/**
 * The flow editor's canvas (docs/design/pipeline-flow.html): the Stages in a grid of places, End
 * after the last column, and the routes and On failure loops drawn over it in one SVG from the
 * boxes the grid laid out. It asks the host for every edit through `onEdit`.
 */
export function FlowCanvas(props: FlowCanvasProps): ReactNode {
  const { stages, readOnly = false, draggable = true, marks = NO_MARKS } = props;
  const canvas = useRef<HTMLDivElement>(null);
  const view = useFlowMeasure(canvas);
  const orientation = orientationFor(view.width);
  const removed = useMemo(
    () => new Set([...marks].filter(([, mark]) => mark.tone === "removed").map(([key]) => key)),
    [marks],
  );
  const live = useMemo(() => stages.filter(({ key }) => !removed.has(key)), [stages, removed]);
  const lines = useMemo(
    () => flowLines(stages, removed, props.overlay),
    [stages, removed, props.overlay],
  );
  const loops = useMemo(() => loopLanes(live), [live]);
  const room = flowRoom(stages, lines, loops);
  const loopLines = loopPaths(loops, view.measure, orientation);
  const size = flowGridSize(stages);
  const canDrag = (key: string): boolean =>
    !readOnly && draggable && orientation === "across" && !removed.has(key);
  const dragging = useFlowDrag({ canvas, canDrag, canDraw: !readOnly, onEdit: props.onEdit });
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
      if (readOnly || !draggable || removed.has(key) || !canMoveStage(stages, key, direction))
        return;
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
      className={canvasClass(readOnly, dragging.drag)}
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
            listsRoutes={listsRoutes(stage)}
            showsHandle={!readOnly}
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
        live={live}
        view={view}
        orientation={orientation}
        routes={routePaths(stages, lines, view.measure, orientation)}
        loops={loopLines}
        drag={dragging.drag}
        marksOf={marks}
        onPick={pick}
      />
      <LoopMarks loops={loopLines} stages={stages} problems={props.problems} onPick={pick} />
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

function canvasClass(readOnly: boolean, drag: FlowDrag | undefined): string {
  return [
    "flow-canvas",
    readOnly && "flow-canvas--read-only",
    drag?.kind === "route" && "flow-canvas--drawing",
  ]
    .filter(Boolean)
    .join(" ");
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
  if (!route) return;
  event.preventDefault();
  props.onEdit({ kind: "remove-route", key: route.key, routeIndex: route.routeIndex });
}

interface FlowLinesProps extends Omit<FlowCanvasProps, "onPick"> {
  readonly live: readonly Stage[];
  readonly view: FlowView;
  readonly orientation: FlowOrientation;
  readonly routes: readonly FlowRoutePath[];
  readonly loops: readonly FlowLoopPath[];
  readonly drag: FlowDrag | undefined;
  readonly marksOf: FlowStageMarks;
  readonly onPick: (pick: FlowPick) => void;
}

/** The routes, the loops and where the walk starts, with a hit line under each route to press. */
function FlowLines(props: FlowLinesProps): ReactNode {
  const { view, orientation, routes, loops } = props;
  const start = startPath(inFlowOrder(props.live)[0], view.measure, orientation);
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
        {loops.map((loop) => (
          <g
            key={`${loop.fromKey}:loop`}
            className={`flow-canvas-loop${loopHasProblem(props.problems, loop.fromKey) ? " flow-canvas-loop--problem" : ""}`}
          >
            <path className="flow-canvas-line" d={loop.d} />
            <polygon className="flow-canvas-arrow" points={loop.arrow} />
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
    look === "plain" && routeTone(props.marksOf, fromKey, line.to),
    problem && "flow-canvas-route-line--problem",
    picked && "flow-canvas-route-line--picked",
  ]
    .filter(Boolean)
    .join(" ");
}

/** On a Project Pipeline, a route out of or into an inserted Stage is green, one whose routes changed amber. */
function routeTone(marks: FlowStageMarks, fromKey: string, to: string | null): string | false {
  const from = marks.get(fromKey)?.tone;
  if (from === "inserted" || (to !== null && marks.get(to)?.tone === "inserted"))
    return "flow-canvas-route-line--inserted";
  return from === "routes-changed" && "flow-canvas-route-line--changed";
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
 * route, with no condition) has no line in the card, so this is where Tab reaches it.
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
  const reachable = line.port === undefined;
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

interface LoopMarksProps {
  readonly loops: readonly FlowLoopPath[];
  readonly stages: readonly Stage[];
  readonly problems: readonly StageProblem[];
  readonly onPick: (pick: FlowPick) => void;
}

/** Each loop's ↺ N× mark, which opens its Stage at On failure. */
function LoopMarks({ loops, stages, problems, onPick }: LoopMarksProps): ReactNode {
  return (
    <div className="flow-canvas-marks">
      {loops.map((loop) => {
        const from = stages.find(({ key }) => key === loop.fromKey);
        const words = from ? loopWords(from, stages)?.name : undefined;
        return (
          <button
            key={loop.fromKey}
            type="button"
            className={`flow-canvas-loop-mark${loopHasProblem(problems, loop.fromKey) ? " flow-canvas-loop-mark--problem" : ""}`}
            style={{ left: loop.mark.x, top: loop.mark.y }}
            aria-label={words}
            title={words}
            onClick={() => onPick({ kind: "onFailure", key: loop.fromKey })}
          >
            ↺ {loop.rounds}×
          </button>
        );
      })}
    </div>
  );
}
