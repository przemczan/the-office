import type { ConversationTab, TaskStage, Thread } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  emptyThreadWords,
  firstTab,
  plannedElsewhereWords,
  stageRunningFor,
  stagesWorkedOn,
  tabAsked,
  tabLine,
} from "./conversation-tabs.ts";

function tab(roleKey: string, overrides: Partial<ConversationTab> = {}): ConversationTab {
  return {
    roleKey,
    threadId: null,
    stageRunning: false,
    consultations: [],
    planningThreadElsewhere: null,
    ...overrides,
  };
}

function thread(id: string, roleKey: string, stageThread = false): Thread {
  return { id, roleKey, stageThread } as Thread;
}

function stageOf(name: string, threadId: string | null): TaskStage {
  return { stage: { name }, runs: [{ threadId }] } as unknown as TaskStage;
}

function stageWithRun(name: string, threadId: string, endedAt: string | null): TaskStage {
  return { stage: { name }, runs: [{ threadId, endedAt }] } as unknown as TaskStage;
}

describe("tabAsked", () => {
  const tabs = [tab("planner"), tab("developer", { threadId: "own" })];

  it("takes a person's key", () => {
    expect(tabAsked("developer", tabs, [])).toBe("developer");
  });

  it("takes any of the person's Threads, a Consultation or a Stage's too", () => {
    const threads = [thread("stage", "developer", true), thread("consultation", "planner")];
    expect(tabAsked("stage", tabs, threads)).toBe("developer");
    expect(tabAsked("consultation", tabs, threads)).toBe("planner");
  });

  it("names no tab for someone without one, or for nothing", () => {
    expect(tabAsked("elsewhere", tabs, [thread("elsewhere", "reviewer")])).toBeUndefined();
    expect(tabAsked("not-a-thread", tabs, [])).toBeUndefined();
    expect(tabAsked(undefined, tabs, [])).toBeUndefined();
  });
});

describe("firstTab", () => {
  it("is the tab whose Thread holds an open Decision, before a running Stage", () => {
    const tabs = [
      tab("planner"),
      tab("developer", { stageRunning: true }),
      tab("reviewer", { threadId: "asked" }),
    ];
    expect(firstTab(tabs, [{ threadId: "asked" }])).toBe("reviewer");
  });

  it("is the person whose Stage runs when no tab's Thread holds a Decision", () => {
    const tabs = [tab("planner"), tab("developer", { stageRunning: true })];
    expect(firstTab(tabs, [{ threadId: "a-stage-thread" }])).toBe("developer");
  });

  it("is the Planner otherwise", () => {
    expect(firstTab([tab("planner"), tab("developer")], [])).toBe("planner");
  });
});

describe("stagesWorkedOn", () => {
  it("names the Stages run in the person's Stage Threads, in Pipeline order", () => {
    const stages = [stageOf("Implement", "one"), stageOf("Review", "two"), stageOf("Fix", "three")];
    const threads = [
      thread("one", "developer", true),
      thread("two", "reviewer", true),
      thread("three", "developer", true),
    ];
    expect(stagesWorkedOn(stages, threads, "developer")).toEqual(["Implement", "Fix"]);
  });
});

describe("stageRunningFor", () => {
  const threads = [thread("one", "developer", true), thread("two", "reviewer", true)];

  it("is the Stage whose run goes on in the person's Stage Thread", () => {
    const stages = [
      stageWithRun("Implement", "one", "2026-11-05T10:00:00.000Z"),
      stageWithRun("Review", "two", null),
    ];
    expect(stageRunningFor(stages, threads, "reviewer")?.stage.name).toBe("Review");
  });

  it("is none once their runs ended, or while another person's Stage runs", () => {
    const stages = [
      stageWithRun("Implement", "one", "2026-11-05T10:00:00.000Z"),
      stageWithRun("Review", "two", null),
    ];
    expect(stageRunningFor(stages, threads, "developer")).toBeUndefined();
  });
});

describe("tabLine", () => {
  it("says whether the Planner planned", () => {
    expect(tabLine(true, tab("planner"), [])).toBe("Hasn't planned this Task");
    expect(tabLine(true, tab("planner", { threadId: "own" }), [])).toBe("Plans this Task");
    const elsewhere = { initiativeId: "initiative", threadId: "initiative-planning" };
    expect(tabLine(true, tab("planner", { planningThreadElsewhere: elsewhere }), [])).toBe(
      "Plans this Task in the Initiative's planning Thread",
    );
    expect(plannedElsewhereWords("Angela")).toBe(
      "Angela is planning this Task in the Initiative's planning Thread.",
    );
  });

  it("says what anyone else did", () => {
    expect(tabLine(false, tab("developer"), ["Implement", "Fix"])).toBe(
      "Worked on Implement · Fix",
    );
    const consultation = {
      threadId: "t",
      decisionId: "d",
      question: "q",
      note: "n",
      answeredAt: "2026-11-05T10:00:00.000Z",
    };
    expect(tabLine(false, tab("cto", { consultations: [consultation] }), [])).toBe(
      "Answered a Consultation on this Task",
    );
  });

  it("says a Consultant is in a Consultation until they answer", () => {
    const consultation = {
      threadId: "consulted",
      decisionId: "asked",
      question: "Keep the cookie?",
      note: null,
      answeredAt: null,
    };
    const waiting = tab("cto", { consultations: [consultation] });
    const answered = tab("cto", {
      consultations: [{ ...consultation, note: "Yes.", answeredAt: "2026-11-05T10:00:00.000Z" }],
    });

    expect(tabLine(false, waiting, [])).toBe("In a Consultation on this Task");
    expect(tabLine(false, answered, [])).toBe("Answered a Consultation on this Task");
  });

  it("words an empty Thread by who the person is and what they worked on", () => {
    expect(emptyThreadWords(true, "Jan", [])).toBe(
      "No conversation yet. Ask Jan anything about this Task.",
    );
    expect(emptyThreadWords(false, "Adam", ["Implement", "Review"])).toBe(
      "No messages yet. Ask Adam anything about this Task: Adam worked on Implement and Review.",
    );
    expect(emptyThreadWords(false, "Oscar", [])).toBe(
      "No messages yet. Ask Oscar anything about this Task.",
    );
  });
});
