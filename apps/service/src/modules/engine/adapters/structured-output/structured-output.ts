import { Ajv2020 } from "ajv/dist/2020.js";
import type { JsonSchema } from "../../ports/session-options.js";

/**
 * Claude Code's name for the tool a turn's output is given through, allowed under every profile;
 * engines without a schema option of their own offer it as a tool whose input schema is the
 * output's (the OpenAI-compatible API engine, the Gemini CLI engine).
 */
export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

/** What the model reads of the StructuredOutput tool. */
export const STRUCTURED_OUTPUT_DESCRIPTION =
  "Gives your final answer in the shape it is asked for. Call it once at the end of your work, with the whole answer as its input.";

/** What a StructuredOutput call that fits is answered, as Claude Code answers it. */
export const STRUCTURED_OUTPUT_TAKEN = "Structured output provided successfully";

/**
 * How often a turn that must end in output is reminded when its model ends it without calling
 * StructuredOutput with input that fits, before the turn fails, as Claude Code retries it.
 */
export const OUTPUT_REMINDERS = 2;

/** Why a turn ended without its output, once its reminders are spent. */
export function missingOutputError(): string {
  return `The turn ended without its output: the model answered ${OUTPUT_REMINDERS + 1} times without calling ${STRUCTURED_OUTPUT_TOOL} with input that fits.`;
}

/** What is wrong with an answer, in words the model reads, or undefined when it fits. */
export type OutputCheck = (input: unknown) => string | undefined;

/** Checks answers against `schema` with Ajv. */
export function outputCheck(schema: JsonSchema): OutputCheck {
  // Not strict: a schema may carry keywords Ajv doesn't know, such as a `description` placement.
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  return (input) =>
    validate(input)
      ? undefined
      : (validate.errors ?? [])
          .map((error) => `${error.instancePath || "the answer"} ${error.message ?? "is invalid"}`)
          .join("\n");
}
