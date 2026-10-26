import { Injectable } from "@nestjs/common";
import { ThreadRepository } from "../ports/thread-repository.js";

/** What a Task's sessions have used so far, which the Task's Pipeline checks its budgets against. */
@Injectable()
export class TaskTokens {
  constructor(private readonly repository: ThreadRepository) {}

  /**
   * The tokens of every Thread on the Task, planning and Stage Threads alike: input, output and
   * cache writes. Cache reads are left out, so this is less than the Threads' own tokens.
   */
  async tokensSoFar(taskId: string): Promise<number> {
    const threads = await this.repository.listIn({ kind: "task", taskId });
    return threads.reduce(
      (sum, { tokens }) => sum + tokens.input + tokens.output + tokens.cacheCreation,
      0,
    );
  }
}
