import type { PromptTemplate, PromptValues, PromptVariables } from "./prompt-template.js";
import type { PromptTexts } from "./prompt-texts.js";

/**
 * A template rendered as a whole text or a part of one. A section on its own last line leaves the
 * line's break behind it, so exactly one final `\n` is dropped: the parts then join as the code
 * joined them before they were templates.
 */
export function renderedPart<Variables extends PromptVariables>(
  prompts: PromptTexts,
  template: PromptTemplate<Variables>,
  values: PromptValues<Variables>,
): string {
  const text = prompts.render(template, values);
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/**
 * A record field that opens a section when true: a list's records hold only texts, and an empty
 * text is false to a template.
 */
export function flagField(value: boolean): string {
  return value ? "yes" : "";
}
