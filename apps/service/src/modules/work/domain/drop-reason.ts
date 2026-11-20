/**
 * Why a Task was Dropped (spec §2.1): Duplicate names the Task it duplicates, Other the user's own
 * words; Won't fix and Can't reproduce take nothing.
 */
export type DropReason =
  | { readonly kind: "wont-fix" }
  | { readonly kind: "duplicate"; readonly taskId: string }
  | { readonly kind: "cant-reproduce" }
  | { readonly kind: "other"; readonly text: string };

export type DropReasonKind = DropReason["kind"];

/** The most an Other reason's words may hold, trimmed. */
export const MAX_DROP_REASON_TEXT = 500;

/** The reason as it is kept: Other's words trimmed, and nothing a kind doesn't take. */
export function keptDropReason(reason: DropReason): DropReason {
  switch (reason.kind) {
    case "duplicate":
      return { kind: "duplicate", taskId: reason.taskId };
    case "other":
      return { kind: "other", text: reason.text.trim() };
    default:
      return { kind: reason.kind };
  }
}

/**
 * Why the reason can't be the Task's: a Duplicate needs a Task other than itself, and Other 1 to
 * 500 characters of words. Empty when it can.
 */
export function dropReasonProblems(taskId: string, reason: DropReason): string[] {
  switch (reason.kind) {
    case "duplicate":
      return reason.taskId === taskId ? ["A Task can't be a duplicate of itself."] : [];
    case "other": {
      const { length } = reason.text.trim();
      return length === 0 || length > MAX_DROP_REASON_TEXT
        ? [`Say why it is dropped in 1 to ${MAX_DROP_REASON_TEXT} characters.`]
        : [];
    }
    default:
      return [];
  }
}
