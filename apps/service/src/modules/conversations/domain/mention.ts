import { estimatedTokens, type Brief } from "./brief.js";
import { answerWords, type Decision } from "./decision.js";

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
 * A Decision's record as an Agent reads it when the user mentions it: the question with its context,
 * options and the recommendation, where it stands, then the record of the Task it was asked on.
 */
export function decisionRecordText(decision: Decision, taskRecord: string | undefined): string {
  const { question, context, options, recommendation } = decision;
  return [
    `Decision ${decision.id} on the Task ${decision.taskId}, asked ${decision.askedAt.toISOString()} by ${decision.roleKey === undefined ? "The Office" : `the person in the Role ${decision.roleKey}`}`,
    "",
    `Question: ${question}`,
    ...(context.trim() === "" ? [] : ["", context]),
    "",
    "Options:",
    ...options.map((option, index) => `${index + 1}. ${option}`),
    "",
    `Recommended: ${options[recommendation.option] ?? ""}, because ${recommendation.reason}`,
    ...decision.passedOn.map(
      ({ roleKey, reason }) => `Passed on by the person in the Role ${roleKey}: ${reason}`,
    ),
    standing(decision),
    "",
    "The Task's record:",
    "",
    taskRecord ?? `The Office has no Task ${decision.taskId}.`,
  ].join("\n");
}

function standing(decision: Decision): string {
  const { answer, putTo } = decision;
  if (answer) {
    const by = answer.atUsersRequest
      ? `the person in the Role ${answer.atUsersRequest.roleKey}, for the user at their request in the Thread ${answer.atUsersRequest.threadId},`
      : answer.answeredBy === undefined
        ? "the user"
        : `the person in the Role ${answer.answeredBy}`;
    return `Answered by ${by} on ${answer.answeredAt.toISOString()}: ${answerWords(decision, answer)}`;
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
