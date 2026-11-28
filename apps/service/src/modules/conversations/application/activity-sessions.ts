import { Injectable } from "@nestjs/common";
import { activeSessionsOf, type ActiveSession } from "../domain/activity-sessions.js";
import { ChatActivityRepository } from "../ports/chat-activity-repository.js";
import { ThreadRepository } from "../ports/thread-repository.js";

/** The sessions Activity lists (spec §2.14, "Sessions"), read from the busy Threads and the chats. */
@Injectable()
export class ActivitySessions {
  constructor(
    private readonly threads: ThreadRepository,
    private readonly chats: ChatActivityRepository,
  ) {}

  /** The sessions active now for the user: never another user's chat. */
  async sessionsFor(userId: string): Promise<readonly ActiveSession[]> {
    const [busy, chats] = await Promise.all([this.threads.busy(), this.chats.chatThreads()]);
    return activeSessionsOf(busy, chats, userId);
  }
}
