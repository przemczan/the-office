import { describe, expect, it } from "vitest";
import {
  repository,
  AT,
  aThreadWithAnswer,
  setUpEachTest,
} from "./postgres-chat-activity-repository.fixtures.js";

setUpEachTest();

describe("PostgresChatActivityRepository", () => {
  it("reads an unseen answer until it is marked seen", async () => {
    const { thread, lastMessage } = await aThreadWithAnswer();
    expect((await repository.chatThread(thread.id))?.unseenAnswerAt).toEqual(AT);

    expect(await repository.markSeen(thread.id, lastMessage, AT)).toBe("moved");

    expect((await repository.chatThread(thread.id))?.unseenAnswerAt).toBeUndefined();
    expect(await repository.markSeen(thread.id, lastMessage, AT)).toBe("stayed");
  });
});
