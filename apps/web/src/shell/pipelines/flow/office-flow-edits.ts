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
 */
export interface FlowEdited {
  readonly stages: readonly Stage[];
  readonly pick?: FlowPick | undefined;
  readonly hint?: string;
}

export function canvasEdited(stages: readonly Stage[], edit: FlowCanvasEdit): FlowEdited {
  switch (edit.kind) {
    case "move":
      return {
        stages: withStageMoved(stages, edit.key, edit.direction),
        pick: { kind: "stage", key: edit.key },
      };
    case "drop":
      return {
        stages: withStageDropped(stages, edit.key, edit.drop),
        pick: { kind: "stage", key: edit.key },
      };
    case "draw-route":
      return routeDrawn(stages, edit.from, edit.to);
    case "remove-route":
      return routeRemoved(stages, edit.key, edit.routeIndex);
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
): FlowEdited {
  const beside = picked === undefined ? undefined : stageNamed(stages, picked.key);
  const added = withStageAdded(stages, stage, beside?.key);
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
): FlowEdited {
  const from = stageNamed(stages, key);
  const added = withStageOnRoute(stages, key, routeIndex, stage);
  const fresh = stageNamed(added.stages, added.key);
  if (!from || !fresh || added.key === key) return { stages };
  return {
    stages: added.stages,
    pick: { kind: "stage", key: added.key },
    hint: onRouteHint(from, fresh),
  };
}

export function stageRemoved(stages: readonly Stage[], key: string): FlowEdited {
  const gone = stageNamed(stages, key);
  if (!gone) return { stages };
  return {
    stages: withStageRemovedFromFlow(stages, key),
    pick: undefined,
    hint: removedHint(gone),
  };
}
