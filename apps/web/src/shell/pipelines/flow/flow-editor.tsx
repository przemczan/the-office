import type { Stage, StageProblem } from "@the-office/contracts";
import { Button, Icon, useCloseOnEscape } from "@the-office/ui";
import {
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
import { FlowCanvas, type FlowCanvasEdit } from "./flow-canvas.tsx";
import { howToHint } from "./flow-editor-words.ts";
import { type FlowOrientation, orientationFor } from "./flow-layout.ts";
import type { FlowLocks, FlowOverlay, FlowStageMarks } from "./flow-marks.ts";
import { type FlowPick, pickOfProblem } from "./flow-pick.ts";
import { FlowViewport } from "./flow-viewport.tsx";
import "./flow-editor.css";

/**
 * What is picked and what the hint says, which the host keeps (`useFlowEditorControls`) so its
 * panel and edits read and change them: picking clears the hint, and an edit then says what it did.
 */
export interface FlowEditorControls {
  readonly picked: FlowPick | undefined;
  readonly pick: (pick: FlowPick | undefined) => void;
  /** What an edit just did; undefined goes back to how to use the editor. */
  readonly hint: string | undefined;
  readonly say: (hint: string | undefined) => void;
}

/** `initial`: what the editor opens picked, such as the Stage an address names. */
export function useFlowEditorControls(initial?: FlowPick): FlowEditorControls {
  const [picked, setPicked] = useState<FlowPick | undefined>(initial);
  const [hint, setHint] = useState<string | undefined>();
  return {
    picked,
    pick: (next) => {
      setPicked(next);
      setHint(undefined);
    },
    hint,
    say: setHint,
  };
}

export interface FlowEditorProps {
  /** The head's title, such as "Stages and routes". */
  readonly title: string;
  /** Under the title, such as "4 Stages · 5 routes · 2 routes back". */
  readonly summary: string;
  /** The flow, each Stage with its place and routes. */
  readonly stages: readonly Stage[];
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
  /** The head's menu, such as Add a Stage. */
  readonly head?: ReactNode;
  /** The panel under the canvas, for what `controls` has picked. */
  readonly panel: ReactNode;
  /** In full screen, before the title, such as "Full ·". */
  readonly fullScreenName?: string;
  /** In full screen, under the panel: the host's Save, so it stays at hand. */
  readonly fullScreenBar?: ReactNode;
}

/**
 * The Pipeline flow editor (docs/design/pipeline-flow.html, docs/design/pipeline-editor.html): a head
 * with the host's menu, the hint, the canvas in its viewport (pan, zoom, Fit, the Overview, full
 * screen), the host's panel for what is picked, and the check's problems, each a link that picks
 * where it is. The host keeps the Stages and applies every edit with flow-model: a Pipeline
 * (Settings › Pipelines, a Project's Pipelines) or a Task's Stages; a Proposal shows on it
 * read-only.
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
  const shared = {
    stages,
    picked: controls.picked,
    onPick: controls.pick,
    problems,
    warnings,
    whoWorks: props.whoWorks,
    readOnly,
    marks: props.marks,
    locked: props.locked,
    onEdit: props.onEdit,
  };
  const words = controls.hint ?? (props.howTo ?? defaultHowTo(readOnly))(orientation);
  return (
    <div ref={root} className={`flow-editor${fullScreen ? " flow-editor--full-screen" : ""}`}>
      <div className="flow-editor-head">
        <div className="flow-editor-title">
          <b>
            {fullScreen && props.fullScreenName
              ? `${props.fullScreenName} ${props.title}`
              : props.title}
          </b>
          <span>{props.summary}</span>
        </div>
        {!readOnly && props.head}
        {fullScreen && (
          <Button
            size="sm"
            variant="secondary"
            iconLeft={<Icon name="minimize-2" size={12} />}
            onClick={() => props.onFullScreen(false)}
          >
            Exit full screen
          </Button>
        )}
      </div>
      {props.legend ?? <OfficeLegend />}
      <p className="flow-editor-hint" role="status">
        <Icon name="info" size={13} />
        <span>{words}</span>
      </p>
      <FlowViewport fullScreen={fullScreen} onFullScreen={props.onFullScreen}>
        <FlowCanvas {...shared} overlay={props.overlay} />
      </FlowViewport>
      <div ref={panel} className="flow-editor-panel">
        {props.panel}
      </div>
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
