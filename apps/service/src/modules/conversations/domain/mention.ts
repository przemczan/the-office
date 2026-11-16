import { estimatedTokens, type Brief } from "./brief.js";
import { formAnswerWords, type Decision, type DecisionQuestion } from "./decision.js";
import { userWords } from "./user.js";

/**
 * A record the user mentions in a chat message, by its link or with `@` (spec §2.4): the Agent
 * there is given its record with the message.
 */
export type Mention =
  | { readonly kind: "task"; readonly taskId: string }
  | { readonly kind: "initiative"; readonly initiativeId: string }
  | { readonly kind: "idea"; readonly ideaId: string }
  | { readonly kind: "decision"; readonly decisionId: string };

/** A mentioned record as the session reads it; undefined when The Office has no such record. */
export type MentionedRecord = { readonly mention: Mention; readonly text: string | undefined };

/**
 * The Brief of a session that starts on the user's message, with the record of each Task,
 * Initiative, Idea or Decision the message mentions, read now, so the Agent works from the record as it stands.
 */
export function briefWithMentionedRecords(
  brief: Brief,
  records: readonly MentionedRecord[],
): Brief {
  if (records.length === 0) return brief;
  const text = withMentionedRecords(brief.text, records);
  return { text, tokens: estimatedTokens(text) };
}

/**
 * What a running or resumed session is given for the user's message, which no Brief comes with: the
 * message as written, then the records it mentions.
 */
export function withMentionedRecords(said: string, records: readonly MentionedRecord[]): string {
  if (records.length === 0) return said;
  const texts = records.map(({ mention, text }) => text ?? goneWords(mention));
  return `${said}\n\n## Records the user mentioned\n\n${texts.join("\n\n---\n\n")}`;
}

/**
 * A Decision's record as an Agent reads it when the user mentions it: its context and every
 * question, numbered from 1, a choice's with its options and the recommendation, an open
 * question's with why; where it stands, then the record of the Task it was asked on.
 */
export function decisionRecordText(decision: Decision, taskRecord: string | undefined): string {
  const { context, taskId } = decision;
  const where = taskId === undefined ? ", a call made from a chat," : ` on the Task ${taskId},`;
  const asked =
    decision.kind === "request"
      ? requestLines(decision)
      : [
          ...(context.trim() === "" ? [] : [context, ""]),
          ...decision.questions.flatMap((question, index) => [
            ...(index === 0 ? [] : [""]),
            ...questionLines(question, index),
          ]),
        ];
  return [
    `Decision ${decision.id}${where} asked ${decision.askedAt.toISOString()} by ${decision.roleKey === undefined ? "The Office" : `the person in the Role ${decision.roleKey}`}`,
    "",
    ...asked,
    ...decision.passedOn.map(
      ({ roleKey, reason }) => `Passed on by the person in the Role ${roleKey}: ${reason}`,
    ),
    standing(decision),
    ...(taskId === undefined
      ? []
      : ["", "The Task's record:", "", taskRecord ?? `The Office has no Task ${taskId}.`]),
  ].join("\n");
}

function requestLines({ questions, context }: Decision): string[] {
  const [asked] = questions;
  return [
    `Asked to: ${asked?.question ?? ""}`,
    ...(context.trim() === "" ? [] : ["", context]),
    "",
    `Why: ${asked?.kind === "open" ? (asked.why ?? "") : ""}`,
  ];
}

function questionLines(question: DecisionQuestion, index: number): string[] {
  const heading = `Question ${index + 1}: ${question.question}`;
  if (question.kind === "open") {
    return [
      heading,
      "An open question, answered in their own words.",
      ...(question.why?.trim() ? [`Why: ${question.why}`] : []),
    ];
  }
  const { options, recommendation } = question;
  return [
    heading,
    "Options:",
    ...options.map((option, place) => `${place + 1}. ${option}`),
    `Recommended: ${options[recommendation.option] ?? ""}, because ${recommendation.reason}`,
  ];
}

function standing(decision: Decision): string {
  const { answer, putTo } = decision;
  if (answer) {
    const by = answer.atUsersRequest
      ? `the person in the Role ${answer.atUsersRequest.roleKey}, for ${userWords(answer.atUsersRequest.user)} at their request in the Thread ${answer.atUsersRequest.threadId},`
      : answer.answeredBy === undefined
        ? userWords(answer.user ?? null)
        : `the person in the Role ${answer.answeredBy}`;
    const when = answer.answeredAt.toISOString();
    if (answer.kind === "asked-again") {
      const comment = answer.generalComment?.trim();
      return `Asked again by ${by} on ${when}, answering none of its questions: ${comment ? `General comment: ${comment}` : "they gave no comment."}`;
    }
    const words = formAnswerWords(decision, answer);
    return `Answered by ${by} on ${when}:${words.includes("\n") ? "\n" : " "}${words}`;
  }
  if (decision.closedAt) {
    return `Closed unanswered on ${decision.closedAt.toISOString()}: its Task was dropped.`;
  }
  return putTo === undefined
    ? "Not answered yet: it waits on the user."
    : `Not answered yet: it waits on the person in the Role ${putTo}, in a Consultation.`;
}

function goneWords(mention: Mention): string {
  switch (mention.kind) {
    case "task":
      return `The Office has no Task ${mention.taskId}.`;
    case "initiative":
      return `The Office has no Initiative ${mention.initiativeId}.`;
    case "idea":
      return `The Office has no Idea ${mention.ideaId}.`;
    case "decision":
      return `The Office has no Decision ${mention.decisionId}.`;
  }
}
