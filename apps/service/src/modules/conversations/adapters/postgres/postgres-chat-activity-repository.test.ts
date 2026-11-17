import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AnswerGivenBy } from "../../domain/decision.js";
import { openDecision, recordDecisionAnswer } from "../../domain/thread-changes.js";
import { ANN_LEE } from "../../domain/user.fixtures.js";
import {
  repository,
  threads,
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

  it("lights a chat's form as it arrives, not as the user answers it, but a Consultant's answer", async () => {
    const { thread, lastMessage } = await aThreadWithAnswer();
    await repository.markSeen(thread.id, lastMessage, AT);
    const unseenAnswerAt = async (): Promise<Date | undefined> =>
      (await repository.chatThread(thread.id))?.unseenAnswerAt;

    const form = await opened(thread.id, undefined, LATER);
    expect(await unseenAnswerAt()).toEqual(LATER);
    await repository.markSeen(thread.id, form.cardId, LATER);
    await answered(thread.id, form.decisionId, { user: ANN_LEE }, LATER);
    expect(await unseenAnswerAt()).toBeUndefined();

    const call = await opened(thread.id, "devops", LATEST);
    await repository.markSeen(thread.id, call.cardId, LATEST);
    await answered(thread.id, call.decisionId, { answeredBy: "devops" }, LATEST);
    expect(await unseenAnswerAt()).toEqual(LATEST);
  });
});

const LATER = new Date(AT.getTime() + 60_000);
const LATEST = new Date(AT.getTime() + 120_000);

async function opened(
  threadId: string,
  putTo: string | undefined,
  at: Date,
): Promise<{ readonly decisionId: string; readonly cardId: string }> {
  const decisionId = randomUUID();
  let cardId = "";
  await threads.update(threadId, (latest) => {
    const change = openDecision(latest, {
      id: decisionId,
      askedAt: at,
      putTo,
      context: "",
      questions: [{ kind: "open", question: "Which page first?" }],
    });
    cardId = change.logged[0]?.id ?? "";
    return change;
  });
  return { decisionId, cardId };
}

async function answered(
  threadId: string,
  decisionId: string,
  givenBy: AnswerGivenBy,
  at: Date,
): Promise<void> {
  await threads.update(threadId, (latest) =>
    recordDecisionAnswer(latest, {
      decisionId,
      answer: { kind: "submitted", answers: [{ kind: "words", text: "Now." }] },
      messageId: randomUUID(),
      answeredAt: at,
      ...givenBy,
    }),
  );
}
