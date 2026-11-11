import type { Initiative, Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  PLANNING_STEP_WORDS,
  planningProgressWords,
  planningStepOf,
} from "./initiative-planning-words.ts";

const PLANNING_THREAD = "8a7b6c5d-4e3f-4a1b-9c0d-1e2f3a4b5c6d";

const INITIATIVE = {
  id: "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
  state: "active",
  planningThreadId: PLANNING_THREAD,
} as Initiative;

function aTask(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    state: "planning",
    markedPlanned: false,
    initiativeId: INITIATIVE.id,
    initiativePlanningThreadId: PLANNING_THREAD,
    ...fields,
  } as Task;
}

describe("a Task of the Initiative with a Decision open", () => {
  const tasks = [
    aTask("asking"),
    aTask("asking-again", { markedPlanned: true }),
    aTask("planning"),
    aTask("ready", { state: "ready", markedPlanned: true }),
    aTask("started", { state: "in-progress" }),
  ];
  const openDecisions = [{ taskId: "asking" }, { taskId: "asking-again" }, { taskId: "started" }];

  it("waits for the user's answer before any other planning step", () => {
    expect(tasks.map((task) => planningStepOf(INITIATIVE, task, openDecisions))).toEqual([
      "answer-awaited",
      "answer-awaited",
      "planning",
      "ready",
      undefined,
    ]);
    expect(PLANNING_STEP_WORDS["answer-awaited"]).toBe("Waiting for your answer");
  });

  it("is counted in the head's summary", () => {
    expect(planningProgressWords(INITIATIVE, tasks, openDecisions)).toBe(
      "1 of 4 Tasks planned · 2 waiting for your answer",
    );
    expect(planningProgressWords(INITIATIVE, tasks, [{ taskId: "asking" }])).toBe(
      "2 of 4 Tasks planned · 1 waiting for your answer",
    );
    expect(planningProgressWords(INITIATIVE, tasks, [])).toBe("2 of 4 Tasks planned");
  });

  it("says nothing before the Initiative is planned", () => {
    const unplanned = { ...INITIATIVE, planningThreadId: null };
    expect(planningStepOf(unplanned, aTask("asking"), openDecisions)).toBeUndefined();
  });
});
