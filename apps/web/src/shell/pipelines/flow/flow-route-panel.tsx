import type { ConditionGroup, Stage } from "@the-office/contracts";
import { Button, Icon, RadioList } from "@the-office/ui";
import type { ReactNode } from "react";
import { ConditionBuilder } from "./condition-builder.tsx";
import { commandNote, conditionCommandKeys } from "./condition-commands.ts";
import { NEW_CONDITION } from "./condition-edits.ts";
import { followedWhen, routeTargetName } from "./condition-words.ts";
import { FlowAddMenu } from "./flow-add-menu.tsx";
import { FlowLockedFields, FlowLockedNote } from "./flow-locked.tsx";
import { NO_LOCKS } from "./flow-marks.ts";
import {
  FAILED_CONDITION,
  isRouteBack,
  type RouteForm,
  routeFormOf,
  withRouteCondition,
  withRouteLimit,
  withRouteTarget,
} from "./flow-model.ts";
import type { FlowPanelProps } from "./flow-panel.tsx";
import { FlowProblemAlert } from "./flow-problem-alert.tsx";
import { FlowRouteLimit, FlowRouteTarget } from "./flow-route-fields.tsx";
import { routeProblems } from "./flow-view.ts";
import { routeRemoved, stageOnRoute } from "./office-flow-edits.ts";

/**
 * The picked route's panel (docs/spec/screens/pipeline-flow-editor.md): where it goes, any Stage or
 * End, its limit, and its form: When it fails (an Agent Stage's), "When these hold" in the
 * condition builder, or Otherwise, read in plain words under it with its limit. Insert a Stage on
 * this route and Remove route head it. A route out of a locked Stage (a Task's started one) reads
 * only, each control disabled with why.
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
  const form = routeFormOf(stage, route);
  const commandKeys =
    form === "holds" && route.condition ? conditionCommandKeys(route.condition) : [];
  const back = isRouteBack(stages, stage.key, route.to);
  const failsElsewhere = routes.some(
    (other, index) => index !== routeIndex && routeFormOf(stage, other) === "fails",
  );
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
            templates
            links={props.links ?? false}
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
          <div className="flow-route-panel-fields">
            <FlowRouteTarget
              route={route}
              stages={stages}
              hint={`Any Stage, this one or an earlier one to go back, or End to make ${stage.name} a final Stage.`}
              onChange={(to) =>
                onEdited({ stages: withRouteTarget(stages, stage.key, routeIndex, to) })
              }
            />
            <FlowRouteLimit
              from={stage}
              route={route}
              stages={stages}
              hint={`${back ? "A route back: it starts at 3." : "A route on: it starts at No limit."} At its limit, the walk stops and you're asked (or the CTO first).`}
              onChange={(limit) =>
                onEdited({ stages: withRouteLimit(stages, stage.key, routeIndex, limit) })
              }
            />
          </div>
          <RadioList
            label="Condition"
            name={`condition-${stage.key}-${routeIndex}`}
            value={form}
            options={formChoices(stage, failsElsewhere)}
            onChange={(value) =>
              onEdited({
                stages: withRouteCondition(
                  stages,
                  stage.key,
                  routeIndex,
                  conditionOf(value as RouteForm, form, route.condition),
                ),
              })
            }
          />
          {form === "fails" && <p className="flow-panel-hint">When {stage.name} ends Failed.</p>}
          {form === "holds" && route.condition && (
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
 * The forms a route may take: When it fails only on an Agent Stage with no other failure row, then
 * When these hold and Otherwise.
 */
function formChoices(stage: Stage, failsElsewhere: boolean): FormChoice[] {
  return [
    ...(stage.kind === "agent" && !failsElsewhere
      ? [
          choice(
            "fails",
            "When it fails",
            `Followed when ${stage.name} ends Failed, weighed first; the Stage it leads to is briefed with the error.`,
          ),
        ]
      : []),
    choice(
      "holds",
      "When these hold",
      "Built-in tests of a Stage or the Definition of Done, or a Project command that exits 0, in All of and Any of groups.",
    ),
    choice(
      "otherwise",
      "Otherwise",
      `Always holds. With other routes out of ${stage.name}, it goes last.`,
    ),
  ];
}

interface FormChoice {
  readonly value: RouteForm;
  readonly label: ReactNode;
}

function choice(value: RouteForm, words: string, more: string): FormChoice {
  return {
    value,
    label: (
      <>
        <b>{words}</b>
        <span className="flow-panel-choice-words">{more}</span>
      </>
    ),
  };
}

/** The route's condition once its form is picked: a condition kept while it stays When these hold. */
function conditionOf(
  picked: RouteForm,
  was: RouteForm,
  condition: ConditionGroup | null,
): ConditionGroup | null {
  switch (picked) {
    case "fails":
      return FAILED_CONDITION;
    case "otherwise":
      return null;
    case "holds":
      return was === "holds" && condition ? condition : NEW_CONDITION;
  }
}
