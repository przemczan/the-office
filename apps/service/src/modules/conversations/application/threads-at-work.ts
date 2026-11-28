import { Injectable } from "@nestjs/common";
import { worksIn } from "../domain/people-working.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ThreadRunner } from "./thread-runner.js";

/** Which Threads' people are working now: the sessions System health counts, and turns running. */
@Injectable()
export class ThreadsAtWork {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly runner: ThreadRunner,
  ) {}

  /**
   * How many engine sessions are working now, in Stages, chats and Threads: each Thread answering
   * whose person works in it, as the Live view counts them (`worksIn`), so a Stage Thread waiting
   * on its Decision doesn't count.
   */
  async sessionsWorking(): Promise<number> {
    return (await this.repository.answering()).filter(worksIn).length;
  }

  /**
   * Whether the Thread's person is in a turn now, as the runner tracks it in memory: false for a
   * Thread waiting for the user or for a Decision's answer, and for one The Office doesn't know.
   */
  isTurnRunning(threadId: string): boolean {
    return this.runner.isTurnRunning(threadId);
  }
}
