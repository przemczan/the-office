import type { Stage } from "@the-office/contracts";
import { routeTargetName } from "./condition-words.ts";
import {
  drawnHint,
  addedHint,
  onRouteHint,
  removedHint,
  routeRemovedHint,
} from "./flow-editor-words.ts";
import {
  type LockedStages,
  NOTHING_LOCKED,
  stageNamed,
  withRouteDrawn,
  withRouteRemoved,
  withStageAdded,
  withStageDropped,
  withStageMoved,
  withStageOnRoute,
  withStageRemovedFromFlow,
} from "./flow-model.ts";
import type { FlowPick } from "./flow-pick.ts";
import type { FlowCanvasEdit } from "./flow-view.ts";

/**
 * An office-wide Pipeline's edits in the flow editor (Settings › Pipelines): each applied to its
 * Stages with flow-model, answering the new Stages, what to pick after it and what the hint says.
 * "Edit for this Task" makes the same edits with the Task's started Stages locked.
 */
export interface FlowEdited {
  readonly stages: readonly Stage[];
  readonly pick?: FlowPick | undefined;
  readonly hint?: string;
}

export function canvasEdited(
  stages: readonly Stage[],
  edit: FlowCanvasEdit,
  locked: LockedStages = NOTHING_LOCKED,
): FlowEdited {
  switch (edit.kind) {
    case "move":
      return {
        stages: withStageMoved(stages, edit.key, edit.direction, locked),
        pick: { kind: "stage", key: edit.key },
      };
    case "drop":
      return {
        stages: withStageDropped(stages, edit.key, edit.drop, locked),
        pick: { kind: "stage", key: edit.key },
      };
    // The routes out of a locked Stage stay as they are.
    case "draw-route":
      return locked.has(edit.from) ? { stages } : routeDrawn(stages, edit.from, edit.to);
    case "remove-route":
      return locked.has(edit.key) ? { stages } : routeRemoved(stages, edit.key, edit.routeIndex);
  }
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

/** `stage` added beside the picked Stage (or after the last), picked, unconnected. */
export function stageAdded(
  stages: readonly Stage[],
  stage: Stage,
  picked: FlowPick | undefined,
  locked: LockedStages = NOTHING_LOCKED,
): FlowEdited {
  const beside = picked === undefined ? undefined : stageNamed(stages, picked.key);
  const added = withStageAdded(stages, stage, beside?.key, locked);
  const fresh = stageNamed(added.stages, added.key);
  return {
    stages: added.stages,
    pick: { kind: "stage", key: added.key },
    ...(fresh ? { hint: addedHint(fresh, beside ?? stages.at(-1)) } : {}),
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
    stages: withStageRemovedFromFlow(stages, key, locked),
    pick: undefined,
    hint: removedHint(gone),
  };
}
