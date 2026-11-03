import type { Attachment, StageRun, TaskStage } from "@the-office/contracts";

/**
 * A batch of a Task's Attachments: a round is the work between one Gate send-back and the next, so
 * each batch the user reviewed stays together. What was added before any Stage ran is a group of
 * its own.
 */
export type AttachmentRound =
  | { readonly kind: "before-work"; readonly attachments: readonly Attachment[] }
  | {
      readonly kind: "round";
      /** From 1. */
      readonly number: number;
      /** The feedback of the send-back that started it; null for the first. */
      readonly sentBackWith: string | null;
      readonly attachments: readonly Attachment[];
    };

/**
 * The Attachments by round, oldest first, each in the order they were added. Every round is
 * listed, an empty one too, so the last is always the current one; "before the work started" only
 * when something was added then.
 */
export function attachmentRounds(
  attachments: readonly Attachment[],
  taskStages: readonly TaskStage[],
): AttachmentRound[] {
  const runs = taskStages.flatMap((taskStage) => taskStage.runs);
  // Before any run, everything belongs to the first round.
  const workStartedAt =
    runs.length === 0 ? -Infinity : Math.min(...runs.map(({ startedAt }) => Date.parse(startedAt)));
  const sendBacks = runs.flatMap(sendBackOf).toSorted((a, b) => a.endedAt - b.endedAt);
  const inOrder = attachments.toSorted((a, b) => Date.parse(a.addedAt) - Date.parse(b.addedAt));
  const beforeWork = inOrder.filter(({ addedAt }) => Date.parse(addedAt) < workStartedAt);
  const rounds = [...sendBacks, undefined].map((closedBy, index): AttachmentRound => {
    const startedBy = sendBacks[index - 1];
    const from = Math.max(workStartedAt, startedBy?.endedAt ?? -Infinity);
    const until = closedBy?.endedAt ?? Infinity;
    return {
      kind: "round",
      number: index + 1,
      sentBackWith: startedBy?.feedback ?? null,
      attachments: inOrder.filter(({ addedAt }) => {
        const time = Date.parse(addedAt);
        // The first round takes what was added as the work started; a later one starts just after
        // the send-back that closed the one before.
        return (startedBy ? time > from : time >= from) && time <= until;
      }),
    };
  });
  return beforeWork.length > 0
    ? [{ kind: "before-work", attachments: beforeWork }, ...rounds]
    : rounds;
}

/** Attachments that have no rounds, as an Idea's or an Initiative's: all in one. */
export function oneRound(attachments: readonly Attachment[]): AttachmentRound[] {
  return [{ kind: "round", number: 1, sentBackWith: null, attachments }];
}

/** "Round 2", or "Before the work started". */
export function roundName(round: AttachmentRound): string {
  return round.kind === "round" ? `Round ${round.number}` : "Before the work started";
}

interface SendBack {
  /** In milliseconds since the epoch. */
  readonly endedAt: number;
  readonly feedback: string;
}

function sendBackOf({ gateAction, endedAt }: StageRun): SendBack[] {
  return gateAction?.kind === "send-back" && endedAt !== null
    ? [{ endedAt: Date.parse(endedAt), feedback: gateAction.feedback }]
    : [];
}
