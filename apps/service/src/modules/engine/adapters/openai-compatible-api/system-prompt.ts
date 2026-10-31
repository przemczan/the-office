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

/** How Claude Code introduces the instruction files it loads. */
const INSTRUCTIONS_INTRO =
  "Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.";

/**
 * What every session's conversation starts with: how the loop works, the Project's instruction
 * files, then the Agent's own instructions. Nothing in it changes between a session's requests,
 * so the server can keep the prefix cached; the date is left out for that reason.
 */
export function systemPrompt({
  folder,
  operatingSystem,
  projectInstructions,
  instructions,
  answersInSchema,
}: SystemPromptParts): SystemMessage {
  const base = [
    "You are an Agent working in The Office, on the user's computer.",
    `Your working folder is ${folder}, on ${operatingSystem}. Give tools absolute paths.`,
    "Use the tools to read, search and change files; read a file before you edit or overwrite it. Run commands with the shell tools.",
    "Every tool call is judged by The Office's rules before it runs. When a call is refused, the result says why; don't work around the refusal.",
    "A message in <task-notification> tags is not the user: it tells you a background command has ended.",
    answersInSchema
      ? `When the work is done, call ${STRUCTURED_OUTPUT_TOOL} with your answer; that ends your turn.`
      : "When the work is done, reply in plain words.",
  ].join("\n");
  const parts = [
    base,
    ...(projectInstructions.length === 0 ? [] : [instructionFiles(projectInstructions)]),
    ...(instructions === "" ? [] : [instructions]),
  ];
  return { role: "system", content: parts.join("\n\n") };
}

function instructionFiles(files: readonly InstructionFile[]): string {
  return [
    INSTRUCTIONS_INTRO,
    ...files.map(
      ({ path, text }) =>
        `Contents of ${path} (project instructions, checked into the codebase):\n\n${text}`,
    ),
  ].join("\n\n");
}
