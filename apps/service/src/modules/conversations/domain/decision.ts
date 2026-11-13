import type { Thread } from "./thread.js";
import type { UserRef } from "./user.js";

/** Whether the Decision asks approval of a call, which a Consultant may pass on. */
export function isApproval({ kind }: Pick<Decision, "kind">): boolean {
  return kind === "approval";
}

/** The option an Agent recommends, by its place among the options, and why. */
export interface Recommendation {
  /** Its index in the Decision's options. */
  readonly option: number;
  readonly reason: string;
}

/**
 * What a Decision asks (spec §2.2, §2.4): a question with options, approval of a call past a Hard
 * switch, or a request, a call asking someone to do something, answered in their own words.
 */
export type DecisionKind = "question" | "approval" | "request";

/** What the Agent asks, as it opens a Decision. */
export interface DecisionDraft {
  /** A question when left out. */
  readonly kind?: DecisionKind | undefined;
  /** The question; for a request, what the asker asks to be done. */
  readonly question: string;
  /** What the user needs to know to decide, as the Agent found it. */
  readonly context: string;
  /** None for a request, which is answered in words. */
  readonly options: readonly string[];
  /** For a request, `reason` says why the asker needs it, and `option` points at nothing. */
  readonly recommendation: Recommendation;
  /** The Task's Attachments it is about, of any kind, by their ids. */
  readonly attachmentIds?: readonly string[] | undefined;
}

/** How the user answers a Decision: one of its options, or a free answer in their own words. */
export type DecisionAnswer =
  | { readonly kind: "option"; readonly option: number }
  | { readonly kind: "free-answer"; readonly text: string };

/**
 * The person who answered a Decision for the user, when the user asked them to in a Thread of the
 * person's own (spec §2.4): by the key of their Role, the Thread the user asked them in, and the
 * user who wrote the latest message there, as the one who asked.
 */
export interface AtUsersRequest {
  readonly roleKey: string;
  readonly threadId: string;
  /** Null when no user is named: an answer from before users existed, or a Thread with no message. */
  readonly user: UserRef | null;
}

/**
 * Who gave an answer: `user` the user who gave it themselves, `answeredBy` the Consultant who gave
 * it, by the key of their Role; `atUsersRequest` the person who gave the user's answer for them. For
 * a Consultation and the Pipeline's `guidedBy`, an answer at the user's request is the user's own.
 */
export interface AnswerGivenBy {
  /** Set when a user gave it themselves; null on an answer from before users existed. */
  readonly user?: UserRef | null | undefined;
  readonly answeredBy?: string | undefined;
  readonly atUsersRequest?: AtUsersRequest | undefined;
  /**
   * The Office answered a call made from a chat that fell back to the user, which a chat has no
   * Needs you for: the answer tells the caller to ask the user in their reply (spec §2.4).
   */
  readonly byTheOffice?: boolean | undefined;
}

/** An answer given, and when. */
export type GivenAnswer = DecisionAnswer & AnswerGivenBy & { readonly answeredAt: Date };

/**
 * Who answers a Decision: a user themselves, the Consultant it was put to, a person the user asked
 * to answer it for them in a Thread of their own, or The Office.
 */
export type Answerer =
  | { readonly kind: "user"; readonly user: UserRef | null }
  | { readonly kind: "consultant"; readonly roleKey: string; readonly name: string }
  | ({ readonly kind: "at-users-request"; readonly name: string } & AtUsersRequest)
  | { readonly kind: "the-office" };

/** What the answer records of who gave it. */
export function answerGivenBy(answerer: Answerer): AnswerGivenBy {
  switch (answerer.kind) {
    case "user":
      return { user: answerer.user };
    case "consultant":
      return { answeredBy: answerer.roleKey };
    case "at-users-request":
      return {
        atUsersRequest: {
          roleKey: answerer.roleKey,
          threadId: answerer.threadId,
          user: answerer.user,
        },
      };
    case "the-office":
      return { byTheOffice: true };
  }
}

/** A Consultant asked to approve who passed the Decision on, by the key of their Role, and why. */
export interface PassedOn {
  readonly roleKey: string;
  readonly reason: string;
  readonly passedOnAt: Date;
}

/**
 * A question an Agent puts to the user and waits on (spec §2.4), shown as a card in the Thread it
 * works in on a Task, or a call put to a person from a chat. Follow-ups are ordinary messages in
 * that Thread; the answer goes into the asking session as its next message.
 */
export interface Decision extends DecisionDraft {
  readonly kind: DecisionKind;
  readonly id: string;
  readonly threadId: string;
  /** Undefined for a call made from a chat, which is on no Task. */
  readonly taskId: string | undefined;
  /**
   * Who asked, by the key of the Role they fill; undefined when The Office asked, as when a Stage
   * fails with no retries left (spec §2.3).
   */
  readonly roleKey: string | undefined;
  readonly askedAt: Date;
  readonly attachmentIds: readonly string[];
  /**
   * The Consultant it waits on, by the key of their Role: they answer it in a Consultation, and
   * the user may answer it in their place. Undefined while it waits on the user.
   */
  readonly putTo?: string | undefined;
  /** The Consultants who passed it on, the first one first (spec §2.2). */
  readonly passedOn: readonly PassedOn[];
  /** Undefined while it waits on the user or the Consultant. */
  readonly answer: GivenAnswer | undefined;
}

/** A Decision on a Task: every one but a call made from a chat. */
export type DecisionOnTask = Decision & { readonly taskId: string };

export function isOnTask(decision: Decision): decision is DecisionOnTask {
  return decision.taskId !== undefined;
}

/** Every problem with what the Agent asks, in words it can act on. */
export function decisionProblems(draft: DecisionDraft): string[] {
  return draft.kind === "request" ? requestProblems(draft) : questionProblems(draft);
}

function requestProblems({ question, options, recommendation }: DecisionDraft): string[] {
  const problems: string[] = [];
  if (question.trim() === "") problems.push("Say what you ask them to do.");
  if (options.length > 0) {
    problems.push("A request has no options: they answer in their own words.");
  }
  if (recommendation.reason.trim() === "") problems.push("Say why you need it.");
  return problems;
}

function questionProblems({ question, options, recommendation }: DecisionDraft): string[] {
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

/** What's wrong with the Attachments a Decision names, given those its Task has. */
export function attachmentProblems(
  named: readonly string[],
  ofTheTask: readonly string[],
): string[] {
  const others = named.filter((id) => !ofTheTask.includes(id));
  return others.length === 0
    ? []
    : [
        `A Decision names Attachments of its own Task only, and these aren't: ${others.join(", ")}.`,
      ];
}

/** Every problem with the user's answer to an open Decision, in the UI's words. */
export function answerProblems(decision: Decision, answer: DecisionAnswer): string[] {
  if (answer.kind === "free-answer") {
    return answer.text.trim() === "" ? ["Write your answer first."] : [];
  }
  if (decision.kind === "request") {
    return ["A request has no options: answer in your own words, saying what you did or why not."];
  }
  return Number.isInteger(answer.option) && decision.options[answer.option] !== undefined
    ? []
    : ["Choose one of the Decision's options."];
}

/**
 * What keeps a person from answering the Decision for the user from their Thread `caller`, in words
 * their Agent can act on: only a Thread the user talks to them in asks it, not a Stage Thread or a
 * Consultation; one put to a Consultant is theirs to answer, an approval of a call past a Hard
 * switch or of an MCP tool is the user's own click (spec §6), and one in the person's own Thread
 * the user answers on its card.
 */
export function answerForUserProblems(decision: Decision, caller: Thread): string[] {
  if (caller.stageThread || caller.consultation) {
    return ["Only in a Thread the user talks to you in can you answer a Decision for them."];
  }
  if (decision.answer) return ["This Decision is answered already."];
  if (decision.putTo !== undefined) {
    return [
      `This Decision is put to the person in the Role ${decision.putTo}, who answers it in a Consultation; only a Decision waiting on the user can be answered for them.`,
    ];
  }
  if (isApproval(decision)) {
    return [
      "This Decision asks the user's approval of a call: only the user gives it, on its card. Tell them where it waits.",
    ];
  }
  if (decision.threadId === caller.id) {
    return [
      "This Decision is open in your own Thread: the user answers it on its card here, not through you.",
    ];
  }
  return [];
}

/** The answer in words: the chosen option's, or the user's own. */
export function answerWords(decision: Decision, answer: DecisionAnswer): string {
  return answer.kind === "option" ? (decision.options[answer.option] ?? "") : answer.text.trim();
}
