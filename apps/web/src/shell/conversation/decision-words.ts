import type { Attachment, Decision, DecisionAnswer, UserRef } from "@the-office/contracts";
import { isSignedInUser } from "../use-user-name.ts";

/**
 * Whose request a person answered a Decision at: "at your request" for the signed-in user, or on an
 * answer from before users existed; "at Ann Lee's request" for another user.
 */
export function atUsersRequestWords(
  user: UserRef | null,
  signedInUserId: string | undefined,
): string {
  return user === null || isSignedInUser(user, signedInUserId)
    ? "at your request"
    : `at ${user.name}'s request`;
}

/** The answer in words: the option picked, or what the user wrote. */
export function answerWords(answer: DecisionAnswer, { options }: Decision): string {
  return answer.kind === "option" ? (options[answer.option] ?? "") : answer.text;
}

/**
 * The Attachments a Decision names, in its order. One removed since it opened stays named on the
 * Decision but is no longer among the Task's, so it is left out.
 */
export function namedAttachments(
  { attachmentIds }: Pick<Decision, "attachmentIds">,
  taskAttachments: readonly Attachment[],
): Attachment[] {
  return attachmentIds.flatMap((id) =>
    taskAttachments.filter((attachment) => attachment.id === id),
  );
}

/** What a Decision's details window holds, in short: "2 answers · 5 Attachments". */
export function decisionDetailsWords(
  { options }: Pick<Decision, "options">,
  attachments: readonly Attachment[],
): string {
  return `${counted(options.length, "answer", "answers")} · ${counted(attachments.length, "Attachment", "Attachments")}`;
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
