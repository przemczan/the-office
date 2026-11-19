import type { PromptTemplate, PromptValues, PromptVariables } from "./prompt-template.js";
import { renderPrompt } from "./render-prompt.js";

/**
 * The texts of some templates as they are now, loaded together before the domain renders with
 * them, so the domain stays free of storage.
 */
export class PromptTexts {
  constructor(private readonly texts: ReadonlyMap<string, string>) {}

  /** Throws for a template whose text wasn't loaded. */
  render<Variables extends PromptVariables>(
    template: PromptTemplate<Variables>,
    values: PromptValues<Variables>,
  ): string {
    const text = this.texts.get(template.key);
    if (text === undefined) {
      throw new Error(
        `The text of the prompt template ${template.key} wasn't loaded with the others.`,
      );
    }
    return renderPrompt(text, values);
  }
}

/** The templates' default texts, as a domain test renders them. */
export function defaultPromptTexts(templates: readonly PromptTemplate[]): PromptTexts {
  return new PromptTexts(new Map(templates.map(({ key, text }) => [key, text])));
}
