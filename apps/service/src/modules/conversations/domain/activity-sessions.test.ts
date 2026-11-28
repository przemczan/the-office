import { describe, expect, it } from "vitest";
import { activeSessionsOf } from "./activity-sessions.js";
import type { ChatThreadActivity } from "./chat-activity.js";
import { aDecision } from "./decision.fixtures.js";
import { aThread } from "./thread.fixtures.js";
import type { Thread } from "./thread.js";

const USER = "00000000-0000-4000-8000-0000000005e1";
const OTHER_USER = "00000000-0000-4000-8000-0000000005e2";
const TASK_ID = "00000000-0000-4000-8000-00000000a001";
const AT = new Date("2026-11-20T09:00:00Z");
const LATER = new Date("2026-11-20T10:00:00Z");

function aChat(fields: Partial<ChatThreadActivity> = {}): ChatThreadActivity {
  return {
    threadId: "chat-1",
    roleKey: "planner",
    state: "waiting",
    title: "A chat",
    writerUserId: USER,
    lastMovedAt: AT,
    unseenAnswerAt: undefined,
    ...fields,
  };
}

function aStageThread(fields: Partial<Thread> = {}): Thread {
  return aThread({
    id: "stage-1",
    home: { kind: "task", taskId: TASK_ID },
    roleKey: "developer",
    stageThread: true,
    state: "answering",
    answeringSince: LATER,
    ...fields,
  });
}

describe("activeSessionsOf", () => {
  it("lists an answering Stage Thread as a working session on its Task", () => {
    const [session, ...more] = activeSessionsOf([aStageThread()], [], USER);
    expect(more).toEqual([]);
    expect(session).toMatchObject({
      threadId: "stage-1",
      roleKey: "developer",
      subject: { kind: "task", taskId: TASK_ID },
      sessionKind: "stage",
      state: "working",
      waitingOn: undefined,
      since: LATER,
    });
  });

  it("lists a Stage Thread with an open Decision as waiting on it, with its question", () => {
    const decision = aDecision({ askedAt: AT });
    const [session] = activeSessionsOf([aStageThread({ openDecisions: [decision] })], [], USER);
    expect(session).toMatchObject({
      state: "waiting",
      waitingOn: { kind: "decision" },
      since: AT,
    });
  });

  it("lists a Decision put to a Consultant as waiting on the Consultant", () => {
    const decision = aDecision({ putTo: "cto" });
    const [session] = activeSessionsOf([aStageThread({ openDecisions: [decision] })], [], USER);
    expect(session?.waitingOn?.kind).toBe("consultant");
  });

  it("leaves out a Thread that isn't answering and holds no Decision", () => {
    expect(activeSessionsOf([aStageThread({ state: "waiting" })], [], USER)).toEqual([]);
  });

  it("lists an Initiative's Thread on its Initiative, working while its planner answers", () => {
    const thread = aThread({
      id: "plan-1",
      home: { kind: "initiative", initiativeId: "i-1" },
      state: "answering",
      openDecisions: [aDecision()],
    });
    const [session] = activeSessionsOf([thread], [], USER);
    expect(session).toMatchObject({
      subject: { kind: "initiative", initiativeId: "i-1" },
      sessionKind: "thread",
      state: "working",
    });
  });

  it("lists a Consultation on a Task as a consultation of the Task", () => {
    const thread = aThread({
      id: "consultation-1",
      home: { kind: "task", taskId: TASK_ID },
      roleKey: "cto",
      state: "answering",
      consultation: { decisionId: "d-1", askerThreadId: "stage-1", askerRoleKey: "developer" },
    });
    const [session] = activeSessionsOf([thread], [], USER);
    expect(session).toMatchObject({ sessionKind: "consultation", subject: { kind: "task" } });
  });

  it("lists the user's own answering chat and leaves another user's out", () => {
    const own = aThread({ id: "chat-1", state: "answering" });
    const others = aThread({ id: "chat-2", state: "answering" });
    const chats = [aChat(), aChat({ threadId: "chat-2", writerUserId: OTHER_USER })];
    const sessions = activeSessionsOf([own, others], chats, USER);
    expect(sessions.map(({ threadId }) => threadId)).toEqual(["chat-1"]);
    expect(sessions[0]).toMatchObject({
      sessionKind: "chat",
      subject: { kind: "chat", threadId: "chat-1", title: "A chat" },
    });
  });

  it("counts a chat written before users existed as the user's own", () => {
    const thread = aThread({ id: "chat-1", state: "answering" });
    expect(activeSessionsOf([thread], [aChat({ writerUserId: null })], USER)).toHaveLength(1);
  });

  it("leaves out a chat with no user message", () => {
    const thread = aThread({ id: "chat-1", state: "answering" });
    expect(activeSessionsOf([thread], [aChat({ writerUserId: undefined })], USER)).toEqual([]);
  });

  it("lists a chat with a reply the user hasn't seen as waiting on the reply", () => {
    const chat = aChat({ unseenAnswerAt: LATER });
    const [session] = activeSessionsOf([], [chat], USER);
    expect(session).toMatchObject({
      state: "waiting",
      waitingOn: { kind: "reply" },
      since: LATER,
      subject: { kind: "chat", threadId: "chat-1" },
    });
  });

  it("leaves out another user's unseen reply, and a chat still answering as a reply", () => {
    expect(
      activeSessionsOf([], [aChat({ unseenAnswerAt: LATER, writerUserId: OTHER_USER })], USER),
    ).toEqual([]);
    expect(
      activeSessionsOf([], [aChat({ unseenAnswerAt: LATER, state: "answering" })], USER),
    ).toEqual([]);
  });

  it("lists a chat with an open Decision once, as waiting on the Decision", () => {
    const thread = aThread({ id: "chat-1", state: "answering", openDecisions: [aDecision()] });
    const chat = aChat({ unseenAnswerAt: LATER });
    const sessions = activeSessionsOf([thread], [chat], USER);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.waitingOn?.kind).toBe("decision");
  });

  it("puts a Consultation in a chat on the chat that asked it, for that chat's owner only", () => {
    const asker = aThread({
      id: "chat-1",
      state: "answering",
      openDecisions: [aDecision({ putTo: "cto" })],
    });
    const consultation = aThread({
      id: "consultation-1",
      home: { kind: "chat", roleKey: "cto" },
      roleKey: "cto",
      state: "answering",
      consultation: { decisionId: "d-1", askerThreadId: "chat-1", askerRoleKey: "planner" },
    });
    const chats = [aChat()];
    const mine = activeSessionsOf([asker, consultation], chats, USER);
    expect(mine.map(({ sessionKind }) => sessionKind)).toEqual(["chat", "consultation"]);
    expect(mine[1]?.subject).toMatchObject({ kind: "chat", threadId: "chat-1" });
    expect(activeSessionsOf([asker, consultation], chats, OTHER_USER)).toEqual([]);
  });

  it("puts a Consultation an Initiative's Thread called on no Task on that Initiative", () => {
    const asker = aThread({
      id: "plan-1",
      home: { kind: "initiative", initiativeId: "i-1" },
      openDecisions: [aDecision({ putTo: "cto" })],
    });
    const consultation = aThread({
      id: "consultation-1",
      home: { kind: "chat", roleKey: "cto" },
      roleKey: "cto",
      state: "answering",
      consultation: { decisionId: "d-1", askerThreadId: "plan-1", askerRoleKey: "planner" },
    });
    const sessions = activeSessionsOf([asker, consultation], [], OTHER_USER);
    expect(sessions.map(({ sessionKind, subject }) => [sessionKind, subject])).toEqual([
      ["thread", { kind: "initiative", initiativeId: "i-1" }],
      ["consultation", { kind: "initiative", initiativeId: "i-1" }],
    ]);
  });
});
