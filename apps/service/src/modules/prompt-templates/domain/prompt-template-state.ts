import type { PromptTemplate } from "./prompt-template.js";
import type { PromptTemplateVersion } from "./prompt-template-version.js";
import { promptTextProblems, type PromptTextProblem } from "./prompt-text-problems.js";

/** A template as it stands now: its newest saved version, if any, and the text it renders. */
export interface PromptTemplateState {
  readonly template: PromptTemplate;
  readonly saved: PromptTemplateVersion | undefined;
  /** Whether a text other than the default is saved. */
  readonly customised: boolean;
  /** The saved text, or the default while none is saved. */
  readonly text: string;
  /** What is wrong with the saved text, such as a variable a release removed. */
  readonly problems: readonly PromptTextProblem[];
  /** The saved text, or the default while the saved one has problems. */
  readonly renderedText: string;
}

export function promptTemplateState(
  template: PromptTemplate,
  saved: PromptTemplateVersion | undefined,
): PromptTemplateState {
  const savedText = saved?.text ?? null;
  const problems = savedText === null ? [] : promptTextProblems(template, savedText);
  return {
    template,
    saved,
    customised: savedText !== null && savedText !== template.text,
    text: savedText ?? template.text,
    problems,
    renderedText: savedText === null || problems.length > 0 ? template.text : savedText,
  };
}
