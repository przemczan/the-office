import { Injectable } from "@nestjs/common";
import { ThreadService } from "../../../conversations/index.js";
import { ThreadTurns } from "../../ports/thread-turns.js";

/** Whether a Thread has a turn running, as Conversations' ThreadService tracks it in memory. */
@Injectable()
export class ConversationsThreadTurns extends ThreadTurns {
  constructor(private readonly threads: ThreadService) {
    super();
  }

  async isTurnRunning(threadId: string): Promise<boolean> {
    return this.threads.isTurnRunning(threadId);
  }
}
