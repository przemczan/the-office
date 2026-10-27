import type { Decision, DecisionDraft } from "./decision.js";

/**
 * The answers to a request for approval of a call past a Hard switch (spec §6). There is never an
 * "always": widening what a Role may do is a change to its Role card.
 */
export const APPROVAL_OPTIONS = ["Allow once", "Deny"] as const;

/** The question an approval of `call` is asked with, which a granted approval is found by. */
export function approvalQuestion(call: string): string {
  return `Allow this call? ${call}`;
}

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

/** Whom a consult is put to: a Consultant who answers it, or the user in their place. */
export type ConsultedParty =
  { readonly kind: "consultant"; readonly roleKey: string } | { readonly kind: "user" };

/** A person hired now whose Consultant capability is on. */
export interface ConsultantPerson {
  readonly roleKey: string;
  readonly name: string;
  readonly title: string;
}

/**
 * The Consultant a consult names, found by their Role's key, title or name, however the Agent's
 * brief wrote it. Nobody when it names no one, a person who isn't a Consultant or isn't hired, or
 * the asking person themselves: the consult then falls back to the user (spec §2.2).
 */
export function consultantNamed(
  person: string | undefined,
  consultants: readonly ConsultantPerson[],
  askerRoleKey: string,
): ConsultantPerson | undefined {
  const wanted = person?.trim().toLowerCase();
  if (!wanted) return undefined;
  return consultants.find(
    ({ roleKey, name, title }) =>
      roleKey !== askerRoleKey &&
      [roleKey, title, name].some((candidate) => candidate.toLowerCase() === wanted),
  );
}

/**
 * The Decision a consult opens, naming whom the Agent would have consulted when the user answers in
 * their place (spec §6: a missing person falls back to the user). The Consultant is asked the same
 * question without that line.
 */
export function consultDecision(consult: Consult, party: ConsultedParty): DecisionDraft {
  const person = consult.person?.trim();
  const context =
    person && party.kind === "user"
      ? `For ${person}: nobody who can be consulted fills that Role, so you answer in their place.\n\n${consult.context}`
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
    question: approvalQuestion(consult.call),
    context,
    options: APPROVAL_OPTIONS,
    recommendation: { option: 0, reason: consult.why },
  };
}

/** The title of a Consultation, labelled with both people (spec §2.4). */
export function consultationTitle(askerName: string, consultantName: string): string {
  return `Consultation · ${askerName} and ${consultantName}`;
}

/**
 * What The Office asks the Consultant when their Consultation opens: the Decision as the Agent put
 * it, and how to answer.
 */
export function consultationOpening(decision: Decision, askerName: string): string {
  const options = decision.options
    .map(
      (option, index) =>
        `${index + 1}. ${option}${index === decision.recommendation.option ? " (recommended)" : ""}`,
    )
    .join("\n");
  return [
    `${askerName} asks for your answer on this Task.`,
    `Question: ${decision.question}`,
    `What they found: ${decision.context}`,
    `Their options:\n${options}`,
    `Why they recommend the option they do: ${decision.recommendation.reason}`,
    "Answer with the answer_consultation tool: choose one of the options by its number, or give an answer in your own words. It reaches them as their next message.",
  ].join("\n\n");
}
