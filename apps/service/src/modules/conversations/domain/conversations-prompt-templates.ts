import type { PromptTemplate } from "../../prompt-templates/index.js";
import { BRIEF_TEMPLATES } from "./brief-templates.js";
import { SESSION_INSTRUCTION_TEMPLATES } from "./session-instruction-templates.js";

/** Every Prompt template Conversations renders, which it registers at start. */
export const CONVERSATIONS_PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  ...SESSION_INSTRUCTION_TEMPLATES,
  ...BRIEF_TEMPLATES,
];
