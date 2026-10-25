import type { Decision, Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { waitsOnYou } from "./waiting-on-you.ts";

const TASK_ID = "6f1c2c0e-2f0a-4f39-9a49-5d8b0c1e2a33";

function aTask(fields: Partial<Task>): Task {
  return {
    id: TASK_ID,
    title: "Fix the login redirect",
    projectId: "admin-panel",
    priority: "normal",
    state: "planning",
    plan: "",
    planConfirmed: false,
    definitionOfDone: [],
    definitionOfDoneConfirmed: false,
    pipelineId: "full",
    proposedPipeline: null,
    originIdeaId: null,
    createdBy: { kind: "user" },
    createdAt: "2026-10-25T10:00:00.000Z",
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
  };
}

describe("waitsOnYou", () => {
  it("is true for a Task in Planning with a Decision open on it", () => {
    expect(waitsOnYou(aTask({}), [aDecisionOn(TASK_ID)])).toBe(true);
  });

  it("is false with no Decision open on the Task", () => {
    expect(waitsOnYou(aTask({}), [aDecisionOn("another-task")])).toBe(false);
    expect(waitsOnYou(aTask({}), [])).toBe(false);
  });

  it("leaves In progress to its own Waiting on you state", () => {
    expect(waitsOnYou(aTask({ state: "in-progress" }), [aDecisionOn(TASK_ID)])).toBe(false);
  });
});
