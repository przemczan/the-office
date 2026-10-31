import type { SystemMessage } from "./chat-completions.js";
import { STRUCTURED_OUTPUT_TOOL } from "./structured-output-tool.js";

export interface SystemPromptParts {
  /** The folder the session works in. */
  readonly folder: string;
  /** For the model's paths and commands, as the platform names the system. */
  readonly operatingSystem: string;
  /** The Agent's standing instructions, such as its Role card's. */
  readonly instructions: string;
  /** Whether each turn ends in output given through StructuredOutput. */
  readonly answersInSchema: boolean;
}

/**
 * What every session's conversation starts with: how the loop works, then the Agent's own
 * instructions. Nothing in it changes between a session's requests, so the server can keep the
 * prefix cached; the date is left out for that reason.
 */
export function systemPrompt({
  folder,
  operatingSystem,
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
  return {
    role: "system",
    content: instructions === "" ? base : `${base}\n\n${instructions}`,
  };
}
