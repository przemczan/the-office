import { useQuery } from "@tanstack/react-query";
import type { Attachment, Decision } from "@the-office/contracts";
import type { ReactNode } from "react";
import { roleQueries } from "../../api/people.ts";
import { BugTaskWindowOf } from "./bug-task-card.tsx";
import { DecisionForm } from "./decision-form.tsx";
import {
  useDecisionThread,
  useNamedAttachments,
  type DecisionAnsweringProps,
} from "./decision-parts.tsx";

/**
 * A Decision's details window, Open details (spec 4.1, "Answering in a window is a form"): Large,
 * the questions listed beside the picked one, the context and the Attachments, and Submit and Ask
 * me again in its bar. The draft is the card's, so closing keeps it.
 */
export function DecisionWindow({
  attachments,
  firstQuestion,
  onClose,
  ...answering
}: DecisionAnsweringProps & {
  readonly attachments: readonly Attachment[];
  /** The question it opens at, by its index, such as the one the progress line named. */
  readonly firstQuestion?: number;
  readonly onClose: () => void;
}): ReactNode {
  if (answering.decision.kind === "bug-task") {
    return <BugTaskWindowOf {...answering} onClose={onClose} />;
  }
  return (
    <DecisionForm
      {...answering}
      layout="window"
      attachments={attachments}
      {...(firstQuestion === undefined ? {} : { firstQuestion })}
      onClose={onClose}
    />
  );
}

/** A waiting Decision's window, opened from a Mention of it rather than from its card. */
export function MentionedDecisionWindow({
  decision,
  onClose,
}: {
  readonly decision: Decision;
  readonly onClose: () => void;
}): ReactNode {
  const roles = useQuery(roleQueries.list()).data;
  const { card } = useDecisionThread(decision, roles);
  const attachments = useNamedAttachments(decision);
  if (attachments === undefined) return null;
  return (
    <DecisionWindow decision={decision} {...card} attachments={attachments} onClose={onClose} />
  );
}
