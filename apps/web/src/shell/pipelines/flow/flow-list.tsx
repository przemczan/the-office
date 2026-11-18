import type { Stage, StageProblem } from "@the-office/contracts";
import { Badge, Icon, IconButton } from "@the-office/ui";
import type { KeyboardEvent, ReactNode } from "react";
import { STAGE_KIND_ICONS } from "../stage-edits.ts";
import "./flow-canvas.css";
import { FlowLock, lockedTitle } from "./flow-locked.tsx";
import { type FlowLocks, type FlowStageMarks, NO_LOCKS } from "./flow-marks.ts";
import { inFlowOrder, stepInOrder } from "./flow-model.ts";
import type { FlowPick } from "./flow-pick.ts";
import {
  type FlowCanvasEdit,
  isPickedRoute,
  isPickedStage,
  loopHasProblem,
  loopWords,
  markTone,
  routeHasProblem,
  routeLine,
  routeName,
  stageProblemsOf,
} from "./flow-view.ts";

export interface FlowListProps {
  readonly stages: readonly Stage[];
  readonly picked: FlowPick | undefined;
  readonly onPick?: (pick: FlowPick | undefined) => void;
  readonly problems: readonly StageProblem[];
  readonly warnings: readonly StageProblem[];
  readonly whoWorks: (stage: Stage) => string;
  readonly readOnly?: boolean;
  /** False hides the arrows, as a Project Pipeline's Stages keep the base Pipeline's places. */
  readonly draggable?: boolean;
  readonly marks?: FlowStageMarks;
  /** A Task's started Stages: each with its lock, its arrows disabled. */
  readonly locked?: FlowLocks;
  readonly onEdit?: (edit: FlowCanvasEdit) => void;
}

const NO_MARKS: FlowStageMarks = new Map();

/**
 * The flow editor's List (docs/design/pipeline-flow.html): the same flow without dragging, a Stage
 * a row in the Pipeline's order with its routes and its loop under it, and arrows that move it a
 * step. A Project Pipeline's removed Stages follow, struck through, then End.
 */
export function FlowList(props: FlowListProps): ReactNode {
  const marks = props.marks ?? NO_MARKS;
  const order = inFlowOrder(props.stages);
  const live = order.filter(({ key }) => marks.get(key)?.tone !== "removed");
  const removed = order.filter(({ key }) => marks.get(key)?.tone === "removed");
  return (
    <ol
      className="flow-list"
      aria-label="Stages in the Pipeline's order"
      onKeyDown={(event) => removeRouteByKey(event, props)}
    >
      {live.map((stage, index) => (
        <FlowListRow key={stage.key} {...props} marks={marks} stage={stage} number={index + 1} />
      ))}
      {removed.map((stage) => (
        <FlowListRow key={stage.key} {...props} marks={marks} stage={stage} number={undefined} />
      ))}
      <li className="flow-list-row">
        <span className="flow-list-number" />
        <span className="flow-list-main">
          <span className="flow-canvas-stage-words">
            <span className="flow-canvas-stage-name">End</span>
            <span className="flow-canvas-stage-who">A route to End makes a final Stage</span>
          </span>
        </span>
      </li>
    </ol>
  );
}

interface FlowListRowProps extends FlowListProps {
  readonly marks: FlowStageMarks;
  readonly stage: Stage;
  readonly number: number | undefined;
}

function FlowListRow(props: FlowListRowProps): ReactNode {
  const { stage, stages, marks, picked } = props;
  const mark = marks.get(stage.key);
  const own = stageProblemsOf(props.problems, stage.key);
  const rowClass = [
    "flow-list-row",
    mark && `flow-list-row--${mark.tone}`,
    own.length > 0 && "flow-list-row--problem",
    isPickedStage(picked, stage.key) && "flow-list-row--picked",
  ]
    .filter(Boolean)
    .join(" ");
  const ghost = mark?.tone === "removed";
  const lockedNote = (props.locked ?? NO_LOCKS).get(stage.key);
  return (
    <li className={rowClass}>
      <span className="flow-list-number">{props.number}</span>
      <button
        type="button"
        className="flow-list-main"
        aria-label={stage.name}
        aria-current={isPickedStage(picked, stage.key) ? "true" : undefined}
        onClick={() => props.onPick?.({ kind: "stage", key: stage.key })}
      >
        <span className={`flow-canvas-kind flow-canvas-kind--${stage.kind}`}>
          <Icon name={STAGE_KIND_ICONS[stage.kind]} size={11} />
        </span>
        <span className="flow-canvas-stage-words">
          <span className="flow-canvas-stage-name">{stage.name}</span>
          <span className="flow-canvas-stage-who">
            {props.whoWorks(stage)}
            {own[0] && <span className="flow-list-problem"> · {own[0].text}</span>}
          </span>
        </span>
        {lockedNote !== undefined && <FlowLock note={lockedNote} />}
        {mark && (
          <Badge tone={markTone(mark)} size="sm">
            {mark.label}
          </Badge>
        )}
      </button>
      {!ghost && !props.readOnly && props.draggable !== false ? (
        <MoveArrows {...props} />
      ) : (
        <span />
      )}
      {!ghost && <RowLines {...props} stages={stages} />}
    </li>
  );
}

/** The arrows, disabled with why on a locked Stage. */
function MoveArrows({ stage, stages, marks, locked, onEdit }: FlowListRowProps): ReactNode {
  const live = stages.filter(({ key }) => marks.get(key)?.tone !== "removed");
  const note = locked?.get(stage.key);
  const first = note !== undefined || stepInOrder(live, stage.key, -1) === undefined;
  const last = note !== undefined || stepInOrder(live, stage.key, 1) === undefined;
  return (
    <span className="flow-list-tools">
      <IconButton
        size="xs"
        variant="ghost"
        icon={<Icon name="chevron-up" size={12} />}
        label={`Move ${stage.name} earlier`}
        {...lockedTitle(note)}
        disabled={first}
        onClick={() => onEdit?.({ kind: "move", key: stage.key, direction: "earlier" })}
      />
      <IconButton
        size="xs"
        variant="ghost"
        icon={<Icon name="chevron-down" size={12} />}
        label={`Move ${stage.name} later`}
        {...lockedTitle(note)}
        disabled={last}
        onClick={() => onEdit?.({ kind: "move", key: stage.key, direction: "later" })}
      />
    </span>
  );
}

function RowLines({ stage, stages, picked, problems, onPick }: FlowListRowProps): ReactNode {
  const loop = loopWords(stage, stages);
  return (
    <ul className="flow-list-lines">
      {(stage.routes ?? []).map((route, index) => {
        const { target, when } = routeLine(stage, route, index, stages);
        const lineClass = [
          "flow-list-line",
          isPickedRoute(picked, stage.key, index) && "flow-list-line--picked",
          routeHasProblem(problems, stage.key, index) && "flow-list-line--problem",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          // A route has no key of its own: its place in the weighing order is it.
          <li key={index}>
            <button
              type="button"
              className={lineClass}
              aria-label={routeName(stage, route, stages)}
              aria-current={isPickedRoute(picked, stage.key, index) ? "true" : undefined}
              data-flow-route={`${stage.key}:${index}`}
              onClick={() => onPick?.({ kind: "route", key: stage.key, routeIndex: index })}
            >
              <Icon name="arrow-right" size={12} />
              <span>
                <b>{target}</b> {when}
              </span>
            </button>
          </li>
        );
      })}
      {loop && (
        <li>
          <button
            type="button"
            className={`flow-list-line flow-list-line--loop${picked?.kind === "onFailure" && picked.key === stage.key ? " flow-list-line--picked" : ""}${loopHasProblem(problems, stage.key) ? " flow-list-line--problem" : ""}`}
            aria-label={loop.name}
            onClick={() => onPick?.({ kind: "onFailure", key: stage.key })}
          >
            <Icon name="rotate-ccw" size={12} />
            <span>
              On failure: back to {loop.to}, at most {loop.rounds}×
            </span>
          </button>
        </li>
      )}
    </ul>
  );
}

/** Delete or Backspace on a route's line removes it, as on the canvas. */
function removeRouteByKey(event: KeyboardEvent<HTMLElement>, props: FlowListProps): void {
  if (event.key !== "Delete" && event.key !== "Backspace") return;
  if (props.readOnly || !props.onEdit) return;
  const line = (event.target as Element).closest<HTMLElement>("[data-flow-route]");
  const [key, index] = line?.dataset.flowRoute?.split(":") ?? [];
  if (key === undefined || index === undefined || props.locked?.has(key)) return;
  event.preventDefault();
  props.onEdit({ kind: "remove-route", key, routeIndex: Number(index) });
}
