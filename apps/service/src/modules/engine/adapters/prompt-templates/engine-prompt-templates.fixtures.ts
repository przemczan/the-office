import { defaultPromptTexts, type PromptTemplates } from "../../../prompt-templates/index.js";

/**
 * Prompt templates that read every template's default, for a test's engine that doesn't save a
 * text. A test that does takes `promptTemplatesFor` from the module's fixtures, which only test
 * files may import.
 */
export function defaultEnginePromptTemplates(): PromptTemplates {
  const defaults: Pick<PromptTemplates, "textsOf"> = {
    textsOf: (templates) => Promise.resolve(defaultPromptTexts(templates)),
  };
  return defaults as PromptTemplates;
}
