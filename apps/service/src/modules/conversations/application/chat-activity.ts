import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  chatActivityOfPeople,
  hasAnswered,
  type ChatThreadActivity,
  type PersonChatActivity,
} from "../domain/chat-activity.js";
import { ThreadSeen } from "../domain/conversation-events.js";
import { deletionLockOf, type DeletionLock } from "../domain/deletion-lock.js";
import type { Thread } from "../domain/thread.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ChatActivityRepository } from "../ports/chat-activity-repository.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ThreadService } from "./thread-service.js";

/** What a chat Thread's reading adds; a Thread outside a chat takes no part in the record. */
export interface ThreadActivity {
  readonly answered: boolean;
  readonly lastMovedAt: Date;
  /** Why the Thread can't be deleted yet; null when it can be. */
  readonly deletionLock: DeletionLock | null;
}

/**
 * The record of what the user has seen in their chats (spec §2.4), which says who has answered.
 * It holds across browsers, so the web reports each message it shows.
 */
@Injectable()
export class ChatActivity {
  constructor(
    private readonly repository: ChatActivityRepository,
    private readonly threads: ThreadService,
    private readonly threadRepository: ThreadRepository,
    private readonly events: EventBus,
  ) {}

  /** Where each person's chat stands; nobody with no Threads. */
  async ofPeople(): Promise<readonly PersonChatActivity[]> {
    return chatActivityOfPeople(await this.repository.chatThreads());
  }

  /** Undefined for a Thread outside a chat. */
  async inThread(thread: Thread): Promise<ThreadActivity | undefined> {
    if (thread.home.kind !== "chat") return undefined;
    const [read, locks] = await Promise.all([
      this.repository.chatThread(thread.id),
      this.deletionLocksOf([thread]),
    ]);
    return read && activityOf(read, locks.get(thread.id) ?? null);
  }

  /** `inThread` for each of a list's Threads in a chat, by its id, in one read. */
  async inThreads(threads: readonly Thread[]): Promise<ReadonlyMap<string, ThreadActivity>> {
    const inChats = threads.filter(({ home }) => home.kind === "chat");
    const [read, locks] = await Promise.all([
      this.repository.chatThreadsAmong(inChats.map(({ id }) => id)),
      this.deletionLocksOf(inChats),
    ]);
    return new Map(
      read.map((thread) => [
        thread.threadId,
        activityOf(thread, locks.get(thread.threadId) ?? null),
      ]),
    );
  }

  /**
   * Why each Thread among `threads` can't be deleted yet, by its id; a Thread that can be, or isn't
   * in a chat, has none listed. The Decisions its Consultations answer are read in one read.
   */
  async deletionLocksOf(threads: readonly Thread[]): Promise<ReadonlyMap<string, DeletionLock>> {
    const inChats = threads.filter(({ home }) => home.kind === "chat");
    const asked = await this.threadRepository.decisionsWithIds(
      inChats.flatMap(({ consultation }) => (consultation ? [consultation.decisionId] : [])),
    );
    const locks = new Map<string, DeletionLock>();
    for (const thread of inChats) {
      const askedOf = asked.find(({ id }) => id === thread.consultation?.decisionId);
      const lock = deletionLockOf(thread, askedOf);
      if (lock) locks.set(thread.id, lock);
    }
    return locks;
  }

  /**
   * The user has seen the chat Thread up to the message: by its id rather than "now", so an answer
   * landing meanwhile stays unseen.
   */
  async markSeen(threadId: string, messageId: string): Promise<Thread> {
    const thread = await this.threads.read(threadId);
    if (thread.home.kind !== "chat") {
      throw new ThreadRefused(["Only a chat's Threads keep what you have seen."]);
    }
    const seenAt = new Date();
    const mark = await this.repository.markSeen(threadId, messageId, seenAt);
    if (mark === "no-such-message") {
      throw new ThreadRefused(["That message isn't in this Thread."]);
    }
    if (mark === "moved") await this.events.publish(new ThreadSeen(thread, seenAt));
    return thread;
  }
}

function activityOf(thread: ChatThreadActivity, deletionLock: DeletionLock | null): ThreadActivity {
  return { answered: hasAnswered(thread), lastMovedAt: thread.lastMovedAt, deletionLock };
}
