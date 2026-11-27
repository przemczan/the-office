import type { Stage, StagePosition, StageProblem } from "@the-office/contracts";
import {
  Button,
  Icon,
  SegmentedControl,
  TextButton,
  Tooltip,
  useCloseOnEscape,
} from "@the-office/ui";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { StageCheckAlerts } from "../stage-check-alerts.tsx";
import { elkInWorker } from "./elk-in-worker.ts";
import { autoAligned, estimatedCardSize, type FlowCardSize } from "./flow-auto-align.ts";
import { FlowCanvas, type FlowCanvasEdit } from "./flow-canvas.tsx";
import { AUTO_ALIGN_FAILED, howToHint } from "./flow-editor-words.ts";
import { type FlowOrientation, listsRoutes, orientationFor } from "./flow-layout.ts";
import type { FlowLocks, FlowOverlay, FlowStageMarks } from "./flow-marks.ts";
import { type FlowPositions, positionsOf } from "./flow-model.ts";
import { type FlowPick, pickOfProblem } from "./flow-pick.ts";
import { FlowViewport } from "./flow-viewport.tsx";
import type { FlowEdited } from "./office-flow-edits.ts";
import { ROUTE_DRAWINGS, type RouteDrawing } from "./flow-routes/route-drawer.ts";
import { ROUTE_DRAWING_WORDS, useRouteDrawing } from "./use-route-drawing.ts";
import "./flow-editor.css";

/**
 * What is picked, what the hint says and whether Auto-align's Undo is offered, which the host keeps
 * (`useFlowEditorControls`) so its panel and edits read and change them: picking clears the hint,
 * and an edit then says what it did. The next edit of any kind takes Auto-align's Undo away.
 */
export interface FlowEditorControls {
  readonly picked: FlowPick | undefined;
  readonly pick: (pick: FlowPick | undefined) => void;
  /** What an edit just did; undefined goes back to how to use the editor. */
  readonly hint: string | undefined;
  readonly say: (hint: string | undefined) => void;
  /** Where the Stages and End stood before Auto-align, while its Undo is offered. */
  readonly undo: FlowPositions | undefined;
  /** An edit was applied: what it picks, says and offers to undo. */
  readonly took: (edited: FlowEdited) => void;
}

/** `initial`: what the editor opens picked, such as the Stage an address names. */
export function useFlowEditorControls(initial?: FlowPick): FlowEditorControls {
  const [picked, setPicked] = useState<FlowPick | undefined>(initial);
  const [hint, setHint] = useState<string | undefined>();
  const [undo, setUndo] = useState<FlowPositions | undefined>();
  return {
    picked,
    pick: (next) => {
      setPicked(next);
      setHint(undefined);
      setUndo(undefined);
    },
    hint,
    say: (next) => {
      setHint(next);
      setUndo(undefined);
    },
    undo,
    took: (edited) => {
      if ("pick" in edited) setPicked(edited.pick);
      // Picking, or any edit after Auto-align, replaces what the hint said.
      if ("pick" in edited || undo) setHint(undefined);
      if (edited.hint !== undefined) setHint(edited.hint);
      setUndo(edited.undo);
    },
  };
}

export interface FlowEditorProps {
  /** The head's title, such as "Stages and routes". */
  readonly title: string;
  /** Under the title, such as "4 Stages · 5 routes · 2 routes back". */
  readonly summary: string;
  /** The flow in the Pipeline's order, each Stage with its position and routes. */
  readonly stages: readonly Stage[];
  /** Where End stands; derived, right of the right-most Stage, without. */
  readonly endPosition?: StagePosition | undefined;
  readonly problems: readonly StageProblem[];
  readonly warnings: readonly StageProblem[];
  readonly problemsTitle?: string;
  readonly whoWorks: (stage: Stage) => string;
  /** Nothing moves or opens for editing: a Proposal on the flow. */
  readonly readOnly?: boolean;
  readonly marks?: FlowStageMarks;
  readonly overlay?: FlowOverlay;
  /**
   * "Edit for this Task": the Task's started Stages, by key, with why each is locked. None is
   * dragged, moved or removed, and no route is drawn or changed out of one; routes into one are.
   */
  readonly locked?: FlowLocks;
  /** Under the head, what the lines mean; the office-wide legend without. */
  readonly legend?: ReactNode;
  /** The hint's words when no edit has said anything; the office-wide words without. */
  readonly howTo?: (orientation: FlowOrientation) => string;
  /** What is picked and what the hint says, from `useFlowEditorControls`. */
  readonly controls: FlowEditorControls;
  /** Applies a canvas's edit, as the host keeps its Stages. */
  readonly onEdit?: (edit: FlowCanvasEdit) => void;
  /** The head's menu, such as Add a Stage, after Auto-align. */
  readonly head?: ReactNode;
  /** The panel under the canvas, for what `controls` has picked. */
  readonly panel: ReactNode;
  /** In full screen, before the title, such as "Full ·". */
  readonly fullScreenName?: string;
  /** In full screen, under the panel: the host's Save, so it stays at hand. */
  readonly fullScreenBar?: ReactNode;
}

/**
 * The Pipeline flow editor (docs/design/pipeline-flow.html, docs/design/pipeline-editor.html,
 * docs/design/pipeline-free-placement.html): a head with Auto-align and the host's menu, the hint,
 * the canvas in its viewport (pan, zoom, Fit, the Overview, full screen), the host's panel for what
 * is picked, and the check's problems, each a link that picks where it is. The host keeps the
 * Stages and applies every edit with flow-model: a Pipeline (Settings › Pipelines, a Project's
 * Pipelines) or a Task's Stages; a Proposal shows on it read-only.
 */
export function FlowEditor(props: FlowEditorProps): ReactNode {
  const [fullScreen, setFullScreen] = useState(false);
  const exit = useCallback(() => setFullScreen(false), []);
  const slot = useRef<HTMLDivElement>(null);
  const [place] = useState(createEditorPlace);
  useFullScreenPlace(place, slot, fullScreen, exit);
  return (
    <>
      <div ref={slot} className="flow-editor-slot" />
      {createPortal(
        <FlowEditorBody {...props} fullScreen={fullScreen} onFullScreen={setFullScreen} />,
        place,
      )}
    </>
  );
}

function FlowEditorBody(
  props: FlowEditorProps & {
    readonly fullScreen: boolean;
    readonly onFullScreen: (on: boolean) => void;
  },
): ReactNode {
  const { stages, problems, warnings, controls, readOnly = false, fullScreen } = props;
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const orientation = orientationFor(useWidth(root));
  const sizes = useRef<ReadonlyMap<string, FlowCardSize>>(new Map());
  const [glide, setGlide] = useState(0);
  const [routeDrawing, chooseRouteDrawing] = useRouteDrawing();
  const undo = controls.undo;
  const undoAutoAlign = (): void => {
    if (undo) props.onEdit?.({ kind: "undo-auto-align", before: undo });
  };
  const shared = {
    stages,
    endPosition: props.endPosition,
    picked: controls.picked,
    onPick: controls.pick,
    problems,
    warnings,
    whoWorks: props.whoWorks,
    readOnly,
    marks: props.marks,
    locked: props.locked,
    onEdit: props.onEdit,
    routeDrawing,
  };
  const words = controls.hint ?? (props.howTo ?? defaultHowTo(readOnly))(orientation);
  // Ctrl/⌘ + Z undoes Auto-align while its Undo is offered, but never a field's own typing.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!undo || event.key.toLowerCase() !== "z" || event.shiftKey) return;
    if (!(event.ctrlKey || event.metaKey) || isTyping(event.target as Element)) return;
    event.preventDefault();
    undoAutoAlign();
  };
  return (
    <div
      ref={root}
      className={`flow-editor${orientation === "down" ? " flow-editor--narrow" : ""}${
        fullScreen ? " flow-editor--full-screen" : ""
      }`}
      onKeyDown={onKeyDown}
    >
      <div className="flow-editor-head">
        <div className="flow-editor-title">
          <b>
            {fullScreen && props.fullScreenName
              ? `${props.fullScreenName} ${props.title}`
              : props.title}
          </b>
          <span>{props.summary}</span>
        </div>
        <RouteDrawingSwitch drawing={routeDrawing} onChoose={chooseRouteDrawing} />
        {!readOnly && orientation === "across" && (
          <AutoAlignButton
            stages={stages}
            endPosition={props.endPosition}
            sizes={sizes}
            onEdit={props.onEdit}
            onAligned={() => setGlide((count) => count + 1)}
            onFailed={() => controls.say(AUTO_ALIGN_FAILED)}
          />
        )}
        {!readOnly && props.head}
        {fullScreen && (
          <Button
            variant="accent"
            iconLeft={<Icon name="minimize-2" size={14} />}
            onClick={() => props.onFullScreen(false)}
          >
            Exit full screen
          </Button>
        )}
      </div>
      {props.legend ?? <OfficeLegend />}
      <p className="flow-editor-hint" role="status">
        <Icon name="info" size={13} />
        <span>
          {words}
          {undo && (
            <>
              {" "}
              <TextButton onClick={undoAutoAlign}>Undo</TextButton>
            </>
          )}
        </span>
      </p>
      <FlowViewport fullScreen={fullScreen} onFullScreen={props.onFullScreen}>
        <FlowCanvas
          {...shared}
          overlay={props.overlay}
          glide={glide}
          onCardSizes={(measured) => {
            sizes.current = measured;
          }}
        />
      </FlowViewport>
      <div ref={panel} className="flow-editor-panel">
        {props.panel}
      </div>
      <div className="flow-editor-checks">
        <StageCheckAlerts
          problems={problems}
          warnings={warnings}
          problemsTitle={props.problemsTitle ?? "The Pipeline can't be saved yet"}
          onPick={(problem) => {
            const at = pickOfProblem(problem);
            if (!at) return;
            controls.pick(at);
            panel.current?.scrollIntoView?.({ block: "nearest" });
          }}
        />
      </div>
      {fullScreen && props.fullScreenBar && (
        <div className="flow-editor-full-screen-bar">{props.fullScreenBar}</div>
      )}
    </div>
  );
}

/**
 * Where the editor is drawn: in its place on the page, or over the whole window in full screen. Its
 * element moves between the two rather than drawing again, so nothing it holds is lost, and goes to
 * the body in full screen, where no window or card around it can hold a fixed element inside itself.
 * Escape leaves full screen before it closes any window under it.
 */
function useFullScreenPlace(
  place: HTMLElement,
  slot: RefObject<HTMLDivElement | null>,
  fullScreen: boolean,
  onExit: () => void,
): void {
  const placed = useRef(place);
  useLayoutEffect(() => placeEditor(place, slot.current, fullScreen), [place, slot, fullScreen]);
  useLayoutEffect(() => () => place.remove(), [place]);
  useCloseOnEscape(fullScreen, onExit, placed);
  useEffect(() => {
    if (!fullScreen) return undefined;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [fullScreen]);
}

function createEditorPlace(): HTMLElement {
  return document.createElement("div");
}

/** Puts the editor's element in its slot, or on the body as a window over everything. */
function placeEditor(place: HTMLElement, slot: HTMLElement | null, fullScreen: boolean): void {
  place.className = fullScreen
    ? "flow-editor-place flow-editor-place--full-screen"
    : "flow-editor-place";
  if (fullScreen) {
    place.setAttribute("role", "dialog");
    place.setAttribute("aria-modal", "true");
    place.setAttribute("aria-label", "Stages and routes, full screen");
    document.body.append(place);
    return;
  }
  place.removeAttribute("role");
  place.removeAttribute("aria-modal");
  place.removeAttribute("aria-label");
  slot?.append(place);
}

/** Whether focus is in a field, whose own Ctrl/⌘ + Z undoes its typing. */
function isTyping(target: Element): boolean {
  return target.closest("input, textarea, select, [contenteditable]") !== null;
}

/** What each way of drawing does, as its choice's tooltip says. */
const ROUTE_DRAWING_TIPS: Readonly<Record<RouteDrawing, string>> = {
  "right-angles": "Around Stages, lines side by side kept apart",
  curves: "One smooth curve per route",
  "straight-lines": "The direct line from Stage to Stage",
};

/**
 * The Route drawing switch, before Auto-align in every host, read-only ones too
 * (docs/design/pipeline-route-drawing.html, "The switch"): this browser's choice, which redraws the
 * lines only; no Stage moves and nothing is saved.
 */
function RouteDrawingSwitch(props: {
  readonly drawing: RouteDrawing;
  readonly onChoose: (next: RouteDrawing) => void;
}): ReactNode {
  return (
    <div className="flow-editor-route-drawing" role="group" aria-label="Route drawing">
      <SegmentedControl
        size="sm"
        value={props.drawing}
        onChange={(value) => {
          const next = ROUTE_DRAWINGS.find((drawing) => drawing === value);
          if (next) props.onChoose(next);
        }}
        options={ROUTE_DRAWINGS.map((drawing) => ({
          value: drawing,
          label: ROUTE_DRAWING_WORDS[drawing],
          title: ROUTE_DRAWING_TIPS[drawing],
        }))}
      />
    </div>
  );
}

/**
 * Auto-align, before the host's menu: lays every Stage and End out from left to right in the
 * Pipeline's order by elkjs, loaded on the first press, from the cards' sizes at 100%.
 */
function AutoAlignButton(props: {
  readonly stages: readonly Stage[];
  readonly endPosition: StagePosition | undefined;
  readonly sizes: RefObject<ReadonlyMap<string, FlowCardSize>>;
  readonly onEdit: ((edit: FlowCanvasEdit) => void) | undefined;
  readonly onAligned: () => void;
  readonly onFailed: () => void;
}): ReactNode {
  const { stages } = props;
  const [laying, setLaying] = useState(false);
  const sizeOf = (stage: Stage): FlowCardSize =>
    props.sizes.current.get(stage.key) ?? estimatedCardSize(stage, listsRoutes(stage, stages));
  const press = async (): Promise<void> => {
    setLaying(true);
    try {
      const laid = await autoAligned(stages, sizeOf, await elkInWorker());
      props.onEdit?.({ kind: "auto-align", laid, before: positionsOf(stages, props.endPosition) });
      props.onAligned();
    } catch {
      props.onFailed();
    } finally {
      setLaying(false);
    }
  };
  const empty = stages.length === 0;
  return (
    <Tooltip
      focusable={empty}
      content={
        empty ? "Add a Stage first" : "Lay out the whole Pipeline from left to right in its order"
      }
    >
      <Button
        size="sm"
        variant="secondary"
        iconLeft={<Icon name="layout-grid" size={12} />}
        loading={laying}
        disabled={empty || laying}
        onClick={() => void press()}
      >
        {laying ? "Laying out…" : "Auto-align"}
      </Button>
    </Tooltip>
  );
}

function defaultHowTo(readOnly: boolean) {
  return (orientation: FlowOrientation): string => howToHint(orientation, readOnly);
}

function OfficeLegend(): ReactNode {
  return (
    <ul className="flow-editor-legend" aria-label="What the lines mean">
      <li>
        <span className="flow-editor-legend-line" />
        Route
      </li>
      <li>
        <span className="flow-editor-legend-mark">≤N×</span>
        At most N times
      </li>
    </ul>
  );
}

/** The element's width as laid out, 0 until it is (and in a test). */
function useWidth(element: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const observed = element.current;
    if (!observed || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => setWidth(observed.clientWidth));
    observer.observe(observed);
    return () => observer.disconnect();
  }, [element]);
  return width;
}
