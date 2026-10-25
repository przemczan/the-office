import { describe, expect, it } from "vitest";
import { MessagesLogged, ThreadRenamed, ThreadStarted } from "./conversation-events.js";
import type { Message } from "./message.js";
import { NO_TOKENS } from "./thread.js";
import { logMessages, renameThread, startChatThread } from "./thread-changes.js";
import { aThread, aUserMessage } from "./thread.fixtures.js";
import { ThreadRefused } from "./thread-refused.js";
import { titleFrom } from "./thread-title.js";

const AT = new Date("2026-10-25T10:00:00.000Z");
const JAN = { roleKey: "planner", name: "Jan", chat: true };

describe("a chat Thread", () => {
  it("starts untitled and waiting in the person's chat, with no session yet", () => {
    const { thread, event } = startChatThread("thread-1", JAN, AT);

    expect(thread).toEqual({
      id: "thread-1",
      home: { kind: "chat", roleKey: "planner" },
      roleKey: "planner",
      title: undefined,
      state: "waiting",
      session: undefined,
      tokens: NO_TOKENS,
      startedAt: AT,
    });
    expect(event).toEqual(new ThreadStarted(thread));
  });

  it("is refused for a person whose Chat is off", () => {
    expect(() =>
      startChatThread("thread-1", { roleKey: "developer", name: "Ada", chat: false }, AT),
    ).toThrow(
      new ThreadRefused([
        "Chat is off for Ada: talk to them on a Task, or turn Chat on on their Role card.",
      ]),
    );
  });
});

describe("a Thread's title", () => {
  it("is the first message on one line, without its closing punctuation", () => {
    expect(titleFrom("  What does the\nadmin panel deploy?  ")).toBe(
      "What does the admin panel deploy",
    );
  });

  it("is cut at a word when the message is long", () => {
    expect(titleFrom("Plan the export of every invoice to the accounting system")).toBe(
      "Plan the export of every…",
    );
  });

  it("comes from the user's first message, and a later one leaves it", () => {
    const thread = aThread();
    const first = logMessages(thread, [aUserMessage(thread, "Read the deploy workflow.")], AT);
    const second = first && logMessages(first.thread, [aUserMessage(thread, "And the tests?")], AT);

    expect(first?.thread.title).toBe("Read the deploy workflow");
    expect(second?.thread.title).toBe("Read the deploy workflow");
  });

  it("given by the user survives the first message", () => {
    const renamed = renameThread(aThread(), "Deploys", AT);
    const logged =
      renamed && logMessages(renamed.thread, [aUserMessage(renamed.thread, "Hello there.")], AT);

    expect(logged?.thread.title).toBe("Deploys");
  });

  it("is renamed trimmed, refused empty or too long, and unchanged when it is the same", () => {
    const thread = aThread({ title: "Deploys" });
    const renamed = renameThread(thread, "  Deploy workflow ", AT);

    expect(renamed?.thread.title).toBe("Deploy workflow");
    expect(renamed?.event).toEqual(new ThreadRenamed(renamed?.thread ?? thread, AT));
    expect(renameThread(thread, "Deploys", AT)).toBeUndefined();
    expect(() => renameThread(thread, "  ", AT)).toThrow(
      new ThreadRefused(["Give the Thread a title."]),
    );
    expect(() => renameThread(thread, "x".repeat(81), AT)).toThrow(
      new ThreadRefused(["A Thread's title may be at most 80 characters."]),
    );
  });
});

describe("the Thread's log", () => {
  it("takes the messages in order and announces them", () => {
    const thread = aThread({ title: "Deploys" });
    const messages: Message[] = [
      aUserMessage(thread, "Read the workflow."),
      {
        kind: "tool-activity",
        id: "m-2",
        threadId: thread.id,
        roleKey: "planner",
        tool: "Read",
        summary: ".github/workflows/deploy-production.yml",
        at: AT,
      },
      {
        kind: "refusal",
        id: "m-3",
        threadId: thread.id,
        roleKey: "planner",
        tool: "Edit",
        reason: "A chat only reads; changes happen on Tasks.",
        at: AT,
      },
      { kind: "person", id: "m-4", threadId: thread.id, roleKey: "planner", text: "Done.", at: AT },
    ];

    const logged = logMessages(thread, messages, AT);

    expect(logged).toEqual({
      thread,
      logged: messages,
      event: new MessagesLogged(thread, messages, AT),
    });
  });

  it("logs nothing when there is nothing, and never another Thread's message", () => {
    const thread = aThread();

    expect(logMessages(thread, [], AT)).toBeUndefined();
    expect(() =>
      logMessages(thread, [aUserMessage(aThread({ id: "other" }), "Hello.")], AT),
    ).toThrow("belongs to Thread other");
  });
});
