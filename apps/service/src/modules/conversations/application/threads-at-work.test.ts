import { describe, expect, it } from "vitest";
import { aDecision } from "../domain/decision.fixtures.js";
import { aThread } from "../domain/thread.fixtures.js";
import type { Thread } from "../domain/thread.js";
import type { ThreadRepository } from "../ports/thread-repository.js";
import type { ThreadRunner } from "./thread-runner.js";
import { ThreadsAtWork } from "./threads-at-work.js";

function serviceAnswering(threads: readonly Thread[]): ThreadsAtWork {
  const repository = { answering: () => Promise.resolve(threads) } as unknown as ThreadRepository;
  return new ThreadsAtWork(repository, {} as ThreadRunner);
}

describe("ThreadsAtWork.sessionsWorking", () => {
  it("counts the sessions working now, in Stages, chats and Threads, but not one waiting on its Decision", async () => {
    const service = serviceAnswering([
      aThread({ id: crypto.randomUUID(), state: "answering", stageThread: true }),
      aThread({ id: crypto.randomUUID(), state: "answering" }),
      aThread({
        id: crypto.randomUUID(),
        state: "answering",
        stageThread: true,
        openDecisions: [aDecision()],
      }),
    ]);

    expect(await service.sessionsWorking()).toBe(2);
  });
});
