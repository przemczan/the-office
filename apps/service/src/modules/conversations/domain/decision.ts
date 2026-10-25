/** The option an Agent recommends, by its place among the options, and why. */
export interface Recommendation {
  /** Its index in the Decision's options. */
  readonly option: number;
  readonly reason: string;
}

/** What the Agent asks, as it opens a Decision. */
export interface DecisionDraft {
  readonly question: string;
  /** What the user needs to know to decide, as the Agent found it. */
  readonly context: string;
  readonly options: readonly string[];
  readonly recommendation: Recommendation;
}

/** How the user answers a Decision: one of its options, or a free answer in their own words. */
export type DecisionAnswer =
  | { readonly kind: "option"; readonly option: number }
  | { readonly kind: "free-answer"; readonly text: string };

/** An answer given, and when. */
export type GivenAnswer = DecisionAnswer & { readonly answeredAt: Date };

/**
 * A question an Agent puts to the user and waits on (spec §2.4), shown as a card in the Thread it
 * works in on a Task. Follow-ups are ordinary messages in that Thread; the answer goes into the
 * asking session as its next message.
 */
export interface Decision extends DecisionDraft {
  readonly id: string;
  readonly threadId: string;
  readonly taskId: string;
  /** Who asked, by the key of the Role they fill. */
  readonly roleKey: string;
  readonly askedAt: Date;
  /** Undefined while it waits on the user. */
  readonly answer: GivenAnswer | undefined;
}

/** Every problem with what the Agent asks, in words it can act on. */
export function decisionProblems({ question, options, recommendation }: DecisionDraft): string[] {
  const problems: string[] = [];
  if (question.trim() === "") problems.push("Write the question.");
  if (options.length < 2) problems.push("Give the user at least two options.");
  if (options.some((option) => option.trim() === "")) problems.push("Name every option.");
  const named = options.map((option) => option.trim().toLowerCase());
  if (new Set(named).size !== named.length) problems.push("Give each option a name of its own.");
  if (!Number.isInteger(recommendation.option) || options[recommendation.option] === undefined) {
    problems.push("Recommend one of the options.");
  }
  if (recommendation.reason.trim() === "") problems.push("Say why you recommend it.");
  return problems;
}

/** Every problem with the user's answer to an open Decision, in the UI's words. */
export function answerProblems(decision: Decision, answer: DecisionAnswer): string[] {
  if (answer.kind === "free-answer") {
    return answer.text.trim() === "" ? ["Write your answer first."] : [];
  }
  return Number.isInteger(answer.option) && decision.options[answer.option] !== undefined
    ? []
    : ["Choose one of the Decision's options."];
}

/** The answer in words: the chosen option's, or the user's own. */
export function answerWords(decision: Decision, answer: DecisionAnswer): string {
  return answer.kind === "option" ? (decision.options[answer.option] ?? "") : answer.text.trim();
}
