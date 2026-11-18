import type { Stage, StageProblem } from "@the-office/contracts";
import { Icon, SegmentedControl } from "@the-office/ui";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { StageCheckAlerts } from "../stage-check-alerts.tsx";
import { FlowCanvas, type FlowCanvasEdit } from "./flow-canvas.tsx";
import { type FlowEditorView, howToHint } from "./flow-editor-words.ts";
import { type FlowOrientation, orientationFor } from "./flow-layout.ts";
import { FlowList } from "./flow-list.tsx";
import type { FlowOverlay, FlowStageMarks } from "./flow-marks.ts";
import { type FlowPick, pickOfProblem } from "./flow-pick.ts";
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

export function useFlowEditorControls(): FlowEditorControls {
  const [picked, setPicked] = useState<FlowPick | undefined>();
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
  /** The head's title, such as "Stages and routes" or "What the-office gets". */
  readonly title: string;
  /** Under the title, such as "4 Stages · 5 routes · 3 On failure loops". */
  readonly summary: string;
  /** The flow, each Stage with its place and routes; a Project Pipeline's removed ones too. */
  readonly stages: readonly Stage[];
  readonly problems: readonly StageProblem[];
  readonly warnings: readonly StageProblem[];
  readonly problemsTitle?: string;
  readonly whoWorks: (stage: Stage) => string;
  /** Nothing moves or opens for editing: a Proposal on the flow. */
  readonly readOnly?: boolean;
  /** False on a Project page, where Stages keep the base Pipeline's places. */
  readonly draggable?: boolean;
  readonly marks?: FlowStageMarks;
  readonly overlay?: FlowOverlay;
  /** Under the head, what the lines mean; the office-wide legend without. */
  readonly legend?: ReactNode;
  /** The hint's words when no edit has said anything; the office-wide words without. */
  readonly howTo?: (view: FlowEditorView, orientation: FlowOrientation) => string;
  /** What is picked and what the hint says, from `useFlowEditorControls`. */
  readonly controls: FlowEditorControls;
  /** Applies a canvas's or List's edit, as the host keeps its Stages. */
  readonly onEdit?: (edit: FlowCanvasEdit) => void;
  /** The head's menu, such as Add a Stage, or Insert after the picked Stage. */
  readonly head?: ReactNode;
  /** The panel under the canvas, for what `controls` has picked. */
  readonly panel: ReactNode;
}

/**
 * The Pipeline flow editor (docs/design/pipeline-flow.html): a head with the host's menu and Flow /
 * List, the hint, the canvas or List, the host's panel for what is picked, and the check's problems,
 * each a link that picks where it is. The host keeps the Stages and applies every edit: an
 * office-wide Pipeline with flow-model (Settings › Pipelines), a Project Pipeline as Stage changes.
 */
export function FlowEditor(props: FlowEditorProps): ReactNode {
  const { stages, problems, warnings, controls, readOnly = false } = props;
  const [view, setView] = useState<FlowEditorView>("flow");
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
    draggable: props.draggable,
    marks: props.marks,
    onEdit: props.onEdit,
  };
  const words = controls.hint ?? (props.howTo ?? defaultHowTo(readOnly))(view, orientation);
  return (
    <div ref={root} className="flow-editor">
      <div className="flow-editor-head">
        <div className="flow-editor-title">
          <b>{props.title}</b>
          <span>{props.summary}</span>
        </div>
        {!readOnly && props.head}
        <span role="group" aria-label="View">
          <SegmentedControl
            size="sm"
            options={[
              { value: "flow", label: "Flow", icon: <Icon name="workflow" size={12} /> },
              { value: "list", label: "List", icon: <Icon name="list" size={12} /> },
            ]}
            value={view}
            onChange={(next) => setView(next === "list" ? "list" : "flow")}
          />
        </span>
      </div>
      {props.legend ?? <OfficeLegend />}
      <p className="flow-editor-hint" role="status">
        <Icon name="info" size={13} />
        <span>{words}</span>
      </p>
      {view === "flow" ? (
        <FlowCanvas {...shared} overlay={props.overlay} />
      ) : (
        <FlowList {...shared} />
      )}
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
    </div>
  );
}

function defaultHowTo(readOnly: boolean) {
  return (view: FlowEditorView, orientation: FlowOrientation): string =>
    howToHint(view, orientation, readOnly);
}

function OfficeLegend(): ReactNode {
  return (
    <ul className="flow-editor-legend" aria-label="What the lines mean">
      <li>
        <span className="flow-editor-legend-line" />
        Route
      </li>
      <li>
        <span className="flow-editor-legend-line flow-editor-legend-line--loop" />
        On failure loop
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
