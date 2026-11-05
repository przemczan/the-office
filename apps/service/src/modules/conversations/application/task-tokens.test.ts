import { describe, expect, it } from "vitest";
import { NO_TOKENS, type Thread } from "../domain/thread.js";
import { aThread } from "../domain/thread.fixtures.js";
import type { ThreadRepository } from "../ports/thread-repository.js";
import { TaskTokens } from "./task-tokens.js";

const home = { kind: "task", taskId: "3b1f6f0e-2a4d-4c8e-9f1a-7d2e5c6b8a90" } as const;

function used(input: number, fields: Partial<Thread>): Thread {
  return aThread({ id: crypto.randomUUID(), home, tokens: { ...NO_TOKENS, input }, ...fields });
}

function tokensOf(threads: readonly Thread[]): TaskTokens {
  const repository = { listIn: () => Promise.resolve(threads) };
  return new TaskTokens(repository as unknown as ThreadRepository);
}

describe("a Task's tokens against a Stage's budget", () => {
  it("counts its Stage Threads and Consultations, never a person's Thread", async () => {
    const consultation = { decisionId: "d", askerThreadId: "t", askerRoleKey: undefined };
    const tokens = tokensOf([
      used(100, { stageThread: true }),
      used(20, { consultation }),
      used(3, {}),
    ]);

    await expect(tokens.budgetTokensSoFar(home.taskId)).resolves.toBe(120);
  });
});
