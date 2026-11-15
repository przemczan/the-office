import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  chatActivityOfPeople,
  hasAnswered,
  type ChatThreadActivity,
  type PersonChatActivity,
} from "../domain/chat-activity.js";
import { ThreadSeen } from "../domain/conversation-events.js";
import type { Thread } from "../domain/thread.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ChatActivityRepository } from "../ports/chat-activity-repository.js";
import { ThreadService } from "./thread-service.js";

/** What a chat Thread's reading adds; a Thread outside a chat takes no part in the record. */
export interface ThreadActivity {
  readonly answered: boolean;
  readonly lastMovedAt: Date;
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
    private readonly events: EventBus,
  ) {}

  /** Where each person's chat stands; nobody with no Threads. */
  async ofPeople(): Promise<readonly PersonChatActivity[]> {
    return chatActivityOfPeople(await this.repository.chatThreads());
  }

  /** Undefined for a Thread outside a chat. */
  async inThread({ id, home }: Thread): Promise<ThreadActivity | undefined> {
    if (home.kind !== "chat") return undefined;
    const thread = await this.repository.chatThread(id);
    return thread && activityOf(thread);
  }

  /** `inThread` for each of a list's Threads in a chat, by its id, in one read. */
  async inThreads(threads: readonly Thread[]): Promise<ReadonlyMap<string, ThreadActivity>> {
    const inChats = threads.filter(({ home }) => home.kind === "chat").map(({ id }) => id);
    const read = await this.repository.chatThreadsAmong(inChats);
    return new Map(read.map((thread) => [thread.threadId, activityOf(thread)]));
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

function activityOf(thread: ChatThreadActivity): ThreadActivity {
  return { answered: hasAnswered(thread), lastMovedAt: thread.lastMovedAt };
}
