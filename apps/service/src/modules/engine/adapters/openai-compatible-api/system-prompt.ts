import type { PromptTexts } from "../../../prompt-templates/index.js";
import { API_SYSTEM_PROMPT } from "../../domain/engine-prompt-templates.js";
import type { SystemMessage } from "./chat-completions.js";
import type { InstructionFile } from "./project-instructions.js";
import { STRUCTURED_OUTPUT_TOOL } from "./structured-output-tool.js";

export interface SystemPromptParts {
  /** The folder the session works in. */
  readonly folder: string;
  /** For the model's paths and commands, as the platform names the system. */
  readonly operatingSystem: string;
  /** The Project's instruction files in the folder, as `projectInstructions` finds them. */
  readonly projectInstructions: readonly InstructionFile[];
  /** The Agent's standing instructions, such as its Role card's. */
  readonly instructions: string;
  /** Whether each turn ends in output given through StructuredOutput. */
  readonly answersInSchema: boolean;
}

/**
 * What every session's conversation starts with: how the loop works and the Project's instruction
 * files, as `API_SYSTEM_PROMPT` words them, then the Agent's own instructions. Nothing in it
 * changes between a session's requests, so the server can keep the prefix cached; the date is left
 * out for that reason.
 */
export function systemPrompt(
  prompts: PromptTexts,
  {
    folder,
    operatingSystem,
    projectInstructions,
    instructions,
    answersInSchema,
  }: SystemPromptParts,
): SystemMessage {
  const office = prompts.render(API_SYSTEM_PROMPT, {
    folder,
    operatingSystem,
    answersInSchema,
    structuredOutputTool: STRUCTURED_OUTPUT_TOOL,
    hasProjectInstructions: projectInstructions.length > 0,
    projectInstructions,
  });
  return {
    role: "system",
    content: [office, ...(instructions === "" ? [] : [instructions])].join("\n\n"),
  };
}
