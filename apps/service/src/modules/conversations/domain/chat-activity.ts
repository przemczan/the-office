import type { ThreadState } from "./thread.js";

/** A chat Thread as the record of what the user has seen reads it. */
export interface ChatThreadActivity {
  readonly threadId: string;
  readonly roleKey: string;
  readonly state: ThreadState;
  /** Its newest message's time, or when it started while it has none. */
  readonly lastMovedAt: Date;
  /** The newest message after the last one seen that isn't the user's own; undefined when none. */
  readonly unseenAnswerAt: Date | undefined;
}

/** A Thread whose answer waits for the user. */
export interface AnsweredThread {
  readonly threadId: string;
  readonly at: Date;
}

/** Where a person's chat stands; someone with no Threads has none. */
export interface PersonChatActivity {
  readonly roleKey: string;
  readonly answering: boolean;
  /** The newest answer first. */
  readonly answered: readonly AnsweredThread[];
  readonly lastMovedAt: Date;
}

/** The person has written something the user hasn't seen, and has finished writing. */
export function hasAnswered({ state, unseenAnswerAt }: ChatThreadActivity): boolean {
  return unseenAnswerAt !== undefined && state !== "answering";
}

/** Where each person's chat stands, from all their Threads. */
export function chatActivityOfPeople(
  threads: readonly ChatThreadActivity[],
): readonly PersonChatActivity[] {
  const roleKeys = new Set(threads.map(({ roleKey }) => roleKey));
  return [...roleKeys].map((roleKey) =>
    activityOf(
      roleKey,
      threads.filter((thread) => thread.roleKey === roleKey),
    ),
  );
}

function activityOf(roleKey: string, threads: readonly ChatThreadActivity[]): PersonChatActivity {
  return {
    roleKey,
    answering: threads.some(({ state }) => state === "answering"),
    answered: threads
      .flatMap((thread) => {
        const { threadId, unseenAnswerAt: at } = thread;
        return at && hasAnswered(thread) ? [{ threadId, at }] : [];
      })
      .toSorted((first, second) => second.at.getTime() - first.at.getTime()),
    lastMovedAt: new Date(Math.max(...threads.map(({ lastMovedAt }) => lastMovedAt.getTime()))),
  };
}
