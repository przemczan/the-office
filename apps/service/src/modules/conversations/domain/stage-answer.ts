import { formAnswerWords, isDismissal, isTheOfficesOwn, type Decision } from "./decision.js";

/**
 * A Decision's answer as a Task's Pipeline takes it: the option picked, with the comments as a
 * round's guidance, or words; `answeredBy` the Consultant who gave it, by the key of their Role.
 */
export type StageAnswer = (
  | { readonly kind: "option"; readonly option: number; readonly guidance?: string }
  | { readonly kind: "free-answer"; readonly text: string }
) & { readonly answeredBy?: string };

/**
 * The answer to a Decision opened in a Task's Pipeline, undefined while it waits (spec §2.3). For
 * The Office's own one-choice form: the option picked, its comment and the general comment its
 * guidance; or the answer's words, the comment and the general comment, joined. An Agent's own
 * form, answered or asked again, is given in words, as its session gets them. A dismissal is none:
 * no Pipeline waits on a Decision that can be dismissed, and nothing is there to act on.
 */
export function stageAnswerOf(decision: Decision): StageAnswer | undefined {
  const { answer } = decision;
  if (!answer || isDismissal(answer)) return undefined;
  const answeredBy = answer.answeredBy === undefined ? {} : { answeredBy: answer.answeredBy };
  const [given] = answer.kind === "submitted" ? answer.answers : [];
  // The Office's own forms ask one choice, never a choice of several.
  if (!isTheOfficesOwn(decision) || given === undefined || given.kind === "options") {
    return { kind: "free-answer", text: formAnswerWords(decision, answer), ...answeredBy };
  }
  const generalComment = answer.kind === "submitted" ? answer.generalComment : undefined;
  if (given.kind === "option") {
    const guidance = joined([given.comment, generalComment]);
    return {
      kind: "option",
      option: given.option,
      ...(guidance !== "" && { guidance }),
      ...answeredBy,
    };
  }
  return {
    kind: "free-answer",
    text: joined([given.text, given.comment, generalComment]),
    ...answeredBy,
  };
}

function joined(parts: readonly (string | undefined)[]): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join("\n\n");
}
