import type { StageChange } from "@the-office/contracts";
import { Alert, Badge, Button, Icon, Select } from "@the-office/ui";
import type { ReactNode } from "react";
import {
  withOwnKey,
  withoutStageChange,
  withStageChangeAppliedTo,
  type BuiltRows,
  type StageChangesShown,
} from "../stage-change-edits.ts";
import { changedFieldsWords, counted, STAGE_CHANGE_KIND_NAMES } from "../stage-change-words.ts";

/**
 * Above a Project Pipeline's flow, what is Broken on no Stage (docs/design/project-pipelines.html,
 * kept by docs/design/pipeline-flow.html): the Stage changes that don't apply, each with why and its
 * fix, Apply it to another Stage or Give … a key of its own, or Remove this Stage change; then the
 * Broken reasons on neither a Stage nor a Stage change.
 */
export function ProjectFlowBroken({
  shown,
  built,
  baseName,
  stageChanges,
  onChange,
  pending = false,
}: {
  readonly shown: StageChangesShown;
  readonly built: BuiltRows;
  readonly baseName: string;
  readonly stageChanges: readonly StageChange[];
  readonly onChange: (stageChanges: readonly StageChange[]) => void;
  readonly pending?: boolean;
}): ReactNode {
  const live = built.rows.filter(({ origin }) => origin !== "removed");
  const { notApplying, brokenElsewhere } = shown;
  const title = `${counted(notApplying.length, "Stage change doesn't apply", "Stage changes don't apply")} to ${baseName}`;
  return (
    <>
      {notApplying.length > 0 && (
        <div className="project-flow-not-apply" role="group" aria-label={title}>
          <div className="project-flow-not-apply-head">
            <Icon name="circle-alert" size={14} />
            {title}
          </div>
          {notApplying.map(({ index, stageChange, why, fix }) => (
            <div key={`${index}-${why}`} className="project-flow-not-apply-item">
              <div className="project-flow-what">
                <Badge size="sm" tone="warning">
                  {STAGE_CHANGE_KIND_NAMES[stageChange.kind]}
                </Badge>
                {stageChange.stageName ?? stageChange.stageKey}
                {stageChange.kind === "change" && (
                  <span className="project-flow-detail">
                    · {changedFieldsWords(Object.keys(stageChange.fields))}
                  </span>
                )}
              </div>
              <div className="project-flow-why">{why}</div>
              <div className="project-flow-fix">
                {fix === "apply-to" ? (
                  <Select
                    size="sm"
                    label="Apply it to"
                    placeholder="Choose a Stage…"
                    value=""
                    disabled={pending}
                    options={live.map(({ stage }) => ({ value: stage.key, label: stage.name }))}
                    onChange={(key) => {
                      const target = live.find(({ stage }) => stage.key === key);
                      if (target)
                        onChange(withStageChangeAppliedTo(stageChanges, index, target.stage));
                    }}
                  />
                ) : (
                  "stage" in stageChange && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => onChange(withOwnKey(stageChanges, index, built.rows))}
                    >
                      Give {stageChange.stage.name} a key of its own
                    </Button>
                  )
                )}
                <span>or</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  iconLeft={<Icon name="trash-2" size={13} />}
                  onClick={() => onChange(withoutStageChange(stageChanges, index))}
                >
                  Remove this Stage change
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {brokenElsewhere.length > 0 && (
        <Alert tone="danger" title="These Stages can't run as they are">
          <ul className="refusal-reasons">
            {brokenElsewhere.map(({ text }) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Alert>
      )}
    </>
  );
}
