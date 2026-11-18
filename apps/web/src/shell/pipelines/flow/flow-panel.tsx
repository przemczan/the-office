import type { Duty, Role, RoleCardOptions, Stage, StageProblem } from "@the-office/contracts";
import type { ReactNode } from "react";
import type { StageCommandSource } from "../stage-commands.ts";
import { stageNamed } from "./flow-model.ts";
import type { FlowPick } from "./flow-pick.ts";
import { FlowRoutePanel } from "./flow-route-panel.tsx";
import { FlowStagePanel } from "./flow-stage-panel.tsx";
import type { FlowEdited } from "./office-flow-edits.ts";

export interface FlowPanelProps {
  readonly stages: readonly Stage[];
  /** Takes an edit: its Stages, and what to pick and say after it, if anything. */
  readonly onEdited: (edited: FlowEdited) => void;
  readonly picked: FlowPick | undefined;
  readonly onPick: (pick: FlowPick | undefined) => void;
  readonly problems: readonly StageProblem[];
  readonly roles: readonly Role[];
  readonly duties: readonly Duty[];
  readonly options: RoleCardOptions;
  readonly commands?: StageCommandSource;
}

/**
 * Under the canvas, an office-wide Pipeline's picked Stage or route (docs/design/pipeline-flow.html):
 * a Stage's fields, its Routes out and its On failure; a route's Goes to and condition. A pick of a
 * Stage's On failure opens the Stage there.
 */
export function FlowPanel(props: FlowPanelProps): ReactNode {
  const { picked, stages } = props;
  const stage = picked === undefined ? undefined : stageNamed(stages, picked.key);
  if (!picked || !stage) return <FlowPanelEmpty />;
  if (picked.kind === "route") {
    const route = stage.routes?.[picked.routeIndex];
    if (!route) return <FlowPanelEmpty />;
    return <FlowRoutePanel {...props} stage={stage} routeIndex={picked.routeIndex} />;
  }
  return (
    <FlowStagePanel
      key={stage.key}
      {...props}
      stage={stage}
      onFailurePicked={picked.kind === "onFailure"}
    />
  );
}

export function FlowPanelEmpty(): ReactNode {
  return (
    <section className="flow-panel flow-panel--empty" aria-label="Picked">
      <b>Pick a Stage or a route to edit it here.</b>
      <span>
        A Stage's settings, its Routes out and its On failure loop; a route's place and its
        condition.
      </span>
    </section>
  );
}
