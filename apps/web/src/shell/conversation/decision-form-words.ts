import type {
  Decision,
  DecisionFormAnswer,
  DecisionQuestion,
  QuestionAnswer,
} from "@the-office/contracts";

/**
 * What the user picked and wrote on one question of a Decision's form, before it is sent. A choice
 * holds its option, or none, when its comment alone answers it in words; a choice of several holds
 * its checked options, or none, when its comment alone answers it in words; an open question holds
 * its words. Each has its comment.
 */
export interface QuestionDraft {
  /** A choice's picked option; null on the other kinds. */
  readonly option: number | null;
  /** A choice of several's checked options, ascending; empty on the other kinds. */
  readonly options: readonly number[];
  readonly words: string;
  readonly comment: string;
}

/** A Decision's form as the user fills it in: each question's draft in order, and the general comment. */
export interface DecisionDraft {
  readonly questions: readonly QuestionDraft[];
  readonly generalComment: string;
}

/** Past this many questions, or with any Attachment, a form shows as the compact card. */
export const COMPACT_QUESTIONS = 3;

/** In the feed of Now and the Needs you panel, from this many questions a form is the compact card. */
export const FEED_COMPACT_QUESTIONS = 2;

/** The Decision in one line (spec §2.2): its first question, and how many more it asks. */
export function decisionSummary({
  questions,
  bugTask,
}: Pick<Decision, "questions"> & Partial<Pick<Decision, "bugTask">>): string {
  if (bugTask) return `Bug Task: ${bugTask.title}`;
  const first = questions[0]?.question ?? "";
  const more = questions.length - 1;
  if (more <= 0) return first;
  return `${first} (and ${more} more question${more === 1 ? "" : "s"})`;
}

/**
 * A fresh draft: every choice's recommended option picked, every choice of several's recommended
 * options checked, nothing written.
 */
export function initialDraft({ questions }: Pick<Decision, "questions">): DecisionDraft {
  return {
    questions: questions.map((question) => ({
      option: question.kind === "choice" ? question.recommendation.option : null,
      options:
        question.kind === "choice-of-several" ? ascending(question.recommendation.options) : [],
      words: "",
      comment: "",
    })),
    generalComment: "",
  };
}

/**
 * Whether the question has an answer: a choice an option, a choice of several one checked option or
 * more, or with none picked its comment, which is then its answer in words; an open question its
 * words.
 */
export function isAnswered(question: DecisionQuestion, draft: QuestionDraft | undefined): boolean {
  if (draft === undefined) return false;
  switch (question.kind) {
    case "choice":
      return draft.option !== null || hasWords(draft.comment);
    case "choice-of-several":
      return draft.options.length > 0 || hasWords(draft.comment);
    case "open":
      return hasWords(draft.words);
  }
}

/** Whether the question is answered in words now: a choice with none of its options picked. */
export function inWords(question: DecisionQuestion, draft: QuestionDraft): boolean {
  switch (question.kind) {
    case "choice":
      return draft.option === null;
    case "choice-of-several":
      return draft.options.length === 0;
    case "open":
      return false;
  }
}

/** The first question still without an answer, by its index; undefined when every one has one. */
export function missingAnswer(
  { questions }: Pick<Decision, "questions">,
  draft: DecisionDraft,
): number | undefined {
  const index = questions.findIndex((question, at) => !isAnswered(question, draft.questions[at]));
  return index === -1 ? undefined : index;
}

/** Why Submit is disabled, naming the question missing its answer; undefined when it can be sent. */
export function submitBlockedWords(
  decision: Pick<Decision, "questions">,
  draft: DecisionDraft,
): string | undefined {
  const index = missingAnswer(decision, draft);
  if (index === undefined) return undefined;
  const question = decision.questions[index]!;
  const choice = question.kind !== "open";
  if (decision.questions.length === 1) {
    return choice ? "Pick an option or write your answer first." : "Write your answer first.";
  }
  // A choice lacks an answer only once "None of these" is picked, a choice of several once no box
  // is checked, which asks for its words.
  return choice
    ? `Answer question ${index + 1} in its words first.`
    : `Answer question ${index + 1} first.`;
}

/** How many questions have an answer: an untouched recommendation counts. */
export function answeredCount(
  { questions }: Pick<Decision, "questions">,
  draft: DecisionDraft,
): number {
  return questions.filter((question, index) => isAnswered(question, draft.questions[index])).length;
}

/** The progress line: "5 of 8 answered". */
export function progressWords(decision: Pick<Decision, "questions">, draft: DecisionDraft): string {
  return `${answeredCount(decision, draft)} of ${decision.questions.length} answered`;
}

/**
 * Whether every question is a choice or a choice of several, so Accept can send every recommended
 * option.
 */
export function allChoices({ questions }: Pick<Decision, "questions">): boolean {
  return questions.every((question) => question.kind !== "open");
}

/**
 * Whether the form shows as the compact card: any Attachment, or in the feed of Now and the Needs
 * you panel 2 questions or more, elsewhere more than 3.
 */
export function isCompact(
  { questions, attachmentIds }: Pick<Decision, "questions" | "attachmentIds">,
  where: "feed" | "elsewhere" = "elsewhere",
): boolean {
  if (attachmentIds.length > 0) return true;
  return where === "feed"
    ? questions.length >= FEED_COMPACT_QUESTIONS
    : questions.length > COMPACT_QUESTIONS;
}

/**
 * Whether the user can dismiss the Decision, closing it unanswered: an open form or request a
 * person asked the user in their own Thread. Never an approval, The Office's own, one in a Stage
 * Thread, one put to a Consultant, or one already answered or closed.
 */
export function canBeDismissed(
  decision: Pick<
    Decision,
    "kind" | "roleKey" | "inStageThread" | "putTo" | "formAnswer" | "closedAt"
  >,
): boolean {
  return (
    decision.kind !== "approval" &&
    decision.roleKey !== null &&
    !decision.inStageThread &&
    decision.putTo === null &&
    decision.formAnswer === null &&
    decision.closedAt === null
  );
}

/** How many questions the draft changed from the fresh one, the general comment counting as one. */
export function draftChanges(decision: Pick<Decision, "questions">, draft: DecisionDraft): number {
  const fresh = initialDraft(decision);
  const changed = fresh.questions.filter((question, index) => {
    const given = draft.questions[index];
    return (
      given !== undefined &&
      (given.option !== question.option ||
        !sameOptions(given.options, question.options) ||
        hasWords(given.words) ||
        hasWords(given.comment))
    );
  }).length;
  return changed + (hasWords(draft.generalComment) ? 1 : 0);
}

/** The compact card's badge once the draft differs from the recommendations: "Draft kept · 2 changes". */
export function draftKeptWords(changes: number): string {
  return `Draft kept · ${changes} change${changes === 1 ? "" : "s"}`;
}

/** The compact card's line under question 1: "7 more questions, 3 of them open questions". */
export function moreQuestionsWords({ questions }: Pick<Decision, "questions">): string | undefined {
  const more = questions.length - 1;
  if (more <= 0) return undefined;
  const open = questions.slice(1).filter((question) => question.kind === "open").length;
  const asked = `${more} more question${more === 1 ? "" : "s"}`;
  return open === 0 ? asked : `${asked}, ${open} of them open question${open === 1 ? "" : "s"}`;
}

/**
 * One question's answer so far, as the window's list shows it: "IndexedDB (recommended)", "In
 * words: …", or what it still needs.
 */
export function draftAnswerWords(question: DecisionQuestion, draft: QuestionDraft): string {
  if (question.kind === "open") {
    const words = draft.words.trim();
    return words ? words : "Needs an answer";
  }
  if (question.kind === "choice" && draft.option !== null) {
    const option = question.options[draft.option] ?? "";
    return question.recommendation.option === draft.option ? `${option} (recommended)` : option;
  }
  if (question.kind === "choice-of-several" && draft.options.length > 0) {
    return severalPicks(question, draft.options)
      .map(({ option, recommended }) => (recommended ? `${option} (recommended)` : option))
      .join(", ");
  }
  const words = draft.comment.trim();
  return words ? `In words: ${words}` : "Needs an answer in words";
}

/** A choice of several's picked options, by name, in the options' order, each marked if recommended. */
export function severalPicks(
  question: Extract<DecisionQuestion, { kind: "choice-of-several" }>,
  options: readonly number[],
): { readonly option: string; readonly recommended: boolean }[] {
  return ascending(options).map((at) => ({
    option: question.options[at] ?? "",
    recommended: question.recommendation.options.includes(at),
  }));
}

/**
 * Submit: each question's answer in order with its comment, a choice with no option picked as its
 * comment's words, and the general comment when written. Call it once `missingAnswer` finds none.
 */
export function submittedAnswer(
  { questions }: Pick<Decision, "questions">,
  draft: DecisionDraft,
): DecisionFormAnswer {
  return {
    kind: "submitted",
    answers: questions.map((question, index) =>
      questionAnswer(question, draft.questions[index] ?? emptyQuestionDraft()),
    ),
    ...optionalGeneralComment(draft.generalComment),
  };
}

function questionAnswer(question: DecisionQuestion, draft: QuestionDraft): QuestionAnswer {
  const comment = draft.comment.trim();
  switch (question.kind) {
    case "choice":
      return draft.option === null
        ? { kind: "words", text: comment }
        : { kind: "option", option: draft.option, ...(comment ? { comment } : {}) };
    case "choice-of-several":
      return draft.options.length === 0
        ? { kind: "words", text: comment }
        : { kind: "options", options: ascending(draft.options), ...(comment ? { comment } : {}) };
    case "open":
      return { kind: "words", text: draft.words.trim(), ...(comment ? { comment } : {}) };
  }
}

/** Accept: Submit with every recommended option and no comments. Only when `allChoices`. */
export function acceptAnswer({ questions }: Pick<Decision, "questions">): DecisionFormAnswer {
  return {
    kind: "submitted",
    answers: questions.flatMap((question): QuestionAnswer[] => {
      switch (question.kind) {
        case "choice":
          return [{ kind: "option", option: question.recommendation.option }];
        case "choice-of-several":
          return [{ kind: "options", options: ascending(question.recommendation.options) }];
        case "open":
          return [];
      }
    }),
  };
}

/** Ask me again: the general comment alone, when written. */
export function askedAgainAnswer(generalComment: string): DecisionFormAnswer {
  return { kind: "asked-again", ...optionalGeneralComment(generalComment) };
}

/** Dismiss: the general comment alone, when written; the Decision closes unanswered. */
export function dismissedAnswer(generalComment: string): DecisionFormAnswer {
  return { kind: "dismissed", ...optionalGeneralComment(generalComment) };
}

/** One question of an answered form, as the Thread keeps it. */
export interface AnsweredLine {
  readonly number: number;
  readonly question: string;
  /** The option picked, the options picked joined by ", ", or the words given. */
  readonly answer: string;
  /** The option picked was the recommended one. */
  readonly recommended: boolean;
  /** A choice of several's picked options, each marked if recommended; undefined on the others. */
  readonly picks: readonly { readonly option: string; readonly recommended: boolean }[] | undefined;
  /** Answered in words: an open question, or a choice with no option picked. */
  readonly inWords: boolean;
  readonly comment: string | undefined;
}

/** Each question of a submitted form with its answer and comment, in order. */
export function answeredLines(
  { questions }: Pick<Decision, "questions">,
  answer: Extract<DecisionFormAnswer, { kind: "submitted" }>,
): AnsweredLine[] {
  return questions.flatMap((question, index) => {
    const given = answer.answers[index];
    if (given === undefined) return [];
    const comment = given.comment?.trim();
    return [
      {
        number: index + 1,
        question: question.question,
        answer: questionAnswerWords(question, given),
        recommended:
          given.kind === "option" &&
          question.kind === "choice" &&
          question.recommendation.option === given.option,
        picks:
          given.kind === "options" && question.kind === "choice-of-several"
            ? severalPicks(question, given.options)
            : undefined,
        inWords: given.kind === "words",
        comment: comment ? comment : undefined,
      },
    ];
  });
}

/**
 * The answer in words, as the Thread's answer line shows it: one question's answer alone, with its
 * comment; several, each question with its answer and comment; then the general comment. Asked
 * again or dismissed, the general comment.
 */
export function formAnswerWords(
  decision: Pick<Decision, "questions">,
  answer: DecisionFormAnswer,
): string {
  const general = answer.generalComment?.trim();
  if (answer.kind === "asked-again") {
    return general ? `Asked again: ${general}` : "Asked again, with no comment.";
  }
  if (answer.kind === "dismissed") {
    return general ? `Dismissed: ${general}` : "Dismissed, with no comment.";
  }
  const lines = answeredLines(decision, answer);
  const [only] = lines;
  const body =
    lines.length === 1 && only !== undefined
      ? [only.answer, ...(only.comment ? [`Comment: ${only.comment}`] : [])].join("\n\n")
      : lines
          .map(
            (line) =>
              `${line.number}. ${line.question}: **${line.answer}**${line.comment ? `. ${line.comment}` : ""}`,
          )
          .join("\n");
  return general ? `${body}\n\nGeneral comment: ${general}` : body;
}

function questionAnswerWords(question: DecisionQuestion, answer: QuestionAnswer): string {
  switch (answer.kind) {
    case "words":
      return answer.text.trim();
    case "option":
      // The release before answers a choice of several, which it reads as a choice, with one option.
      return question.kind === "open" ? "" : (question.options[answer.option] ?? "");
    case "options":
      return question.kind === "choice-of-several"
        ? severalPicks(question, answer.options)
            .map(({ option }) => option)
            .join(", ")
        : "";
  }
}

function optionalGeneralComment(generalComment: string): { generalComment?: string } {
  const trimmed = generalComment.trim();
  return trimmed ? { generalComment: trimmed } : {};
}

function emptyQuestionDraft(): QuestionDraft {
  return EMPTY_QUESTION_DRAFT;
}

/** A question's draft before anything is picked or written. */
export const EMPTY_QUESTION_DRAFT: QuestionDraft = {
  option: null,
  options: [],
  words: "",
  comment: "",
};

function ascending(options: readonly number[]): number[] {
  return options.toSorted((a, b) => a - b);
}

function sameOptions(given: readonly number[], fresh: readonly number[]): boolean {
  const sorted = ascending(given);
  return sorted.length === fresh.length && sorted.every((option, at) => option === fresh[at]);
}

function hasWords(text: string): boolean {
  return text.trim() !== "";
}
