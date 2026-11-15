import type { ChatThreadActivity } from "../domain/chat-activity.js";

/** Whether marking a message seen moved the record, or why it didn't. */
export type SeenMark = "moved" | "stayed" | "no-such-message";

/** Where the last message the user has seen in each chat Thread is kept (spec §2.4). */
export abstract class ChatActivityRepository {
  /**
   * Records the Thread as seen up to the message. The record only moves forward, so a tab reporting
   * late leaves it "stayed" and an older message never brings an answer back.
   */
  abstract markSeen(threadId: string, messageId: string, seenAt: Date): Promise<SeenMark>;

  /** Every chat Thread, as the record reads it. */
  abstract chatThreads(): Promise<readonly ChatThreadActivity[]>;

  /** The chat Thread, as the record reads it; undefined for any other Thread. */
  abstract chatThread(threadId: string): Promise<ChatThreadActivity | undefined>;

  /** Those of the Threads in a chat, as the record reads them, in one read. */
  abstract chatThreadsAmong(threadIds: readonly string[]): Promise<readonly ChatThreadActivity[]>;
}
