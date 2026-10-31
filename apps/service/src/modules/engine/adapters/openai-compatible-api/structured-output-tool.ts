import { Ajv2020 } from "ajv/dist/2020.js";
import type { JsonSchema } from "../../ports/session-options.js";
import { success, type BuiltInTool } from "./built-in-tool.js";

/** Claude Code's name for the tool a turn's output is given through, allowed under every profile. */
export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

/**
 * The tool a session with an output schema answers through, its parameters the schema itself, as
 * on Claude Code. Input that doesn't match is refused with what is wrong, so the model calls it
 * again; the loop takes the matching input as the turn's output.
 */
export function structuredOutputTool(schema: JsonSchema): BuiltInTool {
  // Not strict: a schema may carry keywords Ajv doesn't know, such as a `description` placement.
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  return {
    name: STRUCTURED_OUTPUT_TOOL,
    officeTool: false,
    definition: {
      type: "function",
      function: {
        name: STRUCTURED_OUTPUT_TOOL,
        description:
          "Gives your final answer in the shape it is asked for. Call it once at the end of your work, with the whole answer as its input.",
        parameters: schema,
      },
    },
    prepare(input) {
      if (!validate(input)) {
        return {
          valid: false,
          problem: (validate.errors ?? [])
            .map(
              (error) => `${error.instancePath || "the answer"} ${error.message ?? "is invalid"}`,
            )
            .join("\n"),
        };
      }
      return {
        valid: true,
        input,
        run: () => Promise.resolve(success("Structured output provided successfully")),
      };
    },
  };
}
