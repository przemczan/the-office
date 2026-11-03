import type { Decision, Pipeline, Task, Thread } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { inFilter, personTasks, WORK_FILTERS, type WorkFilter } from "./person-tasks.ts";

const FULL: Pipeline = {
  id: "full",
  name: "Full",
  description: "",
  stages: [
    {
      kind: "agent",
      key: "implement",
      name: "Implement",
      role: "developer",
      brief: "",
      session: "fresh",
      budget: 1,
      optional: false,
    },
    { kind: "script", key: "tests", name: "Tests", command: "test", optional: false },
    {
      kind: "agent",
      key: "review-and-fix",
      name: "Review & fix",
      role: "developer",
      brief: "",
      session: "fresh",
      budget: 1,
      optional: false,
    },
  ],
};

function aTask(fields: Partial<Task>): Task {
  return {
    id: "6f1c2c0e-2f0a-4f39-9a49-5d8b0c1e2a33",
    title: "Fix the login redirect",
    projectId: "admin-panel",
    priority: "normal",
    tags: [],
    state: "backlog",
    plan: "",
    pausedByAlarm: false,
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
    createdBy: { kind: "user" },
    createdAt: "2026-10-25T10:00:00.000Z",
    ...fields,
  };
}

function aThreadOn(taskId: string, fields: Partial<Thread>): Thread {
  return {
    id: "0b4cbb0e-5a51-4a52-9a4e-7c0f3c1b9f10",
    home: { kind: "task", taskId },
    roleKey: "planner",
    title: "Planning",
    state: "waiting",
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    context: {
      move: "resume",
      reason: "cache-warm",
      cacheWarm: true,
      contextTokens: 32_000,
      briefTokens: null,
      alternatives: [],
      override: null,
    },
    startedAt: "2026-10-26T09:00:00.000Z",
    stageThread: false,
    consultation: null,
    changesAllowed: null,
    ...fields,
  };
}

describe("personTasks", () => {
  it("names the Stages the person's Role works", () => {
    expect(personTasks("developer", [aTask({})], [FULL], [])).toEqual([
      { task: aTask({}), part: "Implement · Review & fix" },
    ]);
  });

  it("lists a Task the person created, with no Stage of theirs", () => {
    const created = aTask({ createdBy: { kind: "person", roleKey: "planner" } });

    expect(personTasks("planner", [created], [FULL], [])).toEqual([
      { task: created, part: "Created it" },
    ]);
  });

  it("names the Threads on the Task with the person, once each, beside their other parts", () => {
    const task = aTask({ createdBy: { kind: "person", roleKey: "planner" } });
    const threads = [
      aThreadOn(task.id, {}),
      aThreadOn(task.id, { id: "5d1f3c3a-9f62-4c2e-8a8f-2b7e6a7d0c11" }),
      aThreadOn("another-task", { title: "Implement" }),
    ];

    expect(personTasks("planner", [task], [FULL], threads)).toEqual([
      { task, part: "Created it · Planning" },
    ]);
  });

  it("leaves out the Tasks the person has no part in", () => {
    expect(personTasks("reviewer", [aTask({})], [FULL], [])).toEqual([]);
  });
});

describe("the Work tab's filters", () => {
  const waitingFilter = WORK_FILTERS.find(({ key }) => key === "waiting-on-you") as WorkFilter;
  const notStarted = WORK_FILTERS.find(({ key }) => key === "not-started") as WorkFilter;
  const planning = aTask({ state: "planning" });
  const decision: Decision = {
    id: "2a9e1f4c-7d3b-4c8e-9f1a-6b5d4c3e2f10",
    threadId: "0b4cbb0e-5a51-4a52-9a4e-7c0f3c1b9f10",
    taskId: planning.id,
    roleKey: "planner",
    question: "Keep the query string on the way back?",
    context: "",
    options: ["Keep it", "Drop it"],
    recommendation: { option: 0, reason: "Filters live there." },
    askedAt: "2026-10-26T09:00:00.000Z",
    answer: null,
    answeredAt: null,
    putTo: null,
    passedOn: [],
    answeredBy: null,
  };

  it("count a Task planning with a Decision open as Waiting on you, and still not started", () => {
    const personTask = { task: planning, part: "Planning" };

    expect(inFilter(waitingFilter, personTask, [decision])).toBe(true);
    expect(inFilter(notStarted, personTask, [decision])).toBe(true);
    expect(inFilter(waitingFilter, personTask, [])).toBe(false);
  });

  it("count a Task in the Waiting on you state as Waiting on you", () => {
    const waiting = { task: aTask({ state: "waiting-on-you" }), part: "Implement" };

    expect(inFilter(waitingFilter, waiting, [])).toBe(true);
  });
});
