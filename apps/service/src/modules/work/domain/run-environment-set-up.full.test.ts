import { describe, expect, it } from "vitest";
import {
  createRunEnvironmentSetUpTask,
  isOpenRunEnvironmentSetUp,
  RUN_ENVIRONMENT_SET_UP_DEFINITION_OF_DONE,
  SET_UP_RUN_ENVIRONMENT_PIPELINE,
} from "./run-environment-set-up.js";
import { TaskCreated } from "./task-events.js";
import { readinessLines } from "./task-states.js";
import { aTask } from "./work.fixtures.js";

const createdAt = new Date("2026-11-08T10:00:00.000Z");

describe("createRunEnvironmentSetUpTask", () => {
  const { task, event, stateChange } = createRunEnvironmentSetUpTask(
    "task-1",
    { id: "billing", name: "Billing" },
    { order: "a0", createdBy: { kind: "user" } },
    createdAt,
  );

  it("is the Project's set-up Task, Ready on the Set up run environment Pipeline", () => {
    expect(task).toMatchObject({
      id: "task-1",
      title: "Set up the run environment",
      projectId: "billing",
      state: "ready",
      pipelineId: SET_UP_RUN_ENVIRONMENT_PIPELINE,
      madeFor: "run-environment-setup",
      planConfirmed: true,
      definitionOfDone: RUN_ENVIRONMENT_SET_UP_DEFINITION_OF_DONE,
      definitionOfDoneConfirmed: true,
      createdBy: { kind: "user" },
    });
    expect(task.plan).toContain("run environment definition of Billing");
    expect(event).toEqual(new TaskCreated(task));
    expect(stateChange).toEqual({
      from: undefined,
      to: "ready",
      at: createdAt,
      by: { kind: "user" },
    });
  });

  it("meets every condition of Ready", () => {
    expect(readinessLines(task, 0).flatMap(({ problems }) => problems)).toEqual([]);
  });
});

describe("isOpenRunEnvironmentSetUp", () => {
  const setUpTask = aTask({ madeFor: "run-environment-setup" });

  it("is a set-up Task neither Done nor Dropped", () => {
    expect(isOpenRunEnvironmentSetUp({ ...setUpTask, state: "in-progress" })).toBe(true);
    expect(isOpenRunEnvironmentSetUp({ ...setUpTask, state: "done" })).toBe(false);
    expect(isOpenRunEnvironmentSetUp({ ...setUpTask, state: "dropped" })).toBe(false);
    expect(isOpenRunEnvironmentSetUp(aTask({ madeFor: "onboard" }))).toBe(false);
  });
});
