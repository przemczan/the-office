import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_STAGE_CONTEXT_LIMITS,
  STAGE_CONTEXT_LIMIT_TOKENS,
  type Stage,
  type StageContextLimits,
} from "@the-office/contracts";
import { Field, Select, Stepper } from "@the-office/ui";
import type { ReactNode } from "react";
import { stageContextLimitsQuery } from "../../api/conversations.ts";
import { tokensShort } from "../conversation/context-words.ts";
import type { AgentStage } from "./stage-edits.ts";

/** The Select's three choices: the Office defaults (no `contextLimits`), the Stage's own, or none. */
type ContextLimitsChoice = "office" | "set" | "none";

function choiceOf(stage: AgentStage): ContextLimitsChoice {
  return stage.contextLimits?.kind ?? "office";
}

/** The Stage without `contextLimits`, so it takes the Office defaults. */
function withOfficeDefaults(stage: AgentStage): AgentStage {
  const { contextLimits: _kept, ...rest } = stage;
  return rest;
}

/**
 * An Agent Stage's context limits (spec §2.5): the Office defaults, read from Settings › Office
 * limits so the choice names them; its own soft and hard limits, each stepped so they never go
 * blank or out of the other's bounds; or No limit.
 */
export function StageContextLimitFields({
  stage,
  change,
}: {
  readonly stage: AgentStage;
  readonly change: (stage: Stage) => void;
}): ReactNode {
  const officeDefaults: StageContextLimits =
    useQuery(stageContextLimitsQuery()).data?.stageContextLimits ?? DEFAULT_STAGE_CONTEXT_LIMITS;
  const choice = choiceOf(stage);
  const choose = (next: string): void => {
    if (next === "set")
      change({ ...stage, contextLimits: { kind: "set", limits: officeDefaults } });
    else if (next === "none") change({ ...stage, contextLimits: { kind: "none" } });
    else change(withOfficeDefaults(stage));
  };
  const own = stage.contextLimits?.kind === "set" ? stage.contextLimits.limits : null;
  const { softMin, gap, max, step } = STAGE_CONTEXT_LIMIT_TOKENS;
  const setLimits = (limits: StageContextLimits): void =>
    change({ ...stage, contextLimits: { kind: "set", limits } });
  return (
    <>
      <Select
        label="Context limits"
        hint="Past the soft limit the Agent hands over; the Stage goes on in a fresh session"
        value={choice}
        options={[
          {
            value: "office",
            label: `Office default (${tokensShort(officeDefaults.soft)} / ${tokensShort(officeDefaults.hard)})`,
          },
          { value: "set", label: "Set for this Stage" },
          { value: "none", label: "No limit" },
        ]}
        onChange={choose}
      />
      {own && (
        <div className="stage-form-limits">
          <Field label="Soft limit">
            <Stepper
              label="the soft limit"
              value={own.soft}
              min={softMin}
              max={Math.min(max, own.hard - gap)}
              step={step}
              format={tokensShort}
              onChange={(soft) => setLimits({ soft, hard: own.hard })}
            />
          </Field>
          <Field label="Hard limit">
            <Stepper
              label="the hard limit"
              value={own.hard}
              min={own.soft + gap}
              max={max}
              step={step}
              format={tokensShort}
              onChange={(hard) => setLimits({ soft: own.soft, hard })}
            />
          </Field>
        </div>
      )}
    </>
  );
}
