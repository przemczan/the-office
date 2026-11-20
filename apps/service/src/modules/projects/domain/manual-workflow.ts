import { ProjectRefused } from "./project-refused.js";

/** The kind of a Workflow's input, in words no code host owns. */
export type WorkflowInputKind = "text" | "yes-no" | "choice" | "number" | "environment";

/** One input a Workflow declares for a start by hand. */
export interface WorkflowInput {
  readonly name: string;
  /** Empty when it has none. */
  readonly description: string;
  readonly required: boolean;
  /** Its default as text, such as "true" for a yes-no; null when it has none. */
  readonly default: string | null;
  readonly kind: WorkflowInputKind;
  /** A choice's options, in their order; empty for the other kinds. */
  readonly options: readonly string[];
}

/** A Workflow that can be started by hand on a branch or tag, as its file there declares it. */
export interface ManualWorkflow {
  /** Its file's name, such as release.yml. */
  readonly id: string;
  readonly name: string;
  /** Its page on the code host. */
  readonly url: string;
  readonly inputs: readonly WorkflowInput[];
}

/**
 * The inputs a start by hand sends, as text: each given one, and each left out with a default
 * taking it; one with neither is left out. Refuses, with every reason in plain words, an input the
 * Workflow doesn't declare, a required one with no value (an empty one counts as none), a choice
 * outside its options, a yes-no other than true or false, and a number that isn't one.
 */
export function inputsToSend(
  workflow: ManualWorkflow,
  given: Readonly<Record<string, string>>,
): Record<string, string> {
  const declared = new Map(workflow.inputs.map((input) => [input.name, input]));
  const reasons = Object.keys(given)
    .filter((name) => !declared.has(name))
    .map((name) => `${workflow.id} has no input named ${name}.`);
  const sent: Record<string, string> = {};
  for (const input of workflow.inputs) {
    const value = Object.hasOwn(given, input.name) ? given[input.name] : undefined;
    const chosen = [value, input.default].find(
      (each) => each !== undefined && each !== null && each !== "",
    );
    if (chosen === undefined || chosen === null) {
      if (input.required) reasons.push(`${workflow.id} needs a value for ${input.name}.`);
      continue;
    }
    const problem = problemOf(input, chosen);
    if (problem !== undefined) reasons.push(`${workflow.id}'s ${input.name} ${problem}`);
    else sent[input.name] = chosen;
  }
  if (reasons.length > 0) throw new ProjectRefused(reasons);
  return sent;
}

/** Why `value` doesn't fit the input's kind, ending a sentence; undefined when it fits. */
function problemOf(input: WorkflowInput, value: string): string | undefined {
  switch (input.kind) {
    case "choice":
      return input.options.includes(value)
        ? undefined
        : `is "${value}", not one of its options: ${input.options.join(", ")}.`;
    case "yes-no":
      return value === "true" || value === "false"
        ? undefined
        : `is "${value}", but a yes-no is true or false.`;
    case "number":
      return value.trim() !== "" && Number.isFinite(Number(value))
        ? undefined
        : `is "${value}", which isn't a number.`;
    case "text":
    case "environment":
      return undefined;
  }
}
