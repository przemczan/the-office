import type { Stage } from "@the-office/contracts";
import { Button, Icon, IconButton } from "@the-office/ui";
import type { ReactNode } from "react";
import { routeTargetName, routeWhen } from "./condition-words.ts";
import { canMoveRoute, laterStages, withRouteMoved } from "./flow-model.ts";
import type { FlowPanelProps } from "./flow-panel.tsx";
import { routeProblems } from "./flow-view.ts";
import { routeDrawn, routeRemoved } from "./office-flow-edits.ts";

/**
 * Routes out (docs/design/pipeline-flow.html): the Stage's routes in the order the walk weighs them,
 * each picked to set its condition, moved up or down, or removed; Add a route draws one to the first
 * later Stage it has none to, or End.
 */
export function FlowRoutesOut(props: FlowPanelProps & { readonly stage: Stage }): ReactNode {
  const { stage, stages, onEdited, onPick, problems } = props;
  const routes = stage.routes ?? [];
  const addTo =
    laterStages(stages, stage.key).find(({ key }) => !routes.some(({ to }) => to === key))?.key ??
    null;
  return (
    <section className="flow-panel-section" aria-label="Routes out">
      <div className="flow-panel-section-head">
        <span className="flow-panel-overline">Routes out · {routes.length}</span>
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Icon name="plus" size={12} />}
          onClick={() => onEdited(routeDrawn(stages, stage.key, addTo))}
        >
          Add a route
        </Button>
      </div>
      {routes.length > 0 ? (
        <ol className="flow-route-rows">
          {routes.map((route, index) => {
            const target = routeTargetName(route, stages);
            const why = routeProblems(problems, stage.key, index);
            return (
              <li
                key={`${route.to ?? "end"}:${index}`}
                className={`flow-route-row${why.length > 0 ? " flow-route-row--problem" : ""}`}
              >
                <span className="flow-route-row-number">{index + 1}</span>
                <button
                  type="button"
                  className="flow-route-row-words"
                  onClick={() => onPick({ kind: "route", key: stage.key, routeIndex: index })}
                >
                  <b>→ {target}</b>
                  <span>{routeWhen(route, stage, stages, index)}</span>
                  {why.map(({ text }) => (
                    <span key={text} className="flow-route-row-why">
                      {text}
                    </span>
                  ))}
                </button>
                <span className="flow-panel-tools">
                  <IconButton
                    size="sm"
                    icon={<Icon name="chevron-up" size={12} />}
                    label={`Move the route to ${target} up`}
                    disabled={!canMoveRoute(stages, stage.key, index, -1)}
                    onClick={() =>
                      onEdited({ stages: withRouteMoved(stages, stage.key, index, -1) })
                    }
                  />
                  <IconButton
                    size="sm"
                    icon={<Icon name="chevron-down" size={12} />}
                    label={`Move the route to ${target} down`}
                    disabled={!canMoveRoute(stages, stage.key, index, 1)}
                    onClick={() =>
                      onEdited({ stages: withRouteMoved(stages, stage.key, index, 1) })
                    }
                  />
                  <IconButton
                    size="sm"
                    icon={<Icon name="trash-2" size={12} />}
                    label={`Remove the route to ${target}`}
                    onClick={() => onEdited(routeRemoved(stages, stage.key, index))}
                  />
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="flow-panel-empty-block">
          No route out yet. Add one to a later Stage, or to End to make {stage.name} a final Stage.
        </p>
      )}
      <p className="flow-panel-hint">
        The walk follows the first route whose condition holds, from the top. One with no condition
        always holds, so it goes last. To run a Stage only in some cases, give the route into it a
        condition.
      </p>
    </section>
  );
}
