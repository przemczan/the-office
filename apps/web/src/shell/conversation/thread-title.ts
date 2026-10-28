import type { Thread } from "@the-office/contracts";

/**
 * A Thread's title as its home shows it. A chat is with one person; a Task's or an Initiative's
 * Threads may be with several, so each shows with its person, as "Planning · Jan" (spec §9).
 */
export function threadTitle(thread: Thread, personName: string): string {
  // A Consultation's title already names both people.
  if (thread.consultation !== null && thread.title !== null) return thread.title;
  if (thread.home.kind === "chat") return thread.title ?? "New thread";
  return thread.title === null ? `With ${personName}` : `${thread.title} · ${personName}`;
}
