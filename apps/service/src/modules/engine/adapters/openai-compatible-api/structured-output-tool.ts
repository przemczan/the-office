import type { JsonSchema } from "../../ports/session-options.js";
import {
  outputCheck,
  STRUCTURED_OUTPUT_DESCRIPTION,
  STRUCTURED_OUTPUT_TAKEN,
  STRUCTURED_OUTPUT_TOOL,
} from "../structured-output/structured-output.js";
import { success, type BuiltInTool } from "./built-in-tool.js";

/**
 * The tool a session with an output schema answers through, its parameters the schema itself, as
 * on Claude Code. Input that doesn't match is refused with what is wrong, so the model calls it
 * again; the loop takes the matching input as the turn's output.
 */
export function structuredOutputTool(schema: JsonSchema): BuiltInTool {
  const check = outputCheck(schema);
  return {
    name: STRUCTURED_OUTPUT_TOOL,
    officeTool: false,
    definition: {
      type: "function",
      function: {
        name: STRUCTURED_OUTPUT_TOOL,
        description: STRUCTURED_OUTPUT_DESCRIPTION,
        parameters: schema,
      },
    },
    prepare(input) {
      const problem = check(input);
      if (problem !== undefined) return { valid: false, problem };
      return {
        valid: true,
        input,
        run: () => Promise.resolve(success(STRUCTURED_OUTPUT_TAKEN)),
      };
    },
  };
}
