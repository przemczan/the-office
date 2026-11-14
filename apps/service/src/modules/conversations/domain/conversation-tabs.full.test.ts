import { describe, expect, it } from "vitest";
import { conversationTabs } from "./conversation-tabs.js";
import { aDecision } from "./decision.fixtures.js";
import type { Thread } from "./thread.js";
import { aThread } from "./thread.fixtures.js";

const PLANNER = "planner";
const home = { kind: "task", taskId: "3b1f6f0e-2a4d-4c8e-9f1a-7d2e5c6b8a90" } as const;
const FIRST = new Date("2026-11-05T09:00:00.000Z");
const LATER = new Date("2026-11-05T10:00:00.000Z");

function onTask(id: string, fields: Partial<Thread>): Thread {
  return aThread({ id, home, ...fields });
}

function aConsultation(id: string, roleKey: string, decisionId: string): Thread {
  const consultation = { decisionId, askerThreadId: "stage", askerRoleKey: "oscar" };
  return onTask(id, { roleKey, consultation });
}

describe("a Task's conversation tabs", () => {
  it("is the Planner's alone before anyone worked", () => {
    expect(conversationTabs(PLANNER, [], [])).toEqual([
      { roleKey: PLANNER, threadId: undefined, stageRunning: false, consultations: [] },
    ]);
  });

  it("puts the Planner first, then people in the order they first worked", () => {
    const tabs = conversationTabs(
      PLANNER,
      [
        onTask("rui-stage", { roleKey: "rui", stageThread: true, startedAt: LATER }),
        onTask("oscar-stage", { roleKey: "oscar", stageThread: true, startedAt: FIRST }),
        onTask("planning", { roleKey: PLANNER, startedAt: FIRST }),
      ],
      [],
    );

    expect(tabs.map(({ roleKey }) => roleKey)).toEqual([PLANNER, "oscar", "rui"]);
    expect(tabs[0]?.threadId).toBe("planning");
  });

  it("pins the tab of whoever holds Plans, whatever their Role key", () => {
    const tabs = conversationTabs(
      "lead",
      [
        onTask("oscar-stage", { roleKey: "oscar", stageThread: true, startedAt: FIRST }),
        onTask("lead-planning", { roleKey: "lead", startedAt: LATER }),
      ],
      [],
    );

    expect(tabs.map(({ roleKey }) => roleKey)).toEqual(["lead", "oscar"]);
    expect(tabs[0]?.threadId).toBe("lead-planning");
  });

  it("pins no planning tab while nobody holds Plans, leaving the people who worked", () => {
    expect(conversationTabs(undefined, [], [])).toEqual([]);

    const tabs = conversationTabs(
      undefined,
      [
        onTask("rui-stage", { roleKey: "rui", stageThread: true, startedAt: LATER }),
        onTask("oscar-stage", { roleKey: "oscar", stageThread: true, startedAt: FIRST }),
      ],
      [],
    );

    expect(tabs.map(({ roleKey }) => roleKey)).toEqual(["oscar", "rui"]);
  });

  it("holds the person's own Thread, not their Stage's, and says while their Stage runs", () => {
    const [, oscar] = conversationTabs(
      PLANNER,
      [
        onTask("oscar-stage", { roleKey: "oscar", stageThread: true, state: "answering" }),
        onTask("oscar-own", { roleKey: "oscar" }),
      ],
      [],
    );

    expect(oscar).toMatchObject({ threadId: "oscar-own", stageRunning: true });
  });

  it("gives a Consultant who answered a tab with their Consultation and its note", () => {
    const answeredAt = LATER;
    const decision = aDecision({
      answer: { kind: "free-answer", text: "Keep the cookie.", answeredAt, answeredBy: "cto" },
    });

    const [, cto] = conversationTabs(
      PLANNER,
      [aConsultation("consulted", "cto", decision.id)],
      [decision],
    );

    expect(cto).toEqual({
      roleKey: "cto",
      threadId: undefined,
      stageRunning: false,
      consultations: [
        {
          threadId: "consulted",
          decisionId: decision.id,
          question: decision.question,
          note: "Keep the cookie.",
          answeredAt,
        },
      ],
    });
  });

  it("gives a Consultant a tab as soon as the Consultation starts, listed after those answered", () => {
    const answered = aDecision({
      answer: { kind: "free-answer", text: "Keep it.", answeredAt: LATER, answeredBy: "cto" },
    });
    const waiting = aDecision({ putTo: "cto" });

    const [, cto] = conversationTabs(
      PLANNER,
      [aConsultation("waiting", "cto", waiting.id), aConsultation("answered", "cto", answered.id)],
      [answered, waiting],
    );

    expect(cto?.consultations).toEqual([
      expect.objectContaining({ threadId: "answered", note: "Keep it.", answeredAt: LATER }),
      {
        threadId: "waiting",
        decisionId: waiting.id,
        question: waiting.question,
        note: undefined,
        answeredAt: undefined,
      },
    ]);
  });

  it("gives no tab to a Consultant the user answered before, or who passed it on", () => {
    const taken = aDecision({ answer: { kind: "option", option: 0, answeredAt: LATER } });
    const passedOn = aDecision({ putTo: "cto" });

    const tabs = conversationTabs(
      PLANNER,
      [aConsultation("taken", "cfo", taken.id), aConsultation("passed", "cfo", passedOn.id)],
      [taken, passedOn],
    );

    expect(tabs.map(({ roleKey }) => roleKey)).toEqual([PLANNER]);
  });
});
