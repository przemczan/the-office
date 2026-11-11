import type { Decision, Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { waitsOnYou, waitsOnYouInItsState } from "./waiting-on-you.ts";

const TASK_ID = "6f1c2c0e-2f0a-4f39-9a49-5d8b0c1e2a33";

function aTask(fields: Partial<Task>): Task {
  return {
    id: TASK_ID,
    title: "Fix the login redirect",
    description: "",
    projectId: "admin-panel",
    priority: "normal",
    tags: [],
    state: "planning",
    plan: "",
    pausedByAlarm: false,
    autoMode: false,
    initiativePlanningThreadId: null,
    markedPlanned: false,
    hasPlanningThread: false,
    planConfirmed: false,
    filesToChange: [],
    estimatedTokens: null,
    definitionOfDone: [],
    definitionOfDoneConfirmed: false,
    pipelineId: "full",
    proposedPipeline: null,
    blockedBy: [],
    originIdeaId: null,
    initiativeId: null,
    projectMoves: [],
    createdBy: { kind: "user" },
    createdAt: "2026-10-25T10:00:00.000Z",
    archivedAt: null,
    ...fields,
  };
}

function aDecisionOn(taskId: string): Decision {
  return {
    id: "2a9e1f4c-7d3b-4c8e-9f1a-6b5d4c3e2f10",
    threadId: "0b4cbb0e-5a51-4a52-9a4e-7c0f3c1b9f10",
    taskId,
    roleKey: "planner",
    question: "Keep the query string on the way back?",
    context: "",
    options: ["Keep it", "Drop it"],
    recommendation: { option: 0, reason: "Filters live there." },
    askedAt: "2026-10-26T09:00:00.000Z",
    answer: null,
    answeredAt: null,
    putTo: null,
    attachmentIds: [],
    passedOn: [],
    answeredBy: null,
  };
}

describe("waitsOnYouInItsState", () => {
  it("is true for a Task in Planning with a Decision open on it", () => {
    expect(waitsOnYouInItsState(aTask({}), [aDecisionOn(TASK_ID)])).toBe(true);
  });

  it("is true for a Paused Task whose Agent's Decision waits", () => {
    expect(waitsOnYouInItsState(aTask({ state: "paused" }), [aDecisionOn(TASK_ID)])).toBe(true);
  });

  it("is false with no Decision open on the Task", () => {
    expect(waitsOnYouInItsState(aTask({}), [aDecisionOn("another-task")])).toBe(false);
    expect(waitsOnYouInItsState(aTask({}), [])).toBe(false);
  });

  it("leaves In progress to its own Waiting on you state", () => {
    expect(waitsOnYouInItsState(aTask({ state: "in-progress" }), [aDecisionOn(TASK_ID)])).toBe(
      false,
    );
  });
});

describe("waitsOnYou", () => {
  it("holds for the Waiting on you state and for a Task in Planning with a Decision open", () => {
    expect(waitsOnYou(aTask({ state: "waiting-on-you" }), [])).toBe(true);
    expect(waitsOnYou(aTask({}), [aDecisionOn(TASK_ID)])).toBe(true);
  });

  it("doesn't hold for a Task planning with nothing open, or in progress", () => {
    expect(waitsOnYou(aTask({}), [])).toBe(false);
    expect(waitsOnYou(aTask({ state: "in-progress" }), [aDecisionOn(TASK_ID)])).toBe(false);
  });
});
