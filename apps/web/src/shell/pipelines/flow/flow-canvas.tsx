import type { Stage, StagePosition, StageProblem } from "@the-office/contracts";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./flow-canvas.css";
import type { FlowCardSize } from "./flow-auto-align.ts";
import {
  drawingStart,
  type FlowBox,
  type FlowGridCell,
  flowLines,
  type FlowMeasure,
  type FlowOrientation,
  flowRoom,
  type FlowRoutePath,
  listsRoutes,
  loopLanes,
  loopPaths,
  narrowBands,
  narrowLayout,
  routePaths,
  startPath,
} from "./flow-layout.ts";
import { type FlowLocks, type FlowOverlay, type FlowStageMarks, NO_LOCKS } from "./flow-marks.ts";
import { stepInOrder, withStagePositioned } from "./flow-model.ts";
import type { FlowPick } from "./flow-pick.ts";
import {
  CARD_WIDTH,
  derivedEndPosition,
  END_SIZE,
  estimatedCardHeight,
  type FlowCard,
  type FlowGuide,
  GRID_STEP,
  steppedPast,
} from "./flow-snap.ts";
import { FlowStageCard } from "./flow-stage-card.tsx";
import { limitMark } from "./condition-words.ts";
import {
  arrowStep,
  type FlowCanvasEdit,
  isPickedRoute,
  routeHasProblem,
  routeName,
  stageProblemsOf,
} from "./flow-view.ts";
import { type FlowOverviewShape, useFlowViewport } from "./flow-viewport-context.ts";
import { type CardDrag, type FlowDrag, useFlowDrag } from "./use-flow-drag.ts";
import { type FlowView, useFlowMeasure } from "./use-flow-measure.ts";

export type { FlowCanvasEdit } from "./flow-view.ts";

export interface FlowCanvasProps {
  /** In the Pipeline's order, each with its position and routes. */
  readonly stages: readonly Stage[];
  /** Where End stands; derived, right of the right-most Stage, without. */
  readonly endPosition?: StagePosition | undefined;
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
  /** A Task's started Stages: each with its lock, none drawn from; each can still be moved. */
  readonly locked?: FlowLocks;
  readonly onEdit?: (edit: FlowCanvasEdit) => void;
  /** Counts Auto-align's layouts: each new one glides the cards to their places and fits the view. */
  readonly glide?: number;
  /** The cards' sizes at 100% as measured across, which Auto-align lays them out by. */
  readonly onCardSizes?: (sizes: ReadonlyMap<string, FlowCardSize>) => void;
}

const NO_MARKS: FlowStageMarks = new Map();

/** How long Auto-align's cards glide to their places (--duration-slow). */
const GLIDE_MS = 280;

/**
 * The flow editor's canvas (docs/design/pipeline-flow.html, docs/design/pipeline-free-placement.html):
 * each Stage where it stands, End where it stands or right of the right-most Stage, and the routes,
 * on and back, drawn under them in one SVG from the boxes the canvas measured, each with a limit
 * marked ≤N× on its line. The canvas's box grows around every card, so a position left of or
 * above the others works. Under 560px the Stages stand in bands from their positions, top to
 * bottom. It asks the host for every edit through `onEdit`. A card keeps its size: the
 * FlowViewport around it (docs/design/pipeline-editor.html) moves and zooms it.
 */
export function FlowCanvas(props: FlowCanvasProps): ReactNode {
  const { stages, readOnly = false, marks = NO_MARKS, locked = NO_LOCKS } = props;
  const canvas = useRef<HTMLDivElement>(null);
  const viewport = useFlowViewport();
  const orientation = viewport?.orientation ?? "across";
  const across = orientation === "across";
  const namesOnly = viewport?.namesOnly ?? false;
  const view = useFlowMeasure(canvas, orientation);
  const cards = cardsOf(stages, props.endPosition, view.measure, across);
  // Positions are never locked: a Task's started Stage moves as any other.
  const canDrag = (): boolean => !readOnly && across;
  const canDraw = (key: string): boolean => !readOnly && !locked.has(key);
  const dragging = useFlowDrag({
    canvas,
    canDrag,
    canDraw,
    cards,
    origin: originOf(cards),
    zoom: viewport?.zoom ?? 1,
    onEdit: props.onEdit,
    onDragMove: viewport?.followDrag,
  });
  const moving = movingCard(dragging.drag);
  const shown = useMemo(
    () => (moving?.key ? withStagePositioned(stages, moving.key, moving.shown) : stages),
    [stages, moving],
  );
  const shownCards = moving
    ? cardsOf(shown, endShown(props.endPosition, moving), view.measure, across)
    : cards;
  const origin = moving?.origin ?? originOf(shownCards);
  const narrow = useMemo(() => narrowLayout(narrowBands(shown)), [shown]);
  const lines = useMemo(() => flowLines(shown, props.overlay), [shown, props.overlay]);
  const loops = useMemo(
    () =>
      loopLanes(
        shown,
        across ? (stage) => stage.position?.x ?? 0 : (stage) => narrow.bands.get(stage.key) ?? 0,
      ),
    [shown, across, narrow],
  );
  const room = flowRoom(lines, loops, view.measure, orientation);
  const drawn: readonly FlowRoutePath[] = [
    ...routePaths(lines, view.measure, orientation),
    ...loopPaths(loops, view.measure, orientation),
  ];
  const gliding = useGlide(props.glide, viewport?.fit);
  useOverviewAndPick(view, props.picked, viewport);
  useKeptInPlace(origin, across, viewport?.shiftBy);
  useCardSizes(view.measure, across && !namesOnly, props.onCardSizes);
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
    const step = arrowStep(event.key);
    if (!step) return;
    event.preventDefault();
    if (event.shiftKey) {
      const own = cards.find((card) => card.key === key);
      if (!canDrag() || !own) return;
      const others = cards.filter((card) => card.key !== key);
      focusAfter.current = key;
      props.onPick?.({ kind: "stage", key });
      props.onEdit?.({ kind: "move-to", key, position: steppedPast(own.box, others, step) });
      return;
    }
    const next = stepInOrder(stages, key, step.by);
    if (next === undefined) return;
    stagePick(canvas.current, next)?.focus();
    props.onPick?.({ kind: "stage", key: next });
  };
  // While a drag lasts the canvas only grows: shrinking it would have the viewport clamp its view
  // and slide the canvas, and the dragged card, out from under the pointer.
  const field = fieldBox(moving ? [...cards, ...shownCards] : shownCards, origin);
  const style = {
    ...(!across && viewport ? { width: viewport.width } : {}),
    "--flow-loop-room": `${room.loops}px`,
    "--flow-detour-room": `${room.detours}px`,
    "--flow-grid-x": `${modulo(-origin.x, GRID_STEP) - GRID_STEP / 2}px`,
    "--flow-grid-y": `${modulo(-origin.y, GRID_STEP) - GRID_STEP / 2}px`,
  } as CSSProperties;
  const placeOf = (key: string | null): CSSProperties | FlowGridCell => {
    if (!across) return key === null ? narrow.end : (narrow.cells.get(key) ?? narrow.end);
    const box = shownCards.find((card) => card.key === key)?.box;
    return box ? { left: box.x - origin.x, top: box.y - origin.y } : {};
  };
  const endTarget = dragging.drag?.kind === "route" && dragging.drag.target === null;
  return (
    <div
      ref={canvas}
      role="region"
      aria-label="Flow"
      className={canvasClass(readOnly, namesOnly, dragging.drag, gliding)}
      data-orientation={orientation}
      style={style}
      onKeyDown={(event) => removeRouteByKey(event, props)}
      onPointerMove={dragging.onPointerMove}
      onPointerUp={dragging.onPointerUp}
      onPointerCancel={dragging.onPointerCancel}
    >
      <div
        className="flow-canvas-stages"
        style={
          across
            ? { width: field.width, height: field.height }
            : ({ "--flow-band-columns": narrow.columns } as CSSProperties)
        }
      >
        {shown.map((stage) => (
          <FlowStageCard
            key={stage.key}
            stage={stage}
            stages={shown}
            place={placeOf(stage.key)}
            who={props.whoWorks(stage)}
            picked={props.picked}
            ownProblems={stageProblemsOf(props.problems, stage.key)}
            problems={props.problems}
            warningWords={warningWords(props.warnings, stage.key)}
            mark={marks.get(stage.key)}
            lockedNote={locked.get(stage.key)}
            listsRoutes={!namesOnly && listsRoutes(stage, shown)}
            showsHandle={canDraw(stage.key)}
            draggable={canDrag()}
            dragging={moving?.key === stage.key}
            target={dragging.drag?.kind === "route" && dragging.drag.target === stage.key}
            onPick={pick}
            onStageKey={onStageKey}
            onStagePointer={dragging.onCardPointer}
            onHandlePointer={dragging.onHandlePointer}
          />
        ))}
        <div
          className={[
            "flow-canvas-end",
            endTarget && "flow-canvas-end--target",
            canDrag() && "flow-canvas-end--draggable",
            moving?.key === null && "flow-canvas-end--dragging",
          ]
            .filter(Boolean)
            .join(" ")}
          role="img"
          aria-label="End"
          data-flow-end=""
          style={placeOf(null)}
          onPointerDown={(event) => dragging.onCardPointer(event, null)}
        >
          End
        </div>
        {moving && <DragMarks drag={moving} cards={shownCards} origin={origin} />}
      </div>
      <FlowLines
        {...props}
        stages={shown}
        view={view}
        orientation={orientation}
        routes={drawn}
        drag={dragging.drag}
        onPick={pick}
      />
      <LimitMarks routes={drawn} picked={props.picked} problems={props.problems} />
    </div>
  );
}

/** The card being dragged, once it has moved. */
function movingCard(drag: FlowDrag | undefined): CardDrag | undefined {
  return drag?.kind === "card" && drag.moved ? drag : undefined;
}

function endShown(end: StagePosition | undefined, moving: CardDrag): StagePosition | undefined {
  return moving.key === null ? moving.shown : end;
}

/**
 * Every card as it stands, in canvas units: each Stage at its position, End at its own or where it
 * is derived. Across, each is as large as it was measured; down, and before a measure, estimated.
 */
function cardsOf(
  stages: readonly Stage[],
  end: StagePosition | undefined,
  measure: FlowMeasure,
  across: boolean,
): readonly FlowCard[] {
  const placed = stages.map((stage) => {
    // A card not laid out yet (or hidden) measures nothing: its size is estimated meanwhile.
    const found = across ? measure.stages.get(stage.key) : undefined;
    const measured = found && found.box.width > 0 ? found : undefined;
    const box: FlowBox = {
      ...(stage.position ?? { x: 0, y: 0 }),
      width: measured?.box.width ?? CARD_WIDTH,
      height: measured?.box.height ?? estimatedCardHeight(stage),
    };
    const rowCentres = measured?.rowCentres.map((centre) => centre - measured.box.y) ?? [];
    return { stage, box, rowCentres };
  });
  const endAt =
    end ??
    derivedEndPosition(
      placed.map(({ stage, box, rowCentres }) => ({ box, routes: stage.routes, rowCentres })),
    );
  return [
    ...placed.map(({ stage, box }) => ({ key: stage.key, box })),
    { key: null, box: { ...endAt, width: END_SIZE, height: END_SIZE } },
  ];
}

/** The top-left of the box around every card. */
function originOf(cards: readonly FlowCard[]): StagePosition {
  return {
    x: Math.min(...cards.map(({ box }) => box.x)),
    y: Math.min(...cards.map(({ box }) => box.y)),
  };
}

/** The size of the box around every card, from `origin`. */
function fieldBox(
  cards: readonly FlowCard[],
  origin: StagePosition,
): { width: number; height: number } {
  return {
    width: Math.max(0, ...cards.map(({ box }) => box.x + box.width - origin.x)),
    height: Math.max(0, ...cards.map(({ box }) => box.y + box.height - origin.y)),
  };
}

const modulo = (value: number, by: number): number => ((value % by) + by) % by;

/**
 * While a card is dragged: the dashed guides to what it snapped to, each with a dot on each end,
 * and the dashed outline of where it lands when that isn't where it shows.
 */
function DragMarks({
  drag,
  cards,
  origin,
}: {
  readonly drag: CardDrag;
  readonly cards: readonly FlowCard[];
  readonly origin: StagePosition;
}): ReactNode {
  const size = cards.find(({ key }) => key === drag.key)?.box;
  const landing = drag.landing?.covered ? drag.landing.position : undefined;
  return (
    <>
      {landing && size && (
        <div
          className="flow-canvas-landing"
          style={{
            left: landing.x - origin.x,
            top: landing.y - origin.y,
            width: size.width,
            height: size.height,
          }}
        />
      )}
      <svg className="flow-canvas-guides" width={1} height={1} aria-hidden="true" focusable="false">
        {drag.guides.map((guide) => (
          <GuideLine key={guide.axis} guide={guide} origin={origin} />
        ))}
      </svg>
    </>
  );
}

function GuideLine({
  guide,
  origin,
}: {
  readonly guide: FlowGuide;
  readonly origin: StagePosition;
}): ReactNode {
  const upright = guide.axis === "x";
  const [x1, y1, x2, y2] = upright
    ? [guide.at - origin.x, guide.from - origin.y, guide.at - origin.x, guide.to - origin.y]
    : [guide.from - origin.x, guide.at - origin.y, guide.to - origin.x, guide.at - origin.y];
  return (
    <g>
      <line className="flow-canvas-guide" x1={x1} y1={y1} x2={x2} y2={y2} />
      <circle className="flow-canvas-guide-dot" cx={x1} cy={y1} r={2.5} />
      <circle className="flow-canvas-guide-dot" cx={x2} cy={y2} r={2.5} />
    </g>
  );
}

/**
 * Whether Auto-align's cards are gliding to their places: from the render that brings them, for
 * 280ms (none with reduced motion, as the canvas's CSS has no transition then). Each new layout
 * fits the view to the Pipeline.
 */
function useGlide(glide: number | undefined, fit: (() => void) | undefined): boolean {
  const [settled, setSettled] = useState(glide);
  const fitting = useRef(fit);
  useLayoutEffect(() => {
    fitting.current = fit;
  });
  useEffect(() => {
    if (glide === settled) return undefined;
    fitting.current?.();
    const timer = window.setTimeout(() => setSettled(glide), GLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [glide, settled]);
  return glide !== settled;
}

/**
 * When the box around the cards starts somewhere else (a card dropped left of or above the
 * others), the view moves by as much, so every card stays where it was on the screen.
 */
function useKeptInPlace(
  { x, y }: StagePosition,
  across: boolean,
  shiftBy: ((dx: number, dy: number) => void) | undefined,
): void {
  const last = useRef<StagePosition | undefined>(undefined);
  useLayoutEffect(() => {
    const was = last.current;
    last.current = { x, y };
    if (!was || !across || !shiftBy) return;
    if (x !== was.x || y !== was.y) shiftBy(x - was.x, y - was.y);
  }, [x, y, across, shiftBy]);
}

/** Tells the editor each card's size at 100% as measured across, for Auto-align. */
function useCardSizes(
  measure: FlowMeasure,
  full: boolean,
  onSizes: ((sizes: ReadonlyMap<string, FlowCardSize>) => void) | undefined,
): void {
  useEffect(() => {
    if (!full || !onSizes) return;
    onSizes(
      new Map(
        [...measure.stages]
          // A card not laid out yet measures nothing; Auto-align estimates its size instead.
          .filter(([, { box }]) => box.width > 0)
          .map(([key, { box, rowCentres }]): [string, FlowCardSize] => [
            key,
            {
              width: box.width,
              height: box.height,
              rowCentres: rowCentres.map((centre) => centre - box.y),
            },
          ]),
      ),
    );
  }, [measure, full, onSizes]);
}

function canvasClass(
  readOnly: boolean,
  namesOnly: boolean,
  drag: FlowDrag | undefined,
  gliding: boolean,
): string {
  return [
    "flow-canvas",
    readOnly && "flow-canvas--read-only",
    namesOnly && "flow-canvas--names-only",
    drag?.kind === "route" && "flow-canvas--drawing",
    movingCard(drag) && "flow-canvas--snapping",
    gliding && "flow-canvas--gliding",
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

function stagePick(canvas: HTMLElement | null, key: string): HTMLButtonElement | null {
  const card = [...(canvas?.querySelectorAll<HTMLElement>("[data-flow-stage]") ?? [])].find(
    (element) => element.dataset.flowStage === key,
  );
  return card?.querySelector<HTMLButtonElement>(".flow-canvas-stage-pick") ?? null;
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
  const start = startPath(props.stages[0], view.measure, orientation);
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
