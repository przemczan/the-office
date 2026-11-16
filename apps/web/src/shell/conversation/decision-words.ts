import type { Attachment, Decision, UserRef } from "@the-office/contracts";
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

/** A Decision closed unanswered, as dropping its Task closes it (spec §2.4). */
export const CLOSED_WORDS = "Closed: the Task was dropped.";

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

/** What a Decision's details window holds, in short: "3 questions · 5 Attachments". */
export function decisionDetailsWords(
  { questions }: Pick<Decision, "questions">,
  attachments: readonly Attachment[],
): string {
  const asked = counted(questions.length, "question", "questions");
  return attachments.length === 0
    ? asked
    : `${asked} · ${counted(attachments.length, "Attachment", "Attachments")}`;
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
