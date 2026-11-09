import { describe, expect, it } from "vitest";
import type { Message, MessageDraft } from "./message.js";
import {
  briefWithOpenPageRecord,
  openPageToGive,
  sameOpenPage,
  withOpenPageRecord,
  type OpenPage,
} from "./open-page.js";

const TASK: OpenPage = { kind: "task", taskId: "3b1f6f0e-0000-4000-8000-000000000001" };
const PROJECT: OpenPage = { kind: "project", projectId: "admin-panel" };

function logged(...drafts: MessageDraft[]): Message[] {
  return drafts.map((draft, index) => ({
    ...draft,
    id: `m-${index}`,
    threadId: "t-1",
    at: new Date("2026-11-09T09:00:00.000Z"),
  }));
}

function userMessage(openPage?: OpenPage): MessageDraft {
  return { kind: "user", text: "Hello.", delivery: "delivered", openPage };
}

function contextLine(move: "resume" | "fresh" | "hand-off"): MessageDraft {
  return {
    kind: "context",
    move,
    reason: move === "resume" ? "small-context" : "cache-expired",
    contextTokens: 0,
    briefTokens: undefined,
    brief: undefined,
  };
}

const PERSON_ANSWER: MessageDraft = { kind: "person", roleKey: "planner", text: "Hi." };

describe("the Open page to give with a message", () => {
  it("is none without an Open page", () => {
    expect(
      openPageToGive({ openPage: undefined, mentions: [], log: [], newSession: true }),
    ).toBeUndefined();
  });

  it("is always given to a session that starts on the message", () => {
    const log = logged(userMessage(TASK), PERSON_ANSWER);

    expect(openPageToGive({ openPage: TASK, mentions: [], log, newSession: true })).toEqual(TASK);
  });

  it("is not given twice to a running session on the same page", () => {
    const log = logged(contextLine("fresh"), userMessage(TASK), PERSON_ANSWER);

    expect(
      openPageToGive({ openPage: TASK, mentions: [], log, newSession: false }),
    ).toBeUndefined();
  });

  it("is given again once the page changed, or the previous message went without one", () => {
    const changed = logged(userMessage(PROJECT), PERSON_ANSWER);
    const leftOut = logged(userMessage(TASK), PERSON_ANSWER, userMessage(), PERSON_ANSWER);

    expect(
      openPageToGive({ openPage: TASK, mentions: [], log: changed, newSession: false }),
    ).toEqual(TASK);
    expect(
      openPageToGive({ openPage: TASK, mentions: [], log: leftOut, newSession: false }),
    ).toEqual(TASK);
  });

  it("looks back across a resume, but not past the move that started the session", () => {
    const resumed = logged(userMessage(TASK), PERSON_ANSWER, contextLine("resume"));
    const handedOff = logged(userMessage(TASK), PERSON_ANSWER, contextLine("hand-off"));

    expect(
      openPageToGive({ openPage: TASK, mentions: [], log: resumed, newSession: false }),
    ).toBeUndefined();
    expect(
      openPageToGive({ openPage: TASK, mentions: [], log: handedOff, newSession: false }),
    ).toEqual(TASK);
  });

  it("is not given when the message mentions the same record", () => {
    const mentions = [{ kind: "task", taskId: TASK.kind === "task" ? TASK.taskId : "" }] as const;

    expect(openPageToGive({ openPage: TASK, mentions, log: [], newSession: true })).toBeUndefined();
    expect(
      openPageToGive({
        openPage: PROJECT,
        mentions,
        log: [],
        newSession: true,
      }),
    ).toEqual(PROJECT);
  });
});

describe("the Open page's record in what the session reads", () => {
  it("follows the message under its own heading", () => {
    expect(
      withOpenPageRecord("Hello.", { page: PROJECT, text: "Admin panel (id admin-panel)" }),
    ).toBe("Hello.\n\n## The page the user has open\n\nAdmin panel (id admin-panel)");
  });

  it("says when The Office has no such record", () => {
    expect(
      withOpenPageRecord("Hello.", { page: { kind: "person", roleKey: "gone" }, text: undefined }),
    ).toBe("Hello.\n\n## The page the user has open\n\nThe Office has no Role gone.");
  });

  it("leaves the text alone without one", () => {
    expect(withOpenPageRecord("Hello.", undefined)).toBe("Hello.");
  });

  it("ends the Brief, counted in its tokens", () => {
    const brief = briefWithOpenPageRecord(
      { text: "You are Jan.", tokens: 3 },
      { page: PROJECT, text: "Admin panel (id admin-panel)" },
    );

    expect(brief.text).toBe(
      "You are Jan.\n\n## The page the user has open\n\nAdmin panel (id admin-panel)",
    );
    expect(brief.tokens).toBeGreaterThan(3);
  });
});

describe("the same Open page", () => {
  it("is the same record's page", () => {
    expect(sameOpenPage(TASK, { ...TASK })).toBe(true);
    expect(sameOpenPage(TASK, PROJECT)).toBe(false);
    expect(
      sameOpenPage({ kind: "person", roleKey: "cto" }, { kind: "person", roleKey: "cto" }),
    ).toBe(true);
  });
});
