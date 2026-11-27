import { describe, expect, it } from "vitest";
import {
  ContextRead,
  DeliveryMarked,
  ThreadRenamed,
  ThreadStarted,
  TokensCounted,
} from "./conversation-events.js";
import { NO_TOKENS, tokensSoFar, type ThreadSession } from "./thread.js";
import {
  bargeIn,
  beginOpening,
  countRunningTurn,
  endStageWork,
  endTurn,
  failAnswer,
  logMessages,
  markDelivery,
  readRunningContext,
  renameThread,
  startChatThread,
  startTaskThread,
} from "./thread-changes.js";
import { aThread, aUserMessage } from "./thread.fixtures.js";
import { ThreadRefused } from "./thread-refused.js";
import { titleFrom } from "./thread-title.js";
import { ANN_LEE } from "./user.fixtures.js";

const AT = new Date("2026-10-25T10:00:00.000Z");

describe("a chat Thread", () => {
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

describe("a Thread on a Task", () => {
  const start = { taskId: "task-1", roleKey: "planner", title: " Planning " };

  it("starts titled by The Office and waiting, with no session yet", () => {
    const { thread, event } = startTaskThread("thread-1", start, AT);

    expect(thread).toMatchObject({
      home: { kind: "task", taskId: "task-1" },
      roleKey: "planner",
      title: "Planning",
      state: "waiting",
      session: undefined,
    });
    expect(event).toEqual(new ThreadStarted(thread));
  });

  it("opens answering, logging only its first session's move", () => {
    const { thread } = startTaskThread("thread-1", start, AT);
    const session = {
      id: "session-1",
      roleKey: "planner",
      cardVersion: 1,
      officeInstructionsVersion: 0,
      engineId: "claude-code",
      startedAt: AT,
      lastCallAt: undefined,
      contextTokens: 0,
      startContextTokens: undefined,
      full: false,
      changesAllowed: false,
    };
    const decision = {
      move: "fresh",
      reason: "new-thread",
      cacheWarm: false,
      cacheWarmUntil: undefined,
      contextTokens: 0,
      briefTokens: 900,
      alternatives: [],
    } as const;

    const opening = { personName: "Jan", decision, newSession: session, brief: "The record." };

    const opened = beginOpening(thread, opening, AT);

    expect(opened.thread).toMatchObject({
      state: "answering",
      answeringSince: AT,
      session,
      title: "Planning",
    });
    expect(opened.logged).toEqual([
      {
        kind: "context",
        id: expect.any(String),
        threadId: "thread-1",
        at: AT,
        move: "fresh",
        reason: "new-thread",
        contextTokens: 0,
        briefTokens: 900,
        brief: "The record.",
      },
    ]);
    expect(() => beginOpening(opened.thread, opening, AT)).toThrow(/open already/);
  });
});

describe("a Thread's title", () => {
  it("is the first message on one line, without its closing punctuation", () => {
    expect(titleFrom("  What does the\nadmin panel deploy?  ")).toBe(
      "What does the admin panel deploy",
    );
  });

  it("reads a link by its words, as a mentioned record shows", () => {
    expect(titleFrom("Is [@Export \\[beta\\]](/tasks/a) done?")).toBe("Is @Export [beta] done");
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
  it("logs nothing when there is nothing, and never another Thread's message", () => {
    const thread = aThread();

    expect(logMessages(thread, [], AT)).toBeUndefined();
    expect(() =>
      logMessages(thread, [aUserMessage(aThread({ id: "other" }), "Hello.")], AT),
    ).toThrow("belongs to Thread other");
  });
});

describe("barge-in", () => {
  const running = aThread({
    home: { kind: "task", taskId: "4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a" },
    state: "answering",
    stageThread: true,
  });

  it("logs the user's message into a running Stage Thread waiting for the next safe point", () => {
    const change = bargeIn(running, {
      id: "said",
      text: "Rename it on the list too.",
      at: AT,
      writtenBy: ANN_LEE,
    });

    expect(change.thread.state).toBe("answering");
    expect(change.logged).toEqual([
      {
        kind: "user",
        id: "said",
        threadId: running.id,
        text: "Rename it on the list too.",
        delivery: "waiting",
        at: AT,
        writtenBy: ANN_LEE,
      },
    ]);
  });

  it("marks the messages' delivery, and changes nothing with none to mark", () => {
    const marking = { messageIds: ["said"], delivery: "delivered" as const };

    expect(markDelivery(running, marking, AT)).toEqual({
      thread: running,
      logged: [],
      marked: marking,
      event: new DeliveryMarked(running, ["said"], "delivered", AT),
    });
    expect(markDelivery(running, { messageIds: [], delivery: "delivered" }, AT)).toBeUndefined();
  });
});

describe("a Thread's tokens", () => {
  const session: ThreadSession = {
    id: "session-1",
    roleKey: "planner",
    engineId: "claude-code",
    cardVersion: 1,
    officeInstructionsVersion: 0,
    startedAt: AT,
    lastCallAt: AT,
    contextTokens: 30_000,
    startContextTokens: 30_000,
    full: false,
    changesAllowed: false,
  };
  const earlier = { input: 10, output: 200, cacheRead: 5_000, cacheCreation: 1_000 };
  const soFar = { input: 3, output: 90, cacheRead: 9_000, cacheCreation: 0 };
  const running = aThread({ state: "answering", session, tokens: earlier });

  it("count the running turn so far, apart from the ended turns, while the person answers", () => {
    const counted = countRunningTurn(running, soFar, AT);

    expect(counted?.thread).toMatchObject({ tokens: earlier, runningTurnTokens: soFar });
    expect(counted?.event).toEqual(new TokensCounted(counted?.thread ?? running, AT));
    expect(tokensSoFar(counted?.thread ?? running)).toEqual({
      input: 13,
      output: 290,
      cacheRead: 14_000,
      cacheCreation: 1_000,
    });
    expect(countRunningTurn(aThread({ tokens: earlier }), soFar, AT)).toBeUndefined();
  });

  it("end the running turn's time with the turn, unless another follows", () => {
    const since = new Date("2026-01-01T00:00:00Z");
    const counting = { ...running, answeringSince: since };
    const count = {
      usage: NO_TOKENS,
      contextTokens: 1_000,
      contextWindow: undefined,
      handingOver: false,
      turnFollows: false,
      endedAt: AT,
    };

    expect(endTurn(counting, count).thread.answeringSince).toBeUndefined();
    expect(endTurn(counting, { ...count, turnFollows: true }).thread.answeringSince).toEqual(since);
  });

  it("take the turn's own count in place of the running one as it ends", () => {
    const counting = { ...running, runningTurnTokens: soFar };
    const usage = { input: 4, output: 100, cacheRead: 9_500, cacheCreation: 0 };

    const { thread } = endTurn(counting, {
      usage,
      contextTokens: 31_000,
      contextWindow: 200_000,
      handingOver: false,
      turnFollows: false,
      endedAt: AT,
    });

    expect(thread).toMatchObject({
      tokens: { input: 14, output: 300, cacheRead: 14_500, cacheCreation: 1_000 },
      runningTurnTokens: NO_TOKENS,
      session: { contextTokens: 31_000, contextWindow: 200_000 },
    });
  });

  it("keep the running turn's context reading on the session while the person answers", () => {
    const read = readRunningContext(running, 42_000, AT);

    expect(read?.thread.session).toMatchObject({ contextTokens: 42_000 });
    expect(read?.event).toEqual(new ContextRead(read?.thread ?? running, AT));
    expect(readRunningContext(aThread({ session }), 42_000, AT)).toBeUndefined();
  });

  it("keep the running count as spent when the session ends before its turn does", () => {
    const counting = { ...running, runningTurnTokens: soFar };
    const spent = { input: 13, output: 290, cacheRead: 14_000, cacheCreation: 1_000 };

    expect(failAnswer(counting, "The session ended.", AT).thread).toMatchObject({
      tokens: spent,
      runningTurnTokens: NO_TOKENS,
    });
    expect(
      endStageWork(
        { ...counting, stageThread: true },
        { roleKey: "planner", handoverNote: undefined, closing: undefined },
        AT,
      )?.thread,
    ).toMatchObject({ tokens: spent, runningTurnTokens: NO_TOKENS });
  });
});
