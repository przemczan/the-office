import { describe, expect, it } from "vitest";
import { MessagesLogged, ThreadStarted } from "./conversation-events.js";
import type { Message } from "./message.js";
import { NO_TOKENS } from "./thread.js";
import { bargeIn, logMessages, startChatThread } from "./thread-changes.js";
import { aThread, aUserMessage } from "./thread.fixtures.js";
import { ThreadRefused } from "./thread-refused.js";
import { ANN_LEE } from "./user.fixtures.js";

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
      override: undefined,
      tokens: NO_TOKENS,
      runningTurnTokens: NO_TOKENS,
      startedAt: AT,
      openDecisions: [],
      stageThread: false,
    });
    expect(event).toEqual(new ThreadStarted(thread));
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
});

describe("barge-in", () => {
  const running = aThread({
    home: { kind: "task", taskId: "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a" },
    state: "answering",
    stageThread: true,
  });

  it("is refused once the Stage's work in the Thread has ended", () => {
    const waiting = { ...running, state: "waiting" as const };

    expect(() =>
      bargeIn(waiting, { id: "said", text: "Too late?", at: AT, writtenBy: ANN_LEE }),
    ).toThrow(new ThreadRefused(["The Stage ended before your message went. Send it again."]));
  });

  it("logs a message to a chat the person answers in as waiting, with its Open page", () => {
    const answering = aThread({ state: "answering" });
    const openPage = { kind: "person", roleKey: "planner" } as const;

    const { thread, logged } = bargeIn(answering, {
      id: "said",
      text: "The build too.",
      at: AT,
      writtenBy: ANN_LEE,
      openPage,
      personName: "Jan",
    });

    expect(thread.state).toBe("answering");
    expect(logged).toEqual([
      {
        kind: "user",
        id: "said",
        threadId: answering.id,
        text: "The build too.",
        delivery: "waiting",
        at: AT,
        writtenBy: ANN_LEE,
        openPage,
      },
    ]);
  });

  it("is refused in a chat once the person has finished, naming them", () => {
    const waiting = aThread({ state: "waiting" });

    expect(() =>
      bargeIn(waiting, {
        id: "said",
        text: "Too late?",
        at: AT,
        writtenBy: ANN_LEE,
        personName: "Jan",
      }),
    ).toThrow(new ThreadRefused(["Jan finished before your message went. Send it again."]));
  });
});
