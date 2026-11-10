import { describe, expect, it } from "vitest";
import { THE_USER } from "./author.js";
import {
  acceptInAutoMode,
  confirmDefinitionOfDone,
  confirmPipeline,
  confirmPlan,
  proposeDefinitionOfDone,
  proposePipeline,
  proposePlan,
  saveDefinitionOfDone,
  savePlan,
} from "./planning-changes.js";
import {
  TaskDefinitionOfDoneConfirmed,
  TaskDefinitionOfDoneProposed,
  TaskDefinitionOfDoneSaved,
  TaskPipelineConfirmed,
  TaskPipelineProposed,
  TaskPlanConfirmed,
  TaskPlanProposed,
  TaskPlanSaved,
  TaskStateChanged,
} from "./task-events.js";
import { changeTaskState } from "./task-changes.js";
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

  it("writes the token estimate with the Plan, keeps it when none is given and proposes again when only it changes", () => {
    const task = aPlannedTask();

    const change = proposePlan(task, { plan: task.plan, estimatedTokens: 120_000 });
    const kept = change && proposePlan(change.task, { plan: "Keep the path, and test it." });

    expect(change?.task).toMatchObject({ estimatedTokens: 120_000, planConfirmed: false });
    expect(kept?.task.estimatedTokens).toBe(120_000);
    expect(change && proposePlan(change.task, { plan: task.plan })).toBeUndefined();
  });

  it("refuses a token estimate that isn't a whole number above 0", () => {
    const task = aPlannedTask();

    for (const estimatedTokens of [0, -5, 1.5]) {
      expect(() => proposePlan(task, { plan: task.plan, estimatedTokens })).toThrow(
        new TaskRefused(["The token estimate must be a whole number above 0."]),
      );
    }
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

describe("savePlan", () => {
  it("writes the user's Plan without confirming it, before planning too", () => {
    const change = savePlan(aTask(), { plan: "  Mine.  " });

    expect(change?.task).toMatchObject({ plan: "Mine.", planConfirmed: false, state: "backlog" });
    expect(change?.event).toBeInstanceOf(TaskPlanSaved);
    expect(change?.event).toMatchObject({ taskId: "task-1", leftReady: undefined });
    expect(change?.stateChange).toBeUndefined();
  });

  it("leaves a confirmed Plan unconfirmed once changed, and the Task in Planning", () => {
    const task = aPlannedTask({ state: "planning" });

    expect(savePlan(task, { plan: "Edited." })?.task).toMatchObject({
      plan: "Edited.",
      planConfirmed: false,
      state: "planning",
      definitionOfDoneConfirmed: true,
    });
  });

  it("changes nothing for the same Plan, in the part's confirmation either way", () => {
    const confirmed = aPlannedTask();
    const unconfirmed = aPlannedTask({ planConfirmed: false });

    expect(savePlan(confirmed, { plan: ` ${confirmed.plan} ` })).toBeUndefined();
    expect(savePlan(unconfirmed, { plan: unconfirmed.plan })).toBeUndefined();
    expect(savePlan(aPlannedTask({ state: "ready" }), { plan: confirmed.plan })).toBeUndefined();
  });

  it("counts a change to the files to change, refusing one outside the repository", () => {
    const task = aPlannedTask();

    expect(
      savePlan(task, { plan: task.plan, filesToChange: ["src/login.ts"] })?.task,
    ).toMatchObject({ filesToChange: ["src/login.ts"], planConfirmed: false });
    expect(() => savePlan(task, { plan: task.plan, filesToChange: ["../secrets"] })).toThrow(
      new TaskRefused(["Files to change stay inside the repository: ../secrets."]),
    );
  });

  it("moves a Ready Task to Backlog, keeping the move as the user's", () => {
    const change = savePlan(aPlannedTask({ state: "ready" }), { plan: "Edited." });

    expect(change?.task).toMatchObject({
      plan: "Edited.",
      planConfirmed: false,
      state: "backlog",
      definitionOfDoneConfirmed: true,
    });
    expect(change?.event.leftReady).toBeInstanceOf(TaskStateChanged);
    expect(change?.event.leftReady).toMatchObject({
      taskId: "task-1",
      from: "ready",
      to: "backlog",
    });
    expect(change?.stateChange).toMatchObject({
      from: "ready",
      to: "backlog",
      by: { kind: "user" },
    });
  });

  it("is the only way back from Ready: nobody can ask for that move", () => {
    expect(() => changeTaskState(aPlannedTask({ state: "ready" }), "backlog", THE_USER)).toThrow(
      new TaskRefused(["A Task in Ready can't move to Backlog."]),
    );
  });

  it("refuses once the Task has started, and an empty Plan", () => {
    expect(() => savePlan(aPlannedTask({ state: "in-progress" }), { plan: "" })).toThrow(
      new TaskRefused(["A Task keeps its Plan once it has started.", "The Plan can't be empty."]),
    );
  });
});

describe("confirmPlan", () => {
  it("confirms the Plan as it reads", () => {
    const unconfirmed = aPlannedTask({ planConfirmed: false, filesToChange: ["src/login.ts"] });

    const change = confirmPlan(unconfirmed);

    expect(change?.task).toEqual({ ...unconfirmed, planConfirmed: true });
    expect(change?.event).toBeInstanceOf(TaskPlanConfirmed);
    expect(change?.event).toMatchObject({ taskId: "task-1" });
  });

  it("changes nothing when the Plan is already confirmed", () => {
    expect(confirmPlan(aPlannedTask())).toBeUndefined();
  });

  it("refuses a Plan not written, and once the Task has started", () => {
    expect(() => confirmPlan(aTask())).toThrow(new TaskRefused(["The Plan can't be empty."]));
    expect(() => confirmPlan(aPlannedTask({ state: "in-progress" }))).toThrow(
      new TaskRefused(["A Task keeps its Plan once it has started."]),
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

describe("saveDefinitionOfDone", () => {
  it("writes the statements, trimmed, without confirming them", () => {
    const change = saveDefinitionOfDone(aPlannedTask({ state: "planning" }), [" Mine. "]);

    expect(change?.task).toMatchObject({
      definitionOfDone: ["Mine."],
      definitionOfDoneConfirmed: false,
      state: "planning",
      planConfirmed: true,
    });
    expect(change?.event).toBeInstanceOf(TaskDefinitionOfDoneSaved);
    expect(change?.event).toMatchObject({ taskId: "task-1", leftReady: undefined });
  });

  it("changes nothing for the same statements, in the part's confirmation either way", () => {
    const confirmed = aPlannedTask();
    const unconfirmed = aPlannedTask({ definitionOfDoneConfirmed: false });

    expect(saveDefinitionOfDone(confirmed, [...confirmed.definitionOfDone])).toBeUndefined();
    expect(saveDefinitionOfDone(unconfirmed, [...unconfirmed.definitionOfDone])).toBeUndefined();
  });

  it("moves a Ready Task to Backlog, keeping the move as the user's", () => {
    const change = saveDefinitionOfDone(aPlannedTask({ state: "ready" }), ["Mine."]);

    expect(change?.task).toMatchObject({
      state: "backlog",
      definitionOfDoneConfirmed: false,
      planConfirmed: true,
    });
    expect(change?.event.leftReady).toMatchObject({ from: "ready", to: "backlog" });
    expect(change?.stateChange).toMatchObject({ to: "backlog", by: { kind: "user" } });
  });

  it("refuses no statements, and once the Task has started", () => {
    expect(() => saveDefinitionOfDone(aPlannedTask(), [])).toThrow(
      new TaskRefused(["A Definition of Done needs at least one statement."]),
    );
    expect(() => saveDefinitionOfDone(aPlannedTask({ state: "done" }), ["One."])).toThrow(
      new TaskRefused(["A Task keeps its Definition of Done once it has started."]),
    );
  });
});

describe("confirmDefinitionOfDone", () => {
  it("confirms the statements as they read", () => {
    const unconfirmed = aPlannedTask({ definitionOfDoneConfirmed: false });

    const change = confirmDefinitionOfDone(unconfirmed);

    expect(change?.task).toEqual({ ...unconfirmed, definitionOfDoneConfirmed: true });
    expect(change?.event).toBeInstanceOf(TaskDefinitionOfDoneConfirmed);
    expect(change?.event).toMatchObject({ taskId: "task-1" });
  });

  it("changes nothing when already confirmed, and refuses one not written or once started", () => {
    const task = aPlannedTask();

    expect(confirmDefinitionOfDone(task)).toBeUndefined();
    expect(() => confirmDefinitionOfDone(aTask())).toThrow(
      new TaskRefused(["A Definition of Done needs at least one statement."]),
    );
    expect(() => confirmDefinitionOfDone({ ...task, state: "done" })).toThrow(
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

  it("refuses a Task in Shaping, with what it waits for", () => {
    expect(() => confirmPipeline(aTask({ state: "shaping" }), "document")).toThrow(
      new TaskRefused([
        "A Task in Shaping keeps its Pipeline as it is: confirm its Initiative first.",
      ]),
    );
  });
});

describe("acceptInAutoMode", () => {
  const PROPOSED = aPlannedTask({
    autoMode: true,
    planConfirmed: false,
    definitionOfDoneConfirmed: false,
    proposedPipeline: { pipelineId: "document", reason: "A report." },
  });

  it("confirms every part, the proposed Pipeline among them, and marks the Task Ready by auto mode", () => {
    const change = acceptInAutoMode(PROPOSED, 0);

    expect(change.task).toMatchObject({
      state: "ready",
      planConfirmed: true,
      definitionOfDoneConfirmed: true,
      pipelineId: "document",
      proposedPipeline: undefined,
    });
    expect(change.event.confirmations.map((event) => event.constructor)).toEqual([
      TaskPlanConfirmed,
      TaskDefinitionOfDoneConfirmed,
      TaskPipelineConfirmed,
    ]);
    expect(change.event.stateChanged).toMatchObject({ from: "planning", to: "ready" });
    expect(change.stateChange?.by).toEqual({
      kind: "auto-mode",
      confirmed: [
        { part: "plan" },
        { part: "definition-of-done" },
        { part: "pipeline", pipelineId: "document" },
      ],
    });
  });

  it("confirms only what isn't confirmed yet, and keeps the Pipeline the Task follows with none proposed", () => {
    const change = acceptInAutoMode(
      aPlannedTask({ autoMode: true, definitionOfDoneConfirmed: false }),
      0,
    );

    expect(change.task).toMatchObject({ state: "ready", pipelineId: "full" });
    expect(change.event.confirmations).toHaveLength(1);
    expect(change.stateChange?.by).toEqual({
      kind: "auto-mode",
      confirmed: [{ part: "definition-of-done" }],
    });
  });

  it("refuses outside Planning, without both parts, outside auto mode and with a Decision open", () => {
    expect(() => acceptInAutoMode({ ...PROPOSED, state: "backlog" }, 0)).toThrow(
      new TaskRefused([
        "A Task is marked planned while it is in Planning; this one is in Backlog.",
      ]),
    );
    expect(() => acceptInAutoMode({ ...PROPOSED, plan: "", definitionOfDone: [] }, 0)).toThrow(
      new TaskRefused([
        "Write the Plan first, with write_plan.",
        "Write the Definition of Done first, with write_definition_of_done.",
      ]),
    );
    expect(() => acceptInAutoMode({ ...PROPOSED, autoMode: false }, 0)).toThrow(
      new TaskRefused([
        "This Task isn't planned in auto mode: the user confirms it and marks it Ready.",
      ]),
    );
    expect(() => acceptInAutoMode(PROPOSED, 1)).toThrow(TaskRefused);
  });
});
