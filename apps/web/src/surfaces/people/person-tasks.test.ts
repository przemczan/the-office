import type { Pipeline, Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { personTasks } from "./person-tasks.ts";

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
    state: "backlog",
    plan: "",
    definitionOfDone: [],
    pipelineId: "full",
    originIdeaId: null,
    createdBy: { kind: "user" },
    createdAt: "2026-10-25T10:00:00.000Z",
    ...fields,
  };
}

describe("personTasks", () => {
  it("names the Stages the person's Role works", () => {
    expect(personTasks("developer", [aTask({})], [FULL])).toEqual([
      { task: aTask({}), part: "Implement · Review & fix" },
    ]);
  });

  it("lists a Task the person created, with no Stage of theirs", () => {
    const created = aTask({ createdBy: { kind: "person", roleKey: "planner" } });

    expect(personTasks("planner", [created], [FULL])).toEqual([
      { task: created, part: "Created it" },
    ]);
  });

  it("leaves out the Tasks the person has no part in", () => {
    expect(personTasks("reviewer", [aTask({})], [FULL])).toEqual([]);
  });
});
