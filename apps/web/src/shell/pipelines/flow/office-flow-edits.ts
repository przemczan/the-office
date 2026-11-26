import type { Stage, StagePosition } from "@the-office/contracts";
import { routeTargetName } from "./condition-words.ts";
import {
  AUTO_ALIGN_UNDONE,
  addedHint,
  autoAlignedHint,
  besideHint,
  drawnHint,
  movedInOrderHint,
  onRouteHint,
  removedHint,
  routeRemovedHint,
} from "./flow-editor-words.ts";
import {
  type FlowPositions,
  type LockedStages,
  type MoveDirection,
  NOTHING_LOCKED,
  type RouteForm,
  stageNamed,
  withPositions,
  withRouteAdded,
  withRouteDrawn,
  withRouteRemoved,
  withStageAdded,
  withStageMoved,
  withStageOnRoute,
  withStagePositioned,
  withStageRemovedFromFlow,
} from "./flow-model.ts";
import type { FlowPick } from "./flow-pick.ts";
import type { FlowCanvasEdit } from "./flow-view.ts";

/**
 * An office-wide Pipeline's edits in the flow editor (Settings › Pipelines): each applied to its
 * Stages with flow-model, answering the new Stages, End's position when the edit moved End, what to
 * pick after it and what the hint says. "Edit for this Task" makes the same edits with the Task's
 * started Stages locked.
 */
export interface FlowEdited {
  readonly stages: readonly Stage[];
  /** Given when the edit moved End: its position, undefined to stand where it is derived. */
  readonly endPosition?: StagePosition | undefined;
  readonly pick?: FlowPick | undefined;
  readonly hint?: string;
  /** Auto-align's: where everything stood before, which its Undo puts back. */
  readonly undo?: FlowPositions;
}

/** The Stages and End's position as an editor's host keeps them. */
export interface FlowDraft {
  readonly stages: readonly Stage[];
  readonly endPosition: StagePosition | undefined;
}

/** The draft after an edit: End's position is the edit's when it gave one. */
export function draftAfter(edited: FlowEdited, endPosition: StagePosition | undefined): FlowDraft {
  return {
    stages: edited.stages,
    endPosition: "endPosition" in edited ? edited.endPosition : endPosition,
  };
}

export function canvasEdited(
  stages: readonly Stage[],
  edit: FlowCanvasEdit,
  locked: LockedStages = NOTHING_LOCKED,
): FlowEdited {
  switch (edit.kind) {
    case "move-to":
      return movedTo(stages, edit.key, edit.position, edit.beside);
    // The routes out of a locked Stage stay as they are.
    case "draw-route":
      return locked.has(edit.from) ? { stages } : routeDrawn(stages, edit.from, edit.to);
    case "remove-route":
      return locked.has(edit.key) ? { stages } : routeRemoved(stages, edit.key, edit.routeIndex);
    case "auto-align":
      return {
        stages: withPositions(stages, edit.laid),
        endPosition: edit.laid.end,
        hint: autoAlignedHint(stages.length),
        undo: edit.before,
      };
    case "undo-auto-align":
      return {
        stages: withPositions(stages, edit.before),
        endPosition: edit.before.end,
        hint: AUTO_ALIGN_UNDONE,
      };
  }
}

/** A Stage or End moved on the canvas (positions are never locked), picked when a Stage. */
function movedTo(
  stages: readonly Stage[],
  key: string | null,
  position: StagePosition,
  beside: string | null | undefined,
): FlowEdited {
  const nameOf = (each: string | null): string =>
    each === null ? "End" : (stageNamed(stages, each)?.name ?? each);
  const said = beside === undefined ? {} : { hint: besideHint(nameOf(key), nameOf(beside)) };
  if (key === null) return { stages, endPosition: position, ...said };
  return {
    stages: withStagePositioned(stages, key, position),
    pick: { kind: "stage", key },
    ...said,
  };
}

/** Move earlier or Move later: the order changed, its hint saying what that did. */
export function stageMoved(
  stages: readonly Stage[],
  key: string,
  direction: MoveDirection,
  locked: LockedStages = NOTHING_LOCKED,
): FlowEdited {
  const moved = withStageMoved(stages, key, direction, locked);
  if (moved === stages) return { stages };
  return { stages: moved, hint: movedInOrderHint(stages, moved, key) };
}

export function routeDrawn(
  stages: readonly Stage[],
  fromKey: string,
  to: string | null,
): FlowEdited {
  const from = stageNamed(stages, fromKey);
  const drawn = withRouteDrawn(stages, fromKey, to);
  if (!from || drawn.routeIndex < 0) return { stages };
  return {
    stages: drawn.stages,
    pick: { kind: "route", key: fromKey, routeIndex: drawn.routeIndex },
    hint: drawnHint(from, to, stages),
  };
}

/** A row of `form` added to Routes out (Add a route), picked so its target and condition are set. */
export function routeAdded(stages: readonly Stage[], fromKey: string, form: RouteForm): FlowEdited {
  const added = withRouteAdded(stages, fromKey, form);
  if (added.routeIndex < 0) return { stages };
  return {
    stages: added.stages,
    pick: { kind: "route", key: fromKey, routeIndex: added.routeIndex },
  };
}

export function routeRemoved(
  stages: readonly Stage[],
  key: string,
  routeIndex: number,
): FlowEdited {
  const from = stageNamed(stages, key);
  const route = from?.routes?.[routeIndex];
  if (!from || !route) return { stages };
  return {
    stages: withRouteRemoved(stages, key, routeIndex),
    pick: { kind: "stage", key },
    hint: routeRemovedHint(from, routeTargetName(route, stages)),
  };
}

/** `stage` added after the picked Stage (or last), beside it on the canvas, picked, unconnected. */
export function stageAdded(
  stages: readonly Stage[],
  stage: Stage,
  picked: FlowPick | undefined,
  locked: LockedStages = NOTHING_LOCKED,
): FlowEdited {
  const after = picked === undefined ? undefined : stageNamed(stages, picked.key);
  const added = withStageAdded(stages, stage, after?.key, locked);
  const index = added.stages.findIndex(({ key }) => key === added.key);
  const fresh = added.stages[index];
  return {
    stages: added.stages,
    pick: { kind: "stage", key: added.key },
    ...(fresh ? { hint: addedHint(fresh, added.stages[index - 1], after === undefined) } : {}),
  };
}

export function stageOnRoute(
  stages: readonly Stage[],
  key: string,
  routeIndex: number,
  stage: Stage,
  locked: LockedStages = NOTHING_LOCKED,
): FlowEdited {
  const from = stageNamed(stages, key);
  const added = withStageOnRoute(stages, key, routeIndex, stage, locked);
  const fresh = stageNamed(added.stages, added.key);
  if (!from || !fresh || added.key === key) return { stages };
  return {
    stages: added.stages,
    pick: { kind: "stage", key: added.key },
    hint: onRouteHint(from, fresh),
  };
}

export function stageRemoved(
  stages: readonly Stage[],
  key: string,
  locked: LockedStages = NOTHING_LOCKED,
): FlowEdited {
  const gone = stageNamed(stages, key);
  if (!gone || locked.has(key)) return { stages };
  return {
    stages: withStageRemovedFromFlow(stages, key),
    pick: undefined,
    hint: removedHint(gone),
  };
}
