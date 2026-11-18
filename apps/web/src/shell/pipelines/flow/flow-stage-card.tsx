import type { Stage, StageProblem } from "@the-office/contracts";
import { Badge, Icon } from "@the-office/ui";
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { STAGE_KIND_ICONS } from "../stage-edits.ts";
import type { FlowGridCell } from "./flow-layout.ts";
import { FlowLock } from "./flow-locked.tsx";
import type { FlowStageMark } from "./flow-marks.ts";
import type { FlowPick } from "./flow-pick.ts";
import {
  isPickedRoute,
  markTone,
  NONE_HOLDS_WORDS,
  noneHoldsAsks,
  routeHasProblem,
  routeLine,
  routeName,
} from "./flow-view.ts";

export interface FlowStageCardProps {
  readonly stage: Stage;
  readonly stages: readonly Stage[];
  readonly cell: FlowGridCell;
  readonly who: string;
  readonly picked: FlowPick | undefined;
  readonly ownProblems: readonly StageProblem[];
  readonly problems: readonly StageProblem[];
  /** The warnings on this Stage, whose words "When none holds, you're asked" shows on hover. */
  readonly warningWords: string;
  readonly mark: FlowStageMark | undefined;
  /** Why a Task's started Stage is locked, shown as its lock. */
  readonly lockedNote: string | undefined;
  readonly listsRoutes: boolean;
  readonly showsHandle: boolean;
  readonly draggable: boolean;
  readonly dragging: { readonly dx: number; readonly dy: number } | undefined;
  readonly target: boolean;
  readonly onPick: (pick: FlowPick) => void;
  readonly onStageKey: (event: KeyboardEvent<HTMLButtonElement>, key: string) => void;
  readonly onStagePointer: (event: PointerEvent<HTMLDivElement>, key: string) => void;
  readonly onHandlePointer: (event: PointerEvent<HTMLButtonElement>, key: string) => void;
}

/**
 * A mark's Badge, which styles itself inline on one line: a long label ("Changed: Project command")
 * wraps inside a narrow card instead of running out of it.
 */
const WRAPPING_BADGE: CSSProperties = {
  maxWidth: "100%",
  height: "auto",
  minHeight: 18,
  paddingBlock: 2,
  lineHeight: 1.25,
  whiteSpace: "normal",
  overflowWrap: "anywhere",
  flex: "0 1 auto",
};

/**
 * A Stage on the canvas: its kind, name and who works it, its mark (and lock, when started), its
 * routes out when it lists them, its +.
 */
export function FlowStageCard(props: FlowStageCardProps): ReactNode {
  const { stage, cell, mark, dragging } = props;
  const removed = mark?.tone === "removed";
  const style: CSSProperties = {
    gridColumn: cell.gridColumn,
    gridRow: cell.gridRow,
    ...(dragging ? { transform: `translate(${dragging.dx}px, ${dragging.dy}px)` } : {}),
  };
  return (
    <div
      className={cardClass(props, removed)}
      data-flow-stage={stage.key}
      data-flow-removed={removed ? "" : undefined}
      style={style}
      onPointerDown={(event) => props.onStagePointer(event, stage.key)}
      onClick={(event) => {
        // A press on the card's edge picks it as its name does; its own buttons answer themselves.
        if (!(event.target as Element).closest("button"))
          props.onPick({ kind: "stage", key: stage.key });
      }}
    >
      <StagePick {...props} />
      {(mark || props.lockedNote !== undefined) && (
        <span className="flow-canvas-stage-tag">
          {props.lockedNote !== undefined && <FlowLock note={props.lockedNote} />}
          {mark && (
            <Badge tone={markTone(mark)} size="sm" style={WRAPPING_BADGE}>
              {mark.label}
            </Badge>
          )}
        </span>
      )}
      {props.listsRoutes && !removed && <RouteRows {...props} />}
      {props.showsHandle && !removed && (
        <button
          type="button"
          className="flow-canvas-handle"
          aria-label={`Draw a route from ${stage.name}`}
          title={`Draw a route from ${stage.name}`}
          onPointerDown={(event) => props.onHandlePointer(event, stage.key)}
          onClick={() => props.onPick({ kind: "stage", key: stage.key })}
        >
          <Icon name="plus" size={10} />
        </button>
      )}
    </div>
  );
}

function cardClass(props: FlowStageCardProps, removed: boolean): string {
  const picked = props.picked?.kind === "stage" && props.picked.key === props.stage.key;
  return [
    "flow-canvas-stage",
    props.mark && `flow-canvas-stage--${props.mark.tone}`,
    picked && "flow-canvas-stage--picked",
    props.ownProblems.length > 0 && "flow-canvas-stage--problem",
    props.draggable && !removed && "flow-canvas-stage--draggable",
    props.dragging && "flow-canvas-stage--dragging",
    props.target && "flow-canvas-stage--target",
  ]
    .filter(Boolean)
    .join(" ");
}

function StagePick({
  stage,
  who,
  picked,
  ownProblems,
  onPick,
  onStageKey,
}: FlowStageCardProps): ReactNode {
  const problemWords = ownProblems.map(({ text }) => text).join(" ");
  return (
    <button
      type="button"
      className="flow-canvas-stage-pick"
      aria-label={stage.name}
      aria-current={picked?.kind === "stage" && picked.key === stage.key ? "true" : undefined}
      onClick={() => onPick({ kind: "stage", key: stage.key })}
      onKeyDown={(event) => onStageKey(event, stage.key)}
    >
      <span className={`flow-canvas-kind flow-canvas-kind--${stage.kind}`}>
        <Icon name={STAGE_KIND_ICONS[stage.kind]} size={11} />
      </span>
      <span className="flow-canvas-stage-words">
        <span className="flow-canvas-stage-name">{stage.name}</span>
        <span className="flow-canvas-stage-who">{who}</span>
      </span>
      {problemWords !== "" && (
        <span className="flow-canvas-stage-flag" title={problemWords}>
          <Icon name="circle-alert" size={14} />
        </span>
      )}
    </button>
  );
}

function RouteRows({
  stage,
  stages,
  picked,
  problems,
  warningWords,
  onPick,
}: FlowStageCardProps): ReactNode {
  return (
    <div className="flow-canvas-routes">
      {(stage.routes ?? []).map((route, index) => {
        const { target, when } = routeLine(stage, route, index, stages);
        const rowClass = [
          "flow-canvas-route-row",
          isPickedRoute(picked, stage.key, index) && "flow-canvas-route-row--picked",
          routeHasProblem(problems, stage.key, index) && "flow-canvas-route-row--problem",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          // A route has no key of its own: its place in the weighing order is it.
          <div key={index} className="flow-canvas-route" data-flow-route-row="">
            <button
              type="button"
              className={rowClass}
              aria-label={routeName(stage, route, stages)}
              aria-current={isPickedRoute(picked, stage.key, index) ? "true" : undefined}
              title={`${target} ${when}`}
              data-flow-route={`${stage.key}:${index}`}
              onClick={() => onPick({ kind: "route", key: stage.key, routeIndex: index })}
            >
              <span className="flow-canvas-route-words">
                <b>{target}</b> {when}
              </span>
            </button>
            <span className="flow-canvas-port" aria-hidden="true" />
          </div>
        );
      })}
      {noneHoldsAsks(stage) && (
        <span className="flow-canvas-none-holds" title={warningWords || undefined}>
          <Icon name="triangle-alert" size={11} />
          {NONE_HOLDS_WORDS}
        </span>
      )}
    </div>
  );
}
