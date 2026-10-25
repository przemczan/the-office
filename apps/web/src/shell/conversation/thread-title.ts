import type { Thread } from "@the-office/contracts";

/**
 * A Thread's title as its home shows it. A chat is with one person; a Task's Threads are with
 * several, so each shows with its person, as "Planning · Jan" (spec §9).
 */
export function threadTitle(thread: Thread, personName: string): string {
  if (thread.home.kind === "chat") return thread.title ?? "New thread";
  return thread.title === null ? `With ${personName}` : `${thread.title} · ${personName}`;
}
