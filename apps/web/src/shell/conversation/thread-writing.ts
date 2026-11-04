import type { Thread } from "@the-office/contracts";

/**
 * Whether the user can write in the Thread. While its Stage runs, a Stage Thread takes a message at
 * the next safe point (barge-in); between Stages The Office sends its messages, so it takes none
 * from the user.
 */
export function takesMessages({ stageThread, state }: Thread): boolean {
  return !stageThread || state === "answering";
}
