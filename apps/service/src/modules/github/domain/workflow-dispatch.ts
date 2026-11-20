import { parse } from "yaml";

/** The input types `workflow_dispatch` declares; an unknown type counts as string. */
export type DispatchInputType = "string" | "boolean" | "choice" | "number" | "environment";

/** One input a workflow's `workflow_dispatch` declares. */
export interface DispatchInput {
  readonly name: string;
  /** Empty when it has none. */
  readonly description: string;
  readonly required: boolean;
  /** Its default as a string, such as "true" for a boolean; null when it has none. */
  readonly default: string | null;
  readonly type: DispatchInputType;
  /** A choice's options, in their order; empty for the other types. */
  readonly options: readonly string[];
}

const INPUT_TYPES: readonly DispatchInputType[] = [
  "string",
  "boolean",
  "choice",
  "number",
  "environment",
];

/**
 * The inputs a workflow file declares for `workflow_dispatch`
 * (docs.github.com/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatch),
 * in its order; undefined when the file isn't valid YAML or doesn't declare the trigger. Read as
 * YAML 1.2, so the key `on` stays "on" rather than YAML 1.1's boolean true.
 */
export function dispatchInputsOf(yamlText: string): readonly DispatchInput[] | undefined {
  let workflow: unknown;
  try {
    // A repository's file is no fault of The Office's, so its YAML warnings aren't logged.
    workflow = parse(yamlText, { version: "1.2", logLevel: "error" });
  } catch {
    return undefined;
  }
  if (!isMap(workflow)) return undefined;
  const trigger = dispatchTriggerOf(workflow["on"]);
  if (trigger === undefined) return undefined;
  const inputs = isMap(trigger) ? trigger["inputs"] : undefined;
  if (!isMap(inputs)) return [];
  return Object.entries(inputs).map(([name, input]) => inputOf(name, isMap(input) ? input : {}));
}

/**
 * The `workflow_dispatch` trigger of `on`: its value in a map (null when it has none), true for the
 * string or a list naming it, undefined when `on` doesn't declare it.
 */
function dispatchTriggerOf(on: unknown): unknown {
  if (on === "workflow_dispatch") return true;
  if (Array.isArray(on)) return on.includes("workflow_dispatch") ? true : undefined;
  if (isMap(on) && "workflow_dispatch" in on) return on["workflow_dispatch"] ?? null;
  return undefined;
}

function inputOf(name: string, input: Record<string, unknown>): DispatchInput {
  const type = INPUT_TYPES.find((each) => each === input["type"]) ?? "string";
  return {
    name,
    description: typeof input["description"] === "string" ? input["description"] : "",
    required: input["required"] === true,
    default: textOf(input["default"]),
    type,
    options:
      type === "choice" && Array.isArray(input["options"])
        ? input["options"].flatMap((option) => textOf(option) ?? [])
        : [],
  };
}

/** A scalar as a string, such as "true" for a boolean; null for anything else. */
function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return null;
}

function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
