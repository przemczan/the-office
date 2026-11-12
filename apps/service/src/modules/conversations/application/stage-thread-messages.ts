import { Injectable } from "@nestjs/common";
import { ThreadRepository } from "../ports/thread-repository.js";
import { ThreadHistory, type StageRunWindow } from "./thread-history.js";

/**
 * An Agent Stage run's messages in its Stage Thread, for Pipelines' `read_stage_history` (spec
 * 2.4): worded by `ThreadHistory`, as `read_threads` words them, from The Office's log alone.
 */
@Injectable()
export class StageThreadMessages {
  constructor(
    private readonly history: ThreadHistory,
    private readonly threads: ThreadRepository,
  ) {}

  words(window: StageRunWindow, limit: number): Promise<string> {
    return this.history.ofStageRun(window, limit);
  }

  count({ threadId, from, to }: StageRunWindow): Promise<number> {
    return this.threads.countLoggedIn({ from, to, threadId });
  }
}
