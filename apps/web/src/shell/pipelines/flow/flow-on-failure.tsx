import type { ConditionGroup, Stage } from "@the-office/contracts";
import { Select, Stepper } from "@the-office/ui";
import { useEffect, useRef, type ReactNode } from "react";
import { replaceStage } from "../stage-edits.ts";
import { routeTargetName } from "./condition-words.ts";
import { flowFailureTargets } from "./flow-model.ts";
import type { FlowPanelProps } from "./flow-panel.tsx";
import { FlowLockedFields } from "./flow-locked.tsx";
import { FlowProblemAlert } from "./flow-problem-alert.tsx";

/** The most times a failure may go back. */
const MOST_ROUNDS = 9;

/** What a new loop starts with, as the Stage form's did. */
const NEW_ROUNDS = 2;

const NO_LOOP = "";

type WorkingStage = Exclude<Stage, { kind: "gate" }>;

/**
 * On failure (docs/design/pipeline-flow.html): "No loop" or "Go back to Implement", only earlier
 * Stages offered, "at most [3] times, then as below", and When Tests fails, in the order spec 2.3
 * says. Pressing a loop's mark or a problem on it opens the Stage here, the section marked. A locked
 * Stage's reads only, disabled with why (`note`).
 */
export function FlowOnFailure(
  props: FlowPanelProps & {
    readonly stage: WorkingStage;
    readonly onFailurePicked: boolean;
    readonly note?: string | undefined;
  },
): ReactNode {
  const { stage, stages, onEdited, problems, onFailurePicked } = props;
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!onFailurePicked) return;
    section.current?.scrollIntoView?.({ block: "nearest" });
    section.current?.querySelector("select")?.focus();
  }, [onFailurePicked]);
  const targets = flowFailureTargets(stages, stage.key);
  const onFailure = stage.onFailure;
  const target = onFailure && stages.find(({ key }) => key === onFailure.goBackTo);
  const stale = onFailure !== undefined && !targets.some(({ key }) => key === onFailure.goBackTo);
  const choices = [
    { value: NO_LOOP, label: "No loop" },
    ...targets.map(({ key, name }) => ({ value: key, label: `Go back to ${name}` })),
    ...(onFailure && stale
      ? [
          {
            value: onFailure.goBackTo,
            label: `Go back to ${target?.name ?? onFailure.goBackTo} (${target ? "not earlier" : "gone"})`,
          },
        ]
      : []),
  ];
  const change = (changed: WorkingStage): void =>
    onEdited({ stages: replaceStage(stages, stages.indexOf(stage), changed) });
  const own = problems.filter(
    ({ stageKey, at }) => stageKey === stage.key && at?.kind === "onFailure",
  );
  return (
    <section
      ref={section}
      className={`flow-panel-section${onFailurePicked ? " flow-panel-section--picked" : ""}`}
      aria-label="On failure"
    >
      <div className="flow-panel-section-head">
        <span className="flow-panel-overline">On failure</span>
      </div>
      <FlowProblemAlert problems={own} />
      <FlowLockedFields note={props.note}>
        <div className="flow-loop-row">
          <Select
            size="sm"
            aria-label="On failure"
            value={onFailure?.goBackTo ?? NO_LOOP}
            options={choices}
            onChange={(goBackTo) =>
              change({
                ...stage,
                onFailure:
                  goBackTo === NO_LOOP
                    ? undefined
                    : { goBackTo, rounds: onFailure?.rounds ?? NEW_ROUNDS },
              })
            }
          />
          {onFailure && (
            <>
              <span>at most</span>
              <Stepper
                label="Rounds"
                value={onFailure.rounds}
                min={1}
                max={MOST_ROUNDS}
                onChange={(rounds) => change({ ...stage, onFailure: { ...onFailure, rounds } })}
              />
              <span>{onFailure.rounds === 1 ? "time" : "times"}, then as below</span>
            </>
          )}
        </div>
      </FlowLockedFields>
      <p className="flow-panel-hint">
        A loop, not a route: it runs only when {stage.name} fails, going back before any route is
        weighed, and it is drawn apart from the routes, as a dashed red line.
        {targets.length === 0 &&
          ` ${stage.name} is first, so it has nowhere earlier to go back to.`}
      </p>
      <ol className="flow-when-fails" aria-label={`When ${stage.name} fails`}>
        <li>
          {onFailure && target && !stale
            ? `Back to ${target.name} while it has rounds left: at most ${onFailure.rounds} ${onFailure.rounds === 1 ? "time" : "times"}.`
            : "No loop: nothing runs again by itself."}
        </li>
        <li>{failedRouteWords(stage, stages)}</li>
        <li>
          Then it is put to whoever holds Asked first when a Stage runs out of tries, then to you.
          Continuing with the issues follows its routes as usual.
        </li>
      </ol>
    </section>
  );
}

function failedRouteWords(stage: Stage, stages: readonly Stage[]): string {
  const route = (stage.routes ?? []).find(
    ({ condition }) => condition !== null && saysFailed(condition, stage.key),
  );
  return route
    ? `Then the route to ${routeTargetName(route, stages)}, as its condition says ${stage.name} ended Failed.`
    : `Then a route whose condition says ${stage.name} ended Failed: it has none.`;
}

/** Whether All of the group's tests includes "the Stage ended Failed". */
function saysFailed({ combine, tests }: ConditionGroup, key: string): boolean {
  if (combine !== "all" && tests.length > 1) return false;
  return tests.some(
    (test) =>
      "kind" in test &&
      test.kind === "stage" &&
      (test.stage === null || test.stage === key) &&
      test.is === "failed",
  );
}
