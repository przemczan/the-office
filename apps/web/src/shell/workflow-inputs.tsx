import type { ManualWorkflow, WorkflowInput } from "@the-office/contracts";
import { Input, Select, Switch } from "@the-office/ui";
import type { ReactNode } from "react";

/** A choice input's placeholder while none of its options is picked. */
export const CHOOSE_OPTION = "Choose one";

/**
 * One input a workflow's file declares, as Work › CI's Start a workflow and a Workflow Action's
 * editor ask for it: a text field, a switch, a choice of its options or a number field.
 */
export function WorkflowInputControl({
  input,
  value,
  onChange,
  hint: extraHint,
}: {
  readonly input: WorkflowInput;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Said after the input's own description, such as "Fixed with the Action". */
  readonly hint?: string;
}): ReactNode {
  const hint =
    extraHint === undefined
      ? input.description || undefined
      : [sentenceOf(input.description), extraHint].filter((part) => part !== "").join(" ");
  switch (input.kind) {
    case "yes-no":
      return (
        <Switch
          label={input.name}
          description={hint}
          checked={value === "true"}
          onChange={(checked) => onChange(String(checked))}
        />
      );
    case "choice":
      return (
        <Select
          label={input.name}
          hint={hint}
          required={input.required}
          placeholder={CHOOSE_OPTION}
          value={value}
          options={[...input.options]}
          onChange={onChange}
        />
      );
    case "number":
    case "text":
    case "environment":
      return (
        <Input
          label={input.name}
          hint={hint}
          required={input.required}
          type={input.kind === "number" ? "number" : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

/** Each input's value: what the user entered, else its default; a yes-no is "false" with neither. */
export function workflowInputValuesOf(
  workflow: ManualWorkflow,
  entered: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    workflow.inputs.map(({ name, kind, default: byDefault }) => [
      name,
      entered[name] ?? byDefault ?? (kind === "yes-no" ? "false" : ""),
    ]),
  );
}

/** A workflow's own description as a sentence, so a hint said after it reads apart from it. */
function sentenceOf(description: string): string {
  const trimmed = description.trim();
  return trimmed === "" || /[.!?:]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
