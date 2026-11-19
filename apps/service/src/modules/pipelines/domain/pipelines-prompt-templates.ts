import type { PromptTemplate } from "../../prompt-templates/index.js";
import { RESOLVE_BRIEF } from "./resolve-stages.js";

/** Every Prompt template Pipelines renders, which it registers at start. */
export const PIPELINES_PROMPT_TEMPLATES: readonly PromptTemplate[] = [RESOLVE_BRIEF];
