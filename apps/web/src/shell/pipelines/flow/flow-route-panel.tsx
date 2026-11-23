import type { Route, Stage } from "@the-office/contracts";
import { Button, Icon, RadioList, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import { ConditionBuilder } from "./condition-builder.tsx";
import { commandNote, conditionCommandKeys } from "./condition-commands.ts";
import { NEW_CONDITION } from "./condition-edits.ts";
import { followedWhen, routeTargetName } from "./condition-words.ts";
import { FlowAddMenu } from "./flow-add-menu.tsx";
import { FlowLockedFields, FlowLockedNote } from "./flow-locked.tsx";
import { NO_LOCKS } from "./flow-marks.ts";
import { inFlowOrder, withRouteCondition, withRouteTarget } from "./flow-model.ts";
import type { FlowPanelProps } from "./flow-panel.tsx";
import { FlowProblemAlert } from "./flow-problem-alert.tsx";
import { routeProblems } from "./flow-view.ts";
import { routeRemoved, stageOnRoute } from "./office-flow-edits.ts";

/** The Goes to select's value for End. */
const END = "";

const NO_CONDITION = "none";
const SOME_CONDITION = "some";

/**
 * The picked route's panel (docs/design/pipeline-flow.html): where it goes, a later Stage or End,
 * and its condition, none or "When these hold" in the condition builder, read in plain words under
 * it. Insert a Stage on this route and Remove route head it. A route out of a locked Stage (a
 * Task's started one) reads only, each control disabled with why.
 */
export function FlowRoutePanel(
  props: FlowPanelProps & {
    readonly stage: Stage;
    readonly routeIndex: number;
  },
): ReactNode {
  const { stage, stages, routeIndex, onEdited, problems, locked = NO_LOCKS } = props;
  const note = locked.get(stage.key);
  const routes = stage.routes ?? [];
  const route = routes[routeIndex];
  if (!route) return null;
  const target = routeTargetName(route, stages);
  const all = routeProblems(problems, stage.key, routeIndex);
  const commandKeys = route.condition ? conditionCommandKeys(route.condition) : [];
  return (
    <section className="flow-panel" aria-label="Route">
      <div className="flow-panel-head">
        <h4 className="flow-panel-title">
          <Icon name="route" size={14} />
          Route from {stage.name} to {target}{" "}
          <small>
            {routeIndex + 1} of {routes.length} {routes.length === 1 ? "route" : "routes"} out of{" "}
            {stage.name}
          </small>
        </h4>
        <span className="flow-panel-tools">
          <FlowAddMenu
            label="Insert a Stage on this route"
            heading="Insert on this route"
            variant="ghost"
            disabled={note !== undefined}
            title={note}
            onAdd={(added) => onEdited(stageOnRoute(stages, stage.key, routeIndex, added, locked))}
          />
          <Button
            size="sm"
            variant="danger-ghost"
            iconLeft={<Icon name="trash-2" size={12} />}
            disabled={note !== undefined}
            title={note}
            onClick={() => onEdited(routeRemoved(stages, stage.key, routeIndex))}
          >
            Remove route
          </Button>
        </span>
      </div>
      <div className="flow-panel-body">
        {note !== undefined && <FlowLockedNote note={note} />}
        <FlowProblemAlert problems={all.filter(({ at }) => at?.kind === "route" && !at.testPath)} />
        <FlowLockedFields note={note}>
          <Select
            size="sm"
            label="Goes to"
            hint={`A later Stage, or End to make ${stage.name} a final Stage. To go back, use ${stage.name}'s On failure.`}
            value={route.to ?? END}
            options={targetChoices(stage, route, stages)}
            onChange={(to) =>
              onEdited({
                stages: withRouteTarget(stages, stage.key, routeIndex, to === END ? null : to),
              })
            }
          />
          <RadioList
            label="Condition"
            name={`condition-${stage.key}-${routeIndex}`}
            value={route.condition ? SOME_CONDITION : NO_CONDITION}
            options={[
              {
                value: NO_CONDITION,
                label: (
                  <>
                    <b>No condition</b>
                    <span className="flow-panel-choice-words">
                      Always holds. With other routes out of {stage.name}, it goes last, as
                      otherwise.
                    </span>
                  </>
                ),
              },
              {
                value: SOME_CONDITION,
                label: (
                  <>
                    <b>When these hold</b>
                    <span className="flow-panel-choice-words">
                      Built-in tests of a Stage or the Definition of Done, or a Project command that
                      exits 0, in All of and Any of groups.
                    </span>
                  </>
                ),
              },
            ]}
            onChange={(value) =>
              onEdited({
                stages: withRouteCondition(
                  stages,
                  stage.key,
                  routeIndex,
                  value === SOME_CONDITION ? (route.condition ?? NEW_CONDITION) : null,
                ),
              })
            }
          />
          {route.condition && (
            <ConditionBuilder
              condition={route.condition}
              onChange={(condition) =>
                onEdited({ stages: withRouteCondition(stages, stage.key, routeIndex, condition) })
              }
              from={stage}
              stages={stages}
              commands={props.commands}
              problems={all}
            />
          )}
          <p className="flow-condition-reads">{followedWhen(route, stage, stages, routeIndex)}</p>
        </FlowLockedFields>
        {commandKeys.length > 0 && (
          <p className="flow-panel-hint">{commandNote(commandKeys, stage.name)}</p>
        )}
      </div>
    </section>
  );
}

/**
 * Every other Stage in the Pipeline's order, one not later flagged as refused, then End; a target
 * no longer in the flow stays listed as gone.
 */
function targetChoices(
  from: Stage,
  route: Route,
  stages: readonly Stage[],
): { value: string; label: string }[] {
  const column = from.place?.column ?? 0;
  const gone =
    route.to !== null && !stages.some(({ key }) => key === route.to)
      ? [{ value: route.to, label: `${routeTargetName(route, stages)} (gone)` }]
      : [];
  const others = inFlowOrder(stages)
    .filter(({ key }) => key !== from.key)
    .map(({ key, name, place }) => {
      const at = place?.column ?? 0;
      const refused =
        at < column ? " (earlier: refused)" : at === column ? " (same column: refused)" : "";
      return { value: key, label: `${name}${refused}` };
    });
  return [...gone, ...others, { value: END, label: "End" }];
}
