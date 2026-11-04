import type { Attachment, Decision, DecisionAnswer } from "@the-office/contracts";

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
