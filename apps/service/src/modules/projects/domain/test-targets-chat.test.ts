import { describe, expect, it } from "vitest";
import {
  testTargetsChatStanding,
  testTargetsChatTitle,
  type TestTargetsChat,
  type TestTargetsChatThread,
} from "./test-targets-chat.js";

const askedAt = new Date("2026-11-22T10:00:00.000Z");
const userWroteAt = new Date("2026-11-22T10:01:00.000Z");
const repliedAt = new Date("2026-11-22T10:03:00.000Z");
const draftedAt = new Date("2026-11-22T10:02:00.000Z");

const CHAT: TestTargetsChat = {
  projectId: "billing",
  threadId: "00000000-0000-4000-8000-000000000001",
  roleKey: "devops",
  askedBy: { userId: "user-ann", name: "Ann" },
  askedAt,
};

function aThread(fields: Partial<TestTargetsChatThread> = {}): TestTargetsChatThread {
  return {
    answering: false,
    lastUserMessageAt: undefined,
    lastMessageAt: undefined,
    proposals: [],
    ...fields,
  };
}

describe("testTargetsChatStanding", () => {
  it("is a draft since it was asked while nothing is logged", () => {
    expect(testTargetsChatStanding(CHAT, aThread())).toEqual({
      kind: "going",
      state: "draft",
      since: askedAt,
    });
  });

  it("is answering since the user wrote while the person's turn runs", () => {
    const thread = aThread({
      answering: true,
      lastUserMessageAt: userWroteAt,
      lastMessageAt: repliedAt,
    });

    expect(testTargetsChatStanding(CHAT, thread)).toEqual({
      kind: "going",
      state: "answering",
      since: userWroteAt,
    });
  });

  it("waits on you since the person last replied, with no Proposal drafted", () => {
    const thread = aThread({ lastUserMessageAt: userWroteAt, lastMessageAt: repliedAt });

    expect(testTargetsChatStanding(CHAT, thread)).toEqual({
      kind: "going",
      state: "waiting-on-you",
      since: repliedAt,
    });
  });

  it("is a Proposal since its newest open one was drafted, even while the person answers", () => {
    const later = new Date("2026-11-22T10:05:00.000Z");
    const thread = aThread({
      answering: true,
      lastMessageAt: later,
      proposals: [
        { open: false, draftedAt },
        { open: true, draftedAt },
        { open: true, draftedAt: later },
      ],
    });

    expect(testTargetsChatStanding(CHAT, thread)).toEqual({
      kind: "going",
      state: "proposal",
      since: later,
    });
  });

  it("ends once its Proposal is applied or dismissed with none open", () => {
    const thread = aThread({ lastMessageAt: repliedAt, proposals: [{ open: false, draftedAt }] });

    expect(testTargetsChatStanding(CHAT, thread)).toEqual({ kind: "ended" });
  });

  it("ends once its Thread is gone", () => {
    expect(testTargetsChatStanding(CHAT, undefined)).toEqual({ kind: "ended" });
  });
});

describe("testTargetsChatTitle", () => {
  it("names the Project", () => {
    expect(testTargetsChatTitle("Billing")).toBe("Set up test targets: Billing");
  });

  it("cuts a name too long for a Thread's title", () => {
    const title = testTargetsChatTitle("A".repeat(100));

    expect(title).toHaveLength(80);
    expect(title.endsWith("A…")).toBe(true);
  });
});
