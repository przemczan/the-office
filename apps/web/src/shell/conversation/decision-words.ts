import type { Decision, DecisionAnswer } from "@the-office/contracts";

/** The answer in words: the option picked, or what the user wrote. */
export function answerWords(answer: DecisionAnswer, { options }: Decision): string {
  return answer.kind === "option" ? (options[answer.option] ?? "") : answer.text;
}
