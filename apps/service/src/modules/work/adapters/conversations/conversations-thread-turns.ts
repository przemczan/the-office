import { Injectable } from "@nestjs/common";
import { ThreadsAtWork } from "../../../conversations/index.js";
import { ThreadTurns } from "../../ports/thread-turns.js";

/** Whether a Thread has a turn running, as Conversations' ThreadsAtWork tracks it in memory. */
@Injectable()
export class ConversationsThreadTurns extends ThreadTurns {
  constructor(private readonly threads: ThreadsAtWork) {
    super();
  }

  async isTurnRunning(threadId: string): Promise<boolean> {
    return this.threads.isTurnRunning(threadId);
  }
}
