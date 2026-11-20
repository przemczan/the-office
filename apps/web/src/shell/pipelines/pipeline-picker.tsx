import { Badge, GroupedSelect, type GroupedSelectGroup } from "@the-office/ui";
import type { ReactNode } from "react";
import { kindDefaultWords } from "../work/work-words.ts";
import type { PipelineChoice, PipelineChoiceGroup } from "./pipeline-choices.ts";

/**
 * The one Pipeline picker (docs/design/project-pipelines.html, recommendation 6): the groups of
 * `pipeline-choices.ts`, each Pipeline with its Stages under its name, the Project's default
 * badged ("Default for Bugs" where the Task's Kind chose it), and a Broken one listed with its reasons in place of its Stages, which can't be chosen.
 */
export function PipelinePicker({
  label = "Pipeline",
  hint,
  placeholder,
  value,
  groups,
  onChange,
  disabled = false,
  labelHidden = false,
  size = "md",
}: {
  readonly label?: string;
  readonly hint?: string;
  readonly placeholder?: string;
  /** The chosen Pipeline's id; "" for none. */
  readonly value: string;
  readonly groups: readonly PipelineChoiceGroup[];
  readonly onChange: (pipelineId: string) => void;
  readonly disabled?: boolean;
  readonly labelHidden?: boolean;
  readonly size?: "sm" | "md";
}): ReactNode {
  return (
    <GroupedSelect
      label={label}
      hint={hint}
      placeholder={placeholder}
      value={value}
      groups={groups.map(selectGroup)}
      onChange={onChange}
      disabled={disabled}
      labelHidden={labelHidden}
      size={size}
    />
  );
}

function selectGroup({ label, choices }: PipelineChoiceGroup): GroupedSelectGroup {
  return {
    label,
    options: choices.map((choice) => ({
      value: choice.id,
      label: choice.name,
      line: choice.line,
      aside: badgesOf(choice),
      disabledWhy: choice.brokenWhy,
    })),
  };
}

function badgesOf(choice: PipelineChoice): ReactNode {
  if (!choice.isDefault && choice.brokenWhy === undefined) return undefined;
  return (
    <>
      {choice.isDefault && (
        <Badge size="sm">
          {choice.defaultFor ? kindDefaultWords(choice.defaultFor) : "Project default"}
        </Badge>
      )}
      {choice.brokenWhy !== undefined && (
        <Badge size="sm" tone="danger">
          Broken
        </Badge>
      )}
    </>
  );
}
