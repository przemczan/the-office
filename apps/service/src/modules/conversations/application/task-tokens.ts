import { Injectable } from "@nestjs/common";
import type { EngineId } from "../../engine/index.js";
import { isPersonsThread, type TokenTotals } from "../domain/thread.js";
import { ThreadRepository } from "../ports/thread-repository.js";

/** What a Task's Stage Threads have used on one engine id: input, output and cache writes. */
export interface EngineIdTokens {
  readonly engineId: EngineId;
  readonly tokens: number;
}

/** What a Task's sessions have used so far, by what each count is for. */
@Injectable()
export class TaskTokens {
  constructor(private readonly repository: ThreadRepository) {}

  /**
   * What a Stage's budget is checked against: the tokens of the Task's Stage Threads and
   * Consultations, input, output and cache writes. A person's Thread counts to the Task but never
   * to a budget (spec §2.4). Cache reads are left out, so this is less than the Threads' own tokens.
   */
  async budgetTokensSoFar(taskId: string): Promise<number> {
    const threads = await this.repository.listIn({ kind: "task", taskId });
    return threads
      .filter((thread) => !isPersonsThread(thread))
      .reduce((sum, { tokens }) => sum + countedTokens(tokens), 0);
  }

  /**
   * The tokens of the Task's Stage Threads so far, by the engine id each Thread's session spends
   * on, counted as `budgetTokensSoFar` counts: what its Pipeline has used of its Usage estimate, which
   * leaves Planning out as the estimate does. An engine id with no Stage Thread is left out.
   */
  async stageTokensSoFar(taskId: string): Promise<readonly EngineIdTokens[]> {
    const threads = await this.repository.listIn({ kind: "task", taskId });
    const byEngineId = new Map<EngineId, number>();
    for (const { stageThread, session, tokens } of threads) {
      if (!stageThread || !session) continue;
      const { engineId } = session;
      byEngineId.set(engineId, (byEngineId.get(engineId) ?? 0) + countedTokens(tokens));
    }
    return [...byEngineId].map(([engineId, tokens]) => ({ engineId, tokens }));
  }
}

function countedTokens({ input, output, cacheCreation }: TokenTotals): number {
  return input + output + cacheCreation;
}
