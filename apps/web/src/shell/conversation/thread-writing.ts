import type { Thread } from "@the-office/contracts";

/**
 * Whether the user can write in the Thread. While the person answers, or a Stage runs, a message
 * lands at the next safe point (barge-in); between Stages The Office sends its messages, so a Stage
 * Thread takes none from the user.
 */
export function takesMessages({ stageThread, state }: Thread): boolean {
  return !stageThread || state === "answering";
}

/** What the composer's empty field says: while the person answers, when the message lands. */
export function writingPlaceholder({ state }: Pick<Thread, "state">, personName: string): string {
  return state === "answering"
    ? `Write to ${personName}… (lands at the next safe point)`
    : `Write to ${personName}…`;
}
