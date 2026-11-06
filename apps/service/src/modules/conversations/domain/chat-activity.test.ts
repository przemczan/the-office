import { describe, expect, it } from "vitest";
import { chatActivityOfPeople, hasAnswered, type ChatThreadActivity } from "./chat-activity.js";

const EARLIER = new Date("2026-11-06T09:00:00.000Z");
const LATER = new Date("2026-11-06T10:00:00.000Z");

function aChatThread(fields: Partial<ChatThreadActivity> = {}): ChatThreadActivity {
  return {
    threadId: "a-thread",
    roleKey: "planner",
    state: "waiting",
    lastMovedAt: EARLIER,
    unseenAnswerAt: undefined,
    ...fields,
  };
}

describe("hasAnswered", () => {
  it("waits for the person to finish", () => {
    expect(hasAnswered(aChatThread({ unseenAnswerAt: EARLIER }))).toBe(true);
    expect(hasAnswered(aChatThread({ unseenAnswerAt: EARLIER, state: "answering" }))).toBe(false);
  });

  it("is false with nothing unseen", () => {
    expect(hasAnswered(aChatThread())).toBe(false);
  });
});

describe("chatActivityOfPeople", () => {
  it("gathers each person's Threads, the newest answer first", () => {
    const activity = chatActivityOfPeople([
      aChatThread({ threadId: "older", unseenAnswerAt: EARLIER }),
      aChatThread({ threadId: "newer", unseenAnswerAt: LATER, lastMovedAt: LATER }),
      aChatThread({ threadId: "seen" }),
      aChatThread({ threadId: "busy", roleKey: "cto", state: "answering" }),
    ]);

    expect(activity).toEqual([
      {
        roleKey: "planner",
        answering: false,
        answered: [
          { threadId: "newer", at: LATER },
          { threadId: "older", at: EARLIER },
        ],
        lastMovedAt: LATER,
      },
      { roleKey: "cto", answering: true, answered: [], lastMovedAt: EARLIER },
    ]);
  });
});
