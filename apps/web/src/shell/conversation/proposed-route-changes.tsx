import type { ProposedRoutes, Route, Stage } from "@the-office/contracts";
import { Icon } from "@the-office/ui";
import { useMemo, type ReactNode } from "react";
import { routeTargetName } from "../pipelines/flow/condition-words.ts";
import { FlowCanvas } from "../pipelines/flow/flow-canvas.tsx";
import {
  checkedSentence,
  proposalFlow,
  routeWhenAfterTarget,
  sourceOf,
  type ProposedStageRoutes,
} from "../pipelines/flow/proposal-flow.ts";

/**
 * A Proposal's route changes (docs/design/README.md, "An agent's Proposal"): for each Stage whose
 * routes change, new and removed Stages too, its routes out as they were and as proposed.
 */
export function ProposedRouteChanges({
  routes,
  was,
  proposed,
}: {
  readonly routes: ProposedRoutes;
  /** The flow as it is, which names the Stages the routes it had lead to. */
  readonly was: readonly Stage[];
  /** The flow as proposed, which names the Stages the proposed routes lead to. */
  readonly proposed: readonly Stage[];
}): ReactNode {
  return (
    <ul className="proposal-changes">
      {routes.stages.map((change) => (
        <RoutesOutChange key={change.stageKey} change={change} was={was} proposed={proposed} />
      ))}
    </ul>
  );
}

/** "Routes out of Tests": Was, struck through, then Proposed, numbered in the order weighed. */
export function RoutesOutChange({
  change,
  was,
  proposed,
}: {
  readonly change: ProposedStageRoutes;
  readonly was: readonly Stage[];
  readonly proposed: readonly Stage[];
}): ReactNode {
  return (
    <li>
      <span className="proposal-change-label">Routes out of {change.stageName}</span>
      <div className="proposal-route-values">
        <RouteSide side="from" change={change} stages={was} />
        <RouteSide side="to" change={change} stages={proposed} />
      </div>
    </li>
  );
}

const SIDE_WORDS = {
  from: { title: "Was", none: "None: a new Stage" },
  to: { title: "Proposed", none: "None: the Stage is removed" },
} as const;

function RouteSide({
  side,
  change,
  stages,
}: {
  readonly side: "from" | "to";
  readonly change: ProposedStageRoutes;
  readonly stages: readonly Stage[];
}): ReactNode {
  const routes: readonly Route[] = change[side];
  const from = sourceOf(change, side);
  const { title, none } = SIDE_WORDS[side];
  return (
    <div className={`proposal-route-side proposal-route-side--${side}`}>
      <span>{title}</span>
      {routes.length > 0 ? (
        <ol aria-label={`${title}: routes out of ${change.stageName}`}>
          {routes.map((route, index) => (
            <li key={`${route.to ?? "end"}:${index}`}>
              → {routeTargetName(route, stages)}
              <span className="proposal-route-when">
                {routeWhenAfterTarget(route, from, stages, index)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="proposal-route-none">{none}</p>
      )}
    </div>
  );
}

/**
 * "Full, as proposed": the flow small and read-only, the routes the Proposal adds dashed in the
 * accent and those it takes away dotted, then what the check found when it was drafted.
 */
export function ProposedFlow({
  title,
  stages,
  routes,
  whoWorks,
  action,
}: {
  /** Such as "Full, as proposed". */
  readonly title: string;
  /** The flow as proposed, each Stage with its place and routes. */
  readonly stages: readonly Stage[];
  readonly routes: ProposedRoutes;
  readonly whoWorks: (stage: Stage) => string;
  /** Beside the title, such as Show it on the flow. */
  readonly action?: ReactNode;
}): ReactNode {
  const flow = useMemo(() => proposalFlow(stages, routes), [stages, routes]);
  return (
    <section className="proposal-section proposal-flow" aria-label={title}>
      <div className="proposal-section-head">
        <span className="proposal-section-title">{title}</span>
        {action}
      </div>
      <FlowCanvas
        stages={flow.stages}
        overlay={flow.overlay}
        picked={undefined}
        problems={[]}
        warnings={routes.check}
        whoWorks={whoWorks}
        readOnly
      />
      <p className="proposal-checked">
        <Icon name="check" size={12} />
        <span>{checkedSentence(stages)}</span>
      </p>
      {routes.check.map(({ stageKey, text }) => (
        <p key={`${stageKey}:${text}`} className="proposal-checked proposal-checked--warning">
          <Icon name="triangle-alert" size={12} />
          <span>{text}</span>
        </p>
      ))}
    </section>
  );
}
