import type { Stage } from "@the-office/contracts";
import { Button, Icon, IconButton, Menu } from "@the-office/ui";
import { useState, type ReactNode } from "react";
import { routeTargetName, routeWhen } from "./condition-words.ts";
import { FlowLockedFields, lockedTitle } from "./flow-locked.tsx";
import {
  canMoveRoute,
  formsToAdd,
  type RouteForm,
  withRouteLimit,
  withRouteMoved,
  withRouteTarget,
} from "./flow-model.ts";
import type { FlowPanelProps } from "./flow-panel.tsx";
import { FlowRouteLimit, FlowRouteTarget } from "./flow-route-fields.tsx";
import { routeProblems } from "./flow-view.ts";
import { routeAdded, routeRemoved } from "./office-flow-edits.ts";

/** Add a route's items, by the row's form (spec §2.3, "The route forms"). */
const FORM_WORDS: Readonly<Record<RouteForm, string>> = {
  fails: "When it fails",
  holds: "When these hold",
  otherwise: "Otherwise",
};

/**
 * Routes out (docs/spec/screens/pipeline-flow-editor.md): the Stage's routes in the order the walk
 * weighs them, each with its when-words, where it goes and its limit, picked to set its condition,
 * moved up or down (never above When it fails or below Otherwise), or removed. Add a route adds a
 * row of a form to the first later Stage it has none to, or End. A locked Stage's are only picked,
 * every change disabled with why (`note`).
 */
export function FlowRoutesOut(
  props: FlowPanelProps & { readonly stage: Stage; readonly note?: string | undefined },
): ReactNode {
  const { stage, stages, onEdited, onPick, problems, note } = props;
  const locked = note !== undefined;
  const routes = stage.routes ?? [];
  return (
    <section className="flow-panel-section" aria-label="Routes out">
      <div className="flow-panel-section-head">
        <span className="flow-panel-overline">Routes out · {routes.length}</span>
        <AddRouteMenu
          forms={formsToAdd(stage)}
          note={note}
          onAdd={(form) => onEdited(routeAdded(stages, stage.key, form))}
        />
      </div>
      {routes.length > 0 ? (
        <ol className="flow-route-rows">
          {routes.map((route, index) => {
            const target = routeTargetName(route, stages);
            const why = routeProblems(problems, stage.key, index);
            const when = routeWhen(route, stage, stages, index);
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
                  <b>{capitalised(when)}</b>
                  <span>→ {target}</span>
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
                    {...lockedTitle(note)}
                    disabled={locked || !canMoveRoute(stages, stage.key, index, -1)}
                    onClick={() =>
                      onEdited({ stages: withRouteMoved(stages, stage.key, index, -1) })
                    }
                  />
                  <IconButton
                    size="sm"
                    icon={<Icon name="chevron-down" size={12} />}
                    label={`Move the route to ${target} down`}
                    {...lockedTitle(note)}
                    disabled={locked || !canMoveRoute(stages, stage.key, index, 1)}
                    onClick={() =>
                      onEdited({ stages: withRouteMoved(stages, stage.key, index, 1) })
                    }
                  />
                  <IconButton
                    size="sm"
                    icon={<Icon name="trash-2" size={12} />}
                    label={`Remove the route to ${target}`}
                    {...lockedTitle(note)}
                    disabled={locked}
                    onClick={() => onEdited(routeRemoved(stages, stage.key, index))}
                  />
                </span>
                <div className="flow-route-row-fields">
                  <FlowLockedFields note={note}>
                    <FlowRouteTarget
                      route={route}
                      stages={stages}
                      onChange={(to) =>
                        onEdited({ stages: withRouteTarget(stages, stage.key, index, to) })
                      }
                    />
                    <FlowRouteLimit
                      from={stage}
                      route={route}
                      stages={stages}
                      onChange={(limit) =>
                        onEdited({ stages: withRouteLimit(stages, stage.key, index, limit) })
                      }
                    />
                  </FlowLockedFields>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="flow-panel-empty-block">
          No route out yet. Add one to any Stage, or to End to make {stage.name} a final Stage.
        </p>
      )}
      <p className="flow-panel-hint">
        The walk follows the first route whose condition holds, from the top. Otherwise always
        holds, so it goes last. To run a Stage only in some cases, give the route into it a
        condition.
        {stage.kind === "agent" && " When it fails goes first."}
      </p>
      <p className="flow-panel-hint">
        A route back starts at 3, a route on at No limit. Every loop needs one route with a limit,
        so the walk always ends.
      </p>
    </section>
  );
}

/** Add a route: a menu of the forms the Stage may take another row of. */
function AddRouteMenu({
  forms,
  note,
  onAdd,
}: {
  readonly forms: readonly RouteForm[];
  readonly note: string | undefined;
  readonly onAdd: (form: RouteForm) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={260}
      trigger={
        <Button
          size="sm"
          variant="secondary"
          iconLeft={<Icon name="plus" size={12} />}
          disabled={note !== undefined}
          title={note}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          Add a route
        </Button>
      }
      items={[
        { heading: "Add a route" },
        ...forms.map((form) => ({ label: FORM_WORDS[form], onSelect: () => onAdd(form) })),
      ]}
    />
  );
}

function capitalised(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
