import { defaultPromptTexts, type PromptTexts } from "../../prompt-templates/index.js";
import { WORK_PROMPT_TEMPLATES } from "./work-prompt-templates.js";

/** Every Work template's default text, as a test renders with while none was saved. */
export function defaultWorkPrompts(): PromptTexts {
  return defaultPromptTexts(WORK_PROMPT_TEMPLATES);
}
