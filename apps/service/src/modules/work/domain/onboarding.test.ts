import { describe, expect, it } from "vitest";
import {
  createOnboardTask,
  ONBOARD_PIPELINE,
  ONBOARD_TASK_DEFINITION_OF_DONE,
  projectOnboardingOf,
} from "./onboarding.js";
import { TaskCreated } from "./task-events.js";
import { readinessLines } from "./task-states.js";
import { aTask } from "./work.fixtures.js";

const createdAt = new Date("2026-10-28T10:00:00.000Z");

describe("createOnboardTask", () => {
  const { task, event } = createOnboardTask(
    "task-1",
    { id: "billing", name: "Billing" },
    { order: "a0", createdBy: { kind: "person", roleKey: "devops" } },
    createdAt,
  );

  it("is the Project's Onboard Task, Ready on the Onboard Pipeline", () => {
    expect(task).toMatchObject({
      id: "task-1",
      title: "Onboard",
      projectId: "billing",
      state: "ready",
      pipelineId: ONBOARD_PIPELINE,
      proposedPipeline: undefined,
      isOnboardTask: true,
      definitionOfDone: ONBOARD_TASK_DEFINITION_OF_DONE,
      createdBy: { kind: "person", roleKey: "devops" },
    });
    expect(task.plan).toContain("Make Billing build and test in a fresh worktree");
    expect(event).toEqual(new TaskCreated(task));
  });

  it("asks of Devops only what holds in the Onboard Stage, with or without fixes to make", () => {
    expect(task.definitionOfDone.at(-1)).toContain("for Publish to ship");
    expect(task.definitionOfDone.at(-1)).toContain("a repository that needed none meets this");
    expect(task.plan).toContain("needs no fixes is onboarded as it is");
  });

  it("meets every condition of Ready", () => {
    expect(readinessLines(task, 0).flatMap(({ problems }) => problems)).toEqual([]);
  });
});

describe("projectOnboardingOf", () => {
  const onboardTask = aTask({ id: "task-1", projectId: "billing", isOnboardTask: true });

  it("is onboarding until the Onboard Task is done, then onboarded", () => {
    expect(projectOnboardingOf({ ...onboardTask, state: "in-progress" })).toEqual({
      projectId: "billing",
      taskId: "task-1",
      state: "onboarding",
    });
    expect(projectOnboardingOf({ ...onboardTask, state: "done" })?.state).toBe("onboarded");
  });

  it("is none for a dropped Onboard Task and for any other Task", () => {
    expect(projectOnboardingOf({ ...onboardTask, state: "dropped" })).toBeUndefined();
    expect(projectOnboardingOf(aTask({ pipelineId: ONBOARD_PIPELINE }))).toBeUndefined();
  });
});
