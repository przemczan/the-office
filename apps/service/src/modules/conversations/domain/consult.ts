import type { DecisionDraft } from "./decision.js";

/**
 * The answers to a request for approval of a call past a Hard switch (spec §6). There is never an
 * "always": widening what a Role may do is a change to its Role card.
 */
export const APPROVAL_OPTIONS = ["Allow once", "Deny"] as const;

/** What an Agent asks the person it consults: a question, or approval of a call. */
export type Consult =
  | {
      readonly kind: "question";
      /**
       * Whom the Agent would consult, as its brief names them, such as Devops; undefined when it
       * asks the user, as a Hard switch set to Ask me says.
       */
      readonly person?: string;
      readonly question: string;
      readonly context: string;
      readonly options: readonly string[];
      /** The recommended option, by its index in `options`. */
      readonly recommended: number;
      readonly why: string;
    }
  | {
      readonly kind: "approval";
      readonly person?: string;
      /** The call the Agent asks to make, as the user reads it. */
      readonly call: string;
      readonly context: string;
      /** Why the Agent needs the call. */
      readonly why: string;
    };

/**
 * The Decision a consult opens for the user, naming whom the Agent would have consulted, if anyone
 * (the user is asked directly for a Hard switch set to Ask me). Spec §6:
 * a missing person falls back to the user, and in tier 1 nobody is consulted on a Task but the
 * user, so every consult is theirs to answer.
 */
export function consultDecision(consult: Consult): DecisionDraft {
  const person = consult.person?.trim();
  const context = person
    ? `For ${person}: The Office has no Consultations yet, so you answer in their place.\n\n${consult.context}`
    : consult.context;
  if (consult.kind === "question") {
    return {
      question: consult.question,
      context,
      options: consult.options,
      recommendation: { option: consult.recommended, reason: consult.why },
    };
  }
  return {
    question: `Allow this call? ${consult.call}`,
    context,
    options: APPROVAL_OPTIONS,
    recommendation: { option: 0, reason: consult.why },
  };
}
