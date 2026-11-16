import type { Thread } from "./thread.js";
import type { UserRef } from "./user.js";

/** Whether the Decision asks approval of a call, which a Consultant may pass on. */
export function isApproval({ kind }: Pick<Decision, "kind">): boolean {
  return kind === "approval";
}

/** The option an Agent recommends, by its place among the options, and why. */
export interface Recommendation {
  /** Its index in the question's options. */
  readonly option: number;
  readonly reason: string;
}

/**
 * What a Decision asks (spec §2.2, §2.4): a form of one or more questions, approval of a call past a
 * Hard switch (one choice, Allow once or Deny), or a request, a call asking someone to do something:
 * a form of one open question, answered in their own words.
 */
export type DecisionKind = "form" | "approval" | "request";

/** A question answered by picking one of its options, the Agent's recommended one preselected. */
export interface ChoiceQuestion {
  readonly kind: "choice";
  readonly question: string;
  readonly options: readonly string[];
  readonly recommendation: Recommendation;
}

/** A question answered in words; for a request, `why` says why the asker needs it done. */
export interface OpenQuestion {
  readonly kind: "open";
  /** For a request, what the asker asks to be done. */
  readonly question: string;
  readonly why?: string | undefined;
}

/** One question of a Decision's form (spec §2.4). */
export type DecisionQuestion = ChoiceQuestion | OpenQuestion;

/** What the Agent asks, as it opens a Decision. */
export interface DecisionDraft {
  /** A form when left out. */
  readonly kind?: DecisionKind | undefined;
  /** What the user needs to know to decide, as the Agent found it. */
  readonly context: string;
  /** In the order asked. */
  readonly questions: readonly DecisionQuestion[];
  /** The Task's Attachments it is about, of any kind, by their ids. */
  readonly attachmentIds?: readonly string[] | undefined;
}

/**
 * The answer to one question: an option of a choice, by its index, or words, which answer an open
 * question, or a choice with no option picked (its comment alone). Each takes an optional comment.
 */
export type QuestionAnswer =
  | { readonly kind: "option"; readonly option: number; readonly comment?: string | undefined }
  | { readonly kind: "words"; readonly text: string; readonly comment?: string | undefined };

/**
 * How a Decision is sent (spec §2.4): Submit, with an answer to every question in order and an
 * optional general comment, or Ask me again, with the general comment alone.
 */
export type DecisionAnswer =
  | {
      readonly kind: "submitted";
      readonly answers: readonly QuestionAnswer[];
      readonly generalComment?: string | undefined;
    }
  | { readonly kind: "asked-again"; readonly generalComment?: string | undefined };

/** The answer that picks `option` of a Decision's one choice. */
export function oneOptionAnswer(option: number): DecisionAnswer {
  return { kind: "submitted", answers: [{ kind: "option", option }] };
}

/** The answer in `text` to a Decision's one question. */
export function oneWordsAnswer(text: string): DecisionAnswer {
  return { kind: "submitted", answers: [{ kind: "words", text }] };
}

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
 * A form an Agent puts to the user and waits on (spec §2.4), shown as a card in the Thread it works
 * in on a Task, or a call put to a person from a chat. Follow-ups are ordinary messages in that
 * Thread; the whole answer goes into the asking session as its next message.
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
  /** When it was closed unanswered, as its Task was dropped; undefined otherwise. */
  readonly closedAt?: Date | undefined;
}

/** Why a closed Decision can't be answered, in words for the user and any person alike. */
export const CLOSED_DECISION_REFUSAL = "This Decision was closed: its Task was dropped.";

/** Whether the Decision still waits: neither answered nor closed. */
export function isOpen({ answer, closedAt }: Pick<Decision, "answer" | "closedAt">): boolean {
  return answer === undefined && closedAt === undefined;
}

/** Whether The Office asked it, such as a Stage out of tries: nobody is there to ask again. */
export function isTheOfficesOwn({ roleKey }: Pick<Decision, "roleKey">): boolean {
  return roleKey === undefined;
}

/** A Decision on a Task: every one but a call made from a chat. */
export type DecisionOnTask = Decision & { readonly taskId: string };

export function isOnTask(decision: Decision): decision is DecisionOnTask {
  return decision.taskId !== undefined;
}

/** The form's one choice, when it asks exactly that: an approval, or The Office's own Decisions. */
export function onlyChoice({
  questions,
}: Pick<DecisionDraft, "questions">): ChoiceQuestion | undefined {
  const [first, ...others] = questions;
  return others.length === 0 && first?.kind === "choice" ? first : undefined;
}

/** The Decision in one line (spec §2.2): its first question, and how many more it asks. */
export function decisionSummary({ questions }: Pick<DecisionDraft, "questions">): string {
  const first = questions[0]?.question ?? "";
  const more = questions.length - 1;
  if (more <= 0) return first;
  return `${first} (and ${more} more question${more === 1 ? "" : "s"})`;
}

/** Every problem with what the Agent asks, in words it can act on, naming the question. */
export function decisionProblems(draft: DecisionDraft): string[] {
  return draft.kind === "request" ? requestProblems(draft) : formProblems(draft);
}

function requestProblems({ questions }: DecisionDraft): string[] {
  const [asked, ...others] = questions;
  if (asked === undefined || others.length > 0) return ["A request asks one thing."];
  if (asked.kind === "choice") {
    return ["A request has no options: they answer in their own words."];
  }
  const problems: string[] = [];
  if (asked.question.trim() === "") problems.push("Say what you ask them to do.");
  if ((asked.why ?? "").trim() === "") problems.push("Say why you need it.");
  return problems;
}

function formProblems({ questions }: DecisionDraft): string[] {
  if (questions.length === 0) return ["Ask at least one question."];
  return questions.flatMap((question, index) =>
    questionProblems(question).map((problem) => numbered(questions.length, index, problem)),
  );
}

function questionProblems(question: DecisionQuestion): string[] {
  const problems: string[] = [];
  if (question.question.trim() === "") problems.push("Write the question.");
  if (question.kind === "open") return problems;
  const { options, recommendation } = question;
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

/** A problem with the question at `index`, named when the form asks several. */
function numbered(count: number, index: number, problem: string): string {
  return count > 1 ? `Question ${index + 1}: ${problem}` : problem;
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

/**
 * Every problem with the answer to an open Decision, in the UI's words, naming the question. The
 * Office sending a call made from a chat back to its caller asks again on any Decision, an
 * approval too, its general comment saying why (spec §2.4).
 */
export function answerProblems(
  decision: Decision,
  answer: DecisionAnswer,
  { byTheOffice = false }: Pick<AnswerGivenBy, "byTheOffice"> = {},
): string[] {
  if (decision.closedAt) return [CLOSED_DECISION_REFUSAL];
  if (answer.kind === "asked-again") return byTheOffice ? [] : askAgainProblems(decision);
  if (isApproval(decision)) return approvalAnswerProblems(decision, answer);
  const { questions } = decision;
  if (answer.answers.length !== questions.length) {
    return [
      questions.length === 1
        ? "Answer the question first."
        : `Answer every question: this Decision asks ${questions.length}.`,
    ];
  }
  return questions.flatMap((question, index) =>
    questionAnswerProblems(decision, question, answer.answers[index]!).map((problem) =>
      numbered(questions.length, index, problem),
    ),
  );
}

function askAgainProblems(decision: Decision): string[] {
  if (isApproval(decision)) {
    return ["An approval has no Ask me again: answer Allow once or Deny."];
  }
  if (isTheOfficesOwn(decision)) {
    return ["The Office's own Decisions have no Ask me again: nobody is there to ask again."];
  }
  return [];
}

function approvalAnswerProblems(
  decision: Decision,
  answer: Extract<DecisionAnswer, { kind: "submitted" }>,
): string[] {
  const [given, ...others] = answer.answers;
  const choice = onlyChoice(decision);
  if (
    given?.kind !== "option" ||
    others.length > 0 ||
    choice?.options[given.option] === undefined
  ) {
    return ["Choose Allow once or Deny."];
  }
  if (isCommented(given.comment) || isCommented(answer.generalComment)) {
    return ["An approval takes no comments: choose Allow once or Deny."];
  }
  return [];
}

/** Whether a comment says anything: a form's empty comment box gives none. */
function isCommented(comment: string | undefined): boolean {
  return (comment ?? "").trim() !== "";
}

function questionAnswerProblems(
  decision: Decision,
  question: DecisionQuestion,
  answer: QuestionAnswer,
): string[] {
  if (answer.kind === "words") {
    return answer.text.trim() === "" ? ["Write your answer first."] : [];
  }
  if (question.kind === "open") {
    return decision.kind === "request"
      ? ["A request has no options: answer in your own words, saying what you did or why not."]
      : ["It is an open question: answer in your own words."];
  }
  return Number.isInteger(answer.option) && question.options[answer.option] !== undefined
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
  if (decision.closedAt) return [CLOSED_DECISION_REFUSAL];
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

/** The answer to one question in words: the option picked, or the words given. */
export function questionAnswerWords(question: DecisionQuestion, answer: QuestionAnswer): string {
  if (answer.kind === "words") return answer.text.trim();
  return question.kind === "choice" ? (question.options[answer.option] ?? "") : "";
}

/**
 * The whole answer in words, as the asking session, Consultations, briefs and the Threads' history
 * give it: each question in order with its answer and comment, then the general comment; asked
 * again, the general comment alone. An approval's is the option picked.
 */
export function formAnswerWords(
  decision: Pick<Decision, "kind" | "questions">,
  answer: DecisionAnswer,
): string {
  if (answer.kind === "asked-again") {
    const comment = answer.generalComment?.trim();
    return comment ? `Asked again: ${comment}` : "Asked again, with no comment.";
  }
  const [first] = decision.questions;
  if (isApproval(decision) && first !== undefined && answer.answers[0] !== undefined) {
    return questionAnswerWords(first, answer.answers[0]);
  }
  const lines = decision.questions.map((question, index) =>
    questionWithAnswer(index, question, answer.answers[index]),
  );
  const general = answer.generalComment?.trim();
  return [lines.join("\n"), ...(general ? [`General comment: ${general}`] : [])].join("\n\n");
}

function questionWithAnswer(
  index: number,
  question: DecisionQuestion,
  answer: QuestionAnswer | undefined,
): string {
  const lines = [`${index + 1}. ${question.question}`];
  if (answer !== undefined) {
    const words = questionAnswerWords(question, answer);
    lines.push(
      answer.kind === "option" ? `   Answer: ${words}` : `   Answer, in their own words: ${words}`,
    );
    const comment = answer.comment?.trim();
    if (comment) lines.push(`   Comment: ${comment}`);
  }
  return lines.join("\n");
}

/**
 * The Decision as one question, as it was stored and given before the form (the previous release
 * reads it): its first question, a choice's options and recommendation, and an open question's why
 * as the recommendation's reason.
 */
export interface OneQuestionView {
  readonly question: string;
  readonly options: readonly string[];
  readonly recommendation: Recommendation;
}

export function oneQuestionView({ questions }: Pick<DecisionDraft, "questions">): OneQuestionView {
  const first = questions[0];
  if (first === undefined) return { question: "", options: [], recommendation: NO_RECOMMENDATION };
  return first.kind === "choice"
    ? { question: first.question, options: first.options, recommendation: first.recommendation }
    : {
        question: first.question,
        options: [],
        recommendation: { option: 0, reason: first.why ?? "" },
      };
}

const NO_RECOMMENDATION: Recommendation = { option: 0, reason: "" };

/** The kind a Decision recorded before the form read as: a question, now a form. */
export type OneQuestionKind = "question" | "approval" | "request";

/** A Decision recorded before the form, as a form of one question (spec §2.4). */
export function formFromOne(
  kind: OneQuestionKind,
  { question, options, recommendation }: OneQuestionView,
): { readonly kind: DecisionKind; readonly questions: readonly DecisionQuestion[] } {
  if (kind === "request") {
    return { kind, questions: [{ kind: "open", question, why: recommendation.reason }] };
  }
  const asked: DecisionQuestion =
    options.length === 0
      ? { kind: "open", question }
      : { kind: "choice", question, options, recommendation };
  return { kind: kind === "question" ? "form" : kind, questions: [asked] };
}

/** The kind as recorded before the form, which the previous release reads. */
export function oneQuestionKind(kind: DecisionKind): OneQuestionKind {
  return kind === "form" ? "question" : kind;
}

/** An answer as given before the form: an option, by its index, or words. */
export type OneQuestionAnswer =
  | { readonly kind: "option"; readonly option: number }
  | { readonly kind: "free-answer"; readonly text: string };

/**
 * The answer as one, for the previous release to read: a one-question form's option or words, and
 * any other answer in words, asked again as its general comment.
 */
export function oneAnswerView(
  decision: Pick<Decision, "kind" | "questions">,
  answer: DecisionAnswer,
): OneQuestionAnswer {
  if (answer.kind === "asked-again") {
    return { kind: "free-answer", text: answer.generalComment?.trim() ?? "" };
  }
  const [given, ...others] = answer.answers;
  if (given !== undefined && others.length === 0 && !isCommented(answer.generalComment)) {
    if (given.kind === "option" && !isCommented(given.comment)) {
      return { kind: "option", option: given.option };
    }
    if (given.kind === "words" && !isCommented(given.comment)) {
      return { kind: "free-answer", text: given.text };
    }
  }
  return { kind: "free-answer", text: formAnswerWords(decision, answer) };
}

/** An answer given before the form, as the form's answer to its one question. */
export function formAnswerFromOne(answer: OneQuestionAnswer): DecisionAnswer {
  return answer.kind === "option" ? oneOptionAnswer(answer.option) : oneWordsAnswer(answer.text);
}
