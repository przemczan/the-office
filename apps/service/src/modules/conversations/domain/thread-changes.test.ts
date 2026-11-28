import { describe, expect, it } from "vitest";
import {
  MessagesLogged,
  ThreadSessionMovedToEngine,
  ThreadStarted,
} from "./conversation-events.js";
import type { Message } from "./message.js";
import { NO_TOKENS } from "./thread.js";
import {
  bargeIn,
  freshSession,
  logMessages,
  moveSessionBack,
  moveSessionToEngine,
  startChatThread,
} from "./thread-changes.js";
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

  it("starts with the title The Office gives it, kept past the user's first message, or refuses one too long", () => {
    const { thread } = startChatThread("thread-1", JAN, AT, " Set up test targets: Billing ");

    expect(thread.title).toBe("Set up test targets: Billing");
    expect(
      logMessages(thread, [aUserMessage(thread, "Can you set them up?")], AT)?.thread.title,
    ).toBe("Set up test targets: Billing");
    expect(() => startChatThread("thread-2", JAN, AT, "x".repeat(81))).toThrow(
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
      event: new MessagesLogged(thread, messages, AT, false),
    });
  });

  it("says the Thread changed besides its log when it took its title, or the caller changed it", () => {
    const untitled = aThread({ title: undefined });
    const answering = { ...untitled, title: "Deploys", state: "answering" as const };

    expect(logMessages(untitled, [aUserMessage(untitled, "Deploys")], AT)?.event).toMatchObject({
      threadChanged: true,
    });
    expect(
      logMessages(answering, [aUserMessage(answering, "And the build.")], AT, {
        ...answering,
        state: "waiting",
      })?.event,
    ).toMatchObject({ threadChanged: true });
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

describe("a Stage's session moved to a Stand-in Engine", () => {
  const onWork = aThread({
    stageThread: true,
    state: "answering",
    session: freshSession(
      "session-1",
      {
        roleKey: "planner",
        cardVersion: 1,
        officeInstructionsVersion: 0,
        engineId: "work",
        changesAllowed: false,
        heldDuties: [],
        standInFor: undefined,
      },
      AT,
    ),
  });
  const move = {
    messageId: "line-1",
    from: "work",
    to: "home",
    fromName: "Claude Code",
    toName: "Claude Code 2",
    window: "five-hour",
    resetsAt: new Date("2026-11-13T14:00:00.000Z"),
  };

  it("runs on the stand-in for the engine it left, and logs the line that says why", () => {
    const { thread, logged, event } = moveSessionToEngine(onWork, move, AT);

    expect(thread.session).toMatchObject({
      id: "session-1",
      engineId: "home",
      standInFor: {
        engineId: "work",
        engineName: "Claude Code",
        reason:
          "Claude Code's 5-hour window was used up until 2026-11-13 14:00 UTC, so the Stage went on on Claude Code 2.",
      },
    });
    expect(logged).toEqual([
      {
        id: "line-1",
        threadId: onWork.id,
        at: AT,
        kind: "engine-switched",
        fromName: "Claude Code",
        toName: "Claude Code 2",
        window: "five-hour",
        resetsAt: "2026-11-13T14:00:00.000Z",
      },
    ]);
    expect(event).toEqual(new ThreadSessionMovedToEngine(thread, "work", "home", logged, AT));
  });

  it("names the person who went on in a person's Thread", () => {
    const { thread, logged } = moveSessionToEngine(onWork, { ...move, personName: "Pam" }, AT);

    expect(logged[0]).toMatchObject({ kind: "engine-switched", personName: "Pam" });
    expect(thread.session?.standInFor?.reason).toBe(
      "Claude Code's 5-hour window was used up until 2026-11-13 14:00 UTC, so Pam went on on Claude Code 2.",
    );
  });

  it("still stands in for the engine it first ran on after a second switch, and for none back there", () => {
    const { thread: onHome } = moveSessionToEngine(onWork, move, AT);
    const second = { ...move, from: "home", fromName: "Claude Code 2" };

    const { thread: onSpare } = moveSessionToEngine(
      onHome,
      { ...second, to: "spare", toName: "Spare" },
      AT,
    );
    const { thread: backOnWork } = moveSessionToEngine(
      onHome,
      { ...second, to: "work", toName: "Claude Code" },
      AT,
    );

    expect(onSpare.session).toMatchObject({
      engineId: "spare",
      standInFor: { engineId: "work", engineName: "Claude Code" },
    });
    expect(backOnWork.session?.engineId).toBe("work");
    expect(backOnWork.session?.standInFor).toBeUndefined();
  });

  it("refuses a session that isn't on the engine it moves from", () => {
    expect(() => moveSessionToEngine(onWork, { ...move, from: "home" }, AT)).toThrow(Error);
  });

  it("goes back to the engine it ran on, with the stand-in it recorded then, logging nothing", () => {
    const { thread: moved } = moveSessionToEngine(onWork, move, AT);

    const back = moveSessionBack(
      moved,
      { from: "home", to: { engineId: "work", standInFor: undefined } },
      AT,
    );

    expect(back?.thread.session).toEqual(onWork.session);
    expect(back?.logged).toEqual([]);
    expect(moveSessionBack(onWork, { from: "home", to: { engineId: "work" } }, AT)).toBeUndefined();
  });
});
