import type { PromptTextProblem } from "./prompt-text-problems.js";

/** A text the template can't take, with every reason in words and each problem where it is. */
export class PromptTemplateRefused extends Error {
  constructor(
    readonly reasons: readonly string[],
    readonly problems: readonly PromptTextProblem[] = [],
  ) {
    super(reasons.join(" "));
    this.name = "PromptTemplateRefused";
  }
}

/** The text's problems as a refusal, each reason saying where its problem is. */
export function refusalOf(problems: readonly PromptTextProblem[]): PromptTemplateRefused {
  return new PromptTemplateRefused(
    problems.map(({ message, line, column }) => `Line ${line}, column ${column}: ${message}`),
    problems,
  );
}
