import { describe, expect, it } from "vitest";
import {
  confirmDefinitionOfDone,
  confirmPipeline,
  confirmPlan,
  proposeDefinitionOfDone,
  proposePipeline,
  proposePlan,
} from "./planning-changes.js";
import {
  TaskDefinitionOfDoneConfirmed,
  TaskDefinitionOfDoneProposed,
  TaskPipelineConfirmed,
  TaskPipelineProposed,
  TaskPlanConfirmed,
  TaskPlanProposed,
} from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { aPlannedTask, aTask } from "./work.fixtures.js";

const PLANNING = aTask({ state: "planning" });

describe("proposePlan", () => {
  it("writes the Plan as proposed, also over a confirmed one", () => {
    const change = proposePlan(aPlannedTask(), { plan: "  Keep the path in the sign-in link.  " });

    expect(change?.task).toMatchObject({
      plan: "Keep the path in the sign-in link.",
      planConfirmed: false,
    });
    expect(change?.event).toBeInstanceOf(TaskPlanProposed);
    expect(change?.event).toMatchObject({ taskId: "task-1" });
  });

  it("changes nothing for the same words, so a confirmed Plan stays confirmed", () => {
    const task = aPlannedTask();

    expect(proposePlan(task, { plan: task.plan })).toBeUndefined();
  });

  it("writes the files to change with the Plan, normalized, and keeps them when none are given", () => {
    const change = proposePlan(aPlannedTask(), {
      plan: "Keep the path.",
      filesToChange: [" ./src/auth/ ", "src\\login.ts", "", "src/auth"],
    });

    expect(change?.task.filesToChange).toEqual(["src/auth", "src/login.ts"]);
    const kept = change && proposePlan(change.task, { plan: "Keep the path, and test it." });
    expect(kept?.task.filesToChange).toEqual(["src/auth", "src/login.ts"]);
  });

  it("proposes the Plan again when only its files to change change", () => {
    const task = aPlannedTask();

    const change = proposePlan(task, { plan: task.plan, filesToChange: ["src/login.ts"] });

    expect(change?.task).toMatchObject({ filesToChange: ["src/login.ts"], planConfirmed: false });
  });

  it("refuses outside Planning and an empty Plan, with every reason", () => {
    expect(() => proposePlan(aTask({ state: "ready" }), { plan: " " })).toThrow(
      new TaskRefused([
        "The Plan is proposed while the Task is in Planning; this one is in Ready.",
        "The Plan can't be empty.",
      ]),
    );
  });
});

describe("confirmPlan", () => {
  it("confirms the proposed Plan as it is", () => {
    const proposed = aPlannedTask({ planConfirmed: false });

    const change = confirmPlan(proposed, { plan: proposed.plan });

    expect(change?.task).toMatchObject({ plan: proposed.plan, planConfirmed: true });
    expect(change?.event).toBeInstanceOf(TaskPlanConfirmed);
    expect(change?.event).toMatchObject({ taskId: "task-1" });
  });

  it("takes the user's edit as confirmed, before planning and while Ready too", () => {
    expect(confirmPlan(aTask(), { plan: "Mine." })?.task).toMatchObject({
      plan: "Mine.",
      planConfirmed: true,
    });
    expect(confirmPlan(aPlannedTask({ state: "ready" }), { plan: "Edited." })?.task.plan).toBe(
      "Edited.",
    );
  });

  it("changes nothing when the Plan is already confirmed as it is", () => {
    const task = aPlannedTask();

    expect(confirmPlan(task, { plan: task.plan })).toBeUndefined();
  });

  it("confirms the files to change with the Plan, refusing one outside the repository", () => {
    const task = aPlannedTask({ planConfirmed: false });

    expect(
      confirmPlan(task, { plan: task.plan, filesToChange: ["src/login.ts"] })?.task,
    ).toMatchObject({ filesToChange: ["src/login.ts"], planConfirmed: true });
    expect(() => confirmPlan(task, { plan: task.plan, filesToChange: ["../secrets"] })).toThrow(
      new TaskRefused(["Files to change stay inside the repository: ../secrets."]),
    );
  });

  it("refuses once the Task has started, and an empty Plan", () => {
    expect(() => confirmPlan(aPlannedTask({ state: "in-progress" }), { plan: "" })).toThrow(
      new TaskRefused(["A Task keeps its Plan once it has started.", "The Plan can't be empty."]),
    );
  });
});

describe("proposeDefinitionOfDone", () => {
  it("writes the statements, trimmed, as proposed", () => {
    const change = proposeDefinitionOfDone(PLANNING, [" Signing in returns to the page. "]);

    expect(change?.task).toMatchObject({
      definitionOfDone: ["Signing in returns to the page."],
      definitionOfDoneConfirmed: false,
    });
    expect(change?.event).toBeInstanceOf(TaskDefinitionOfDoneProposed);
    expect(change?.event).toMatchObject({ taskId: "task-1" });
  });

  it("changes nothing for the same statements", () => {
    const task = aPlannedTask();

    expect(proposeDefinitionOfDone(task, [...task.definitionOfDone])).toBeUndefined();
  });

  it("refuses no statements and an empty one", () => {
    expect(() => proposeDefinitionOfDone(PLANNING, [])).toThrow(
      new TaskRefused(["A Definition of Done needs at least one statement."]),
    );
    expect(() => proposeDefinitionOfDone(PLANNING, ["One.", " "])).toThrow(
      new TaskRefused(["A statement of the Definition of Done can't be empty."]),
    );
  });

  it("refuses outside Planning", () => {
    expect(() => proposeDefinitionOfDone(aTask(), ["One."])).toThrow(
      new TaskRefused([
        "The Definition of Done is proposed while the Task is in Planning; this one is in Backlog.",
      ]),
    );
  });
});

describe("confirmDefinitionOfDone", () => {
  it("confirms the statements the user gives", () => {
    const change = confirmDefinitionOfDone(aPlannedTask({ definitionOfDoneConfirmed: false }), [
      "Signing in returns the user to the page they asked for.",
      "The old redirect is gone.",
    ]);

    expect(change?.task).toMatchObject({
      definitionOfDone: [
        "Signing in returns the user to the page they asked for.",
        "The old redirect is gone.",
      ],
      definitionOfDoneConfirmed: true,
    });
    expect(change?.event).toBeInstanceOf(TaskDefinitionOfDoneConfirmed);
    expect(change?.event).toMatchObject({ taskId: "task-1" });
  });

  it("changes nothing when already confirmed as it is, and refuses once started", () => {
    const task = aPlannedTask();

    expect(confirmDefinitionOfDone(task, [...task.definitionOfDone])).toBeUndefined();
    expect(() => confirmDefinitionOfDone({ ...task, state: "done" }, ["One."])).toThrow(
      new TaskRefused(["A Task keeps its Definition of Done once it has started."]),
    );
  });
});

describe("proposePipeline", () => {
  it("keeps the proposal beside the Task's Pipeline, which stays until confirmed", () => {
    const change = proposePipeline(PLANNING, {
      pipelineId: "quick-fix",
      reason: " One small change, tested. ",
    });

    expect(change?.task).toMatchObject({
      pipelineId: "full",
      proposedPipeline: { pipelineId: "quick-fix", reason: "One small change, tested." },
    });
    expect(change?.event).toBeInstanceOf(TaskPipelineProposed);
    expect(change?.event).toMatchObject({ taskId: "task-1", pipelineId: "quick-fix" });
  });

  it("changes nothing for the same proposal, and refuses one without a reason", () => {
    const proposed = aTask({
      state: "planning",
      proposedPipeline: { pipelineId: "document", reason: "A report." },
    });

    expect(proposePipeline(proposed, { pipelineId: "document", reason: "A report." })).toBe(
      undefined,
    );
    expect(() => proposePipeline(proposed, { pipelineId: "full", reason: "" })).toThrow(
      new TaskRefused(["Say why the Pipeline fits the Definition of Done."]),
    );
  });
});

describe("confirmPipeline", () => {
  it("sets the Task's Pipeline and ends the proposal", () => {
    const proposed = aTask({
      state: "planning",
      proposedPipeline: { pipelineId: "quick-fix", reason: "Small." },
    });

    const change = confirmPipeline(proposed, "quick-fix");

    expect(change?.task).toMatchObject({ pipelineId: "quick-fix", proposedPipeline: undefined });
    expect(change?.event).toBeInstanceOf(TaskPipelineConfirmed);
    expect(change?.event).toMatchObject({ taskId: "task-1", pipelineId: "quick-fix" });
  });

  it("takes another Pipeline the user chose, and changes nothing for the one it follows", () => {
    expect(confirmPipeline(aTask(), "document")?.task.pipelineId).toBe("document");
    expect(confirmPipeline(aTask(), "full")).toBeUndefined();
  });

  it("refuses once the Task has started", () => {
    expect(() => confirmPipeline(aTask({ state: "in-progress" }), "document")).toThrow(
      new TaskRefused(["A Task keeps its Pipeline once it has started."]),
    );
  });
});
