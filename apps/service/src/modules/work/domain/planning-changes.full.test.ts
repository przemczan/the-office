import { describe, expect, it } from "vitest";
import {
  acceptInAutoMode,
  markingPlannedProblems,
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
import { ANN_LEE, aPlannedTask, aTask } from "./work.fixtures.js";

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

  it("refuses outside Planning and Ready and an empty Plan, with every reason", () => {
    expect(() => proposePlan(aTask({ state: "backlog" }), { plan: " " })).toThrow(
      new TaskRefused([
        "The Plan is proposed while the Task is in Planning or Ready, before it starts; this one is in Backlog.",
        "The Plan can't be empty.",
      ]),
    );
  });
});

describe("the Planner's writes on a Ready Task", () => {
  const byThePlanner = { kind: "person", roleKey: "planner" };
  const ready = aPlannedTask({
    state: "ready",
    markedPlanned: true,
    autoMode: true,
    initiativePlanningThreadId: "initiative-thread",
  });

  it("takes it back to Planning in the same save, moved by the Planner, the Plan Not confirmed", () => {
    const change = proposePlan(ready, { plan: "A Plan the user asked to change." });

    expect(change?.task).toMatchObject({
      state: "planning",
      plan: "A Plan the user asked to change.",
      planConfirmed: false,
      definitionOfDoneConfirmed: true,
      markedPlanned: false,
      autoMode: true,
      initiativePlanningThreadId: undefined,
      hasPlanningThread: true,
    });
    expect(change?.event.leftReady).toBeInstanceOf(TaskStateChanged);
    expect(change?.event.leftReady).toMatchObject({ from: "ready", to: "planning" });
    expect(change?.stateChange).toMatchObject({
      from: "ready",
      to: "planning",
      by: byThePlanner,
    });
  });

  it("does the same for the Definition of Done and a Pipeline", () => {
    const definitionOfDone = proposeDefinitionOfDone(ready, ["A statement the user asked for."]);
    const pipeline = proposePipeline(ready, { pipelineId: "quick-fix", reason: "One change." });

    expect(definitionOfDone?.task).toMatchObject({
      state: "planning",
      definitionOfDoneConfirmed: false,
      planConfirmed: true,
      markedPlanned: false,
    });
    expect(definitionOfDone?.event.leftReady).toMatchObject({ from: "ready", to: "planning" });
    expect(definitionOfDone?.stateChange).toMatchObject({ to: "planning", by: byThePlanner });
    expect(pipeline?.task).toMatchObject({ state: "planning", markedPlanned: false });
    expect(pipeline?.event.leftReady).toMatchObject({ from: "ready", to: "planning" });
    expect(pipeline?.stateChange).toMatchObject({ to: "planning", by: byThePlanner });
  });

  it("moves nothing when the write changes nothing", () => {
    expect(proposePlan(ready, { plan: ready.plan })).toBeUndefined();
    expect(proposeDefinitionOfDone(ready, [...ready.definitionOfDone])).toBeUndefined();
  });

  it("leaves a Task in Planning in Planning, publishing no move", () => {
    const change = proposePlan(aPlannedTask({ markedPlanned: true }), { plan: "Changed." });

    expect(change?.task).toMatchObject({ state: "planning", markedPlanned: false });
    expect(change?.event.leftReady).toBeUndefined();
    expect(change?.stateChange).toBeUndefined();
  });

  it("refuses a Task that has started, is Done or is Dropped, with the reason", () => {
    for (const state of ["in-progress", "done", "dropped"] as const) {
      expect(() => proposePlan(aPlannedTask({ state }), { plan: "Changed." })).toThrow(
        /^The Plan is proposed while the Task is in Planning or Ready, before it starts; this one is in /,
      );
      expect(() => proposeDefinitionOfDone(aPlannedTask({ state }), ["Changed."])).toThrow(
        TaskRefused,
      );
      expect(() =>
        proposePipeline(aPlannedTask({ state }), { pipelineId: "full", reason: "Fits." }),
      ).toThrow(TaskRefused);
    }
  });
});

describe("savePlan", () => {
  it("writes the user's Plan without confirming it, before planning too", () => {
    const change = savePlan(aTask(), { plan: "  Mine.  " }, ANN_LEE);

    expect(change?.task).toMatchObject({ plan: "Mine.", planConfirmed: false, state: "backlog" });
    expect(change?.event).toBeInstanceOf(TaskPlanSaved);
    expect(change?.event).toMatchObject({ taskId: "task-1", leftReady: undefined });
    expect(change?.stateChange).toBeUndefined();
  });

  it("leaves a confirmed Plan unconfirmed once changed, and the Task in Planning", () => {
    const task = aPlannedTask({ state: "planning" });

    expect(savePlan(task, { plan: "Edited." }, ANN_LEE)?.task).toMatchObject({
      plan: "Edited.",
      planConfirmed: false,
      state: "planning",
      definitionOfDoneConfirmed: true,
    });
  });

  it("changes nothing for the same Plan, in the part's confirmation either way", () => {
    const confirmed = aPlannedTask();
    const unconfirmed = aPlannedTask({ planConfirmed: false });

    expect(savePlan(confirmed, { plan: ` ${confirmed.plan} ` }, ANN_LEE)).toBeUndefined();
    expect(savePlan(unconfirmed, { plan: unconfirmed.plan }, ANN_LEE)).toBeUndefined();
    expect(
      savePlan(aPlannedTask({ state: "ready" }), { plan: confirmed.plan }, ANN_LEE),
    ).toBeUndefined();
  });

  it("counts a change to the files to change, refusing one outside the repository", () => {
    const task = aPlannedTask();

    expect(
      savePlan(task, { plan: task.plan, filesToChange: ["src/login.ts"] }, ANN_LEE)?.task,
    ).toMatchObject({ filesToChange: ["src/login.ts"], planConfirmed: false });
    expect(() =>
      savePlan(task, { plan: task.plan, filesToChange: ["../secrets"] }, ANN_LEE),
    ).toThrow(new TaskRefused(["Files to change stay inside the repository: ../secrets."]));
  });

  it("moves a planned Ready Task back to Planning, keeping its Thread and auto mode, the move the user's", () => {
    const ready = aPlannedTask({
      state: "ready",
      markedPlanned: true,
      autoMode: true,
      initiativePlanningThreadId: "initiative-thread",
    });

    const change = savePlan(ready, { plan: "Edited." }, ANN_LEE);

    expect(change?.task).toMatchObject({
      plan: "Edited.",
      planConfirmed: false,
      state: "planning",
      definitionOfDoneConfirmed: true,
      markedPlanned: false,
      autoMode: true,
      initiativePlanningThreadId: "initiative-thread",
    });
    expect(change?.event.leftReady).toBeInstanceOf(TaskStateChanged);
    expect(change?.event.leftReady).toMatchObject({
      taskId: "task-1",
      from: "ready",
      to: "planning",
    });
    expect(change?.stateChange).toMatchObject({
      from: "ready",
      to: "planning",
      by: { kind: "user" },
    });
  });

  it("moves a Ready Task never planned (marked Ready from Backlog) to Backlog", () => {
    const change = savePlan(
      aPlannedTask({ state: "ready", hasPlanningThread: false }),
      {
        plan: "Edited.",
      },
      ANN_LEE,
    );

    expect(change?.task).toMatchObject({ state: "backlog", planConfirmed: false });
    expect(change?.event.leftReady).toMatchObject({ from: "ready", to: "backlog" });
    expect(change?.stateChange).toMatchObject({ to: "backlog", by: { kind: "user" } });
  });

  it("is the only way back from Ready: nobody can ask for that move", () => {
    expect(() => changeTaskState(aPlannedTask({ state: "ready" }), "backlog", ANN_LEE)).toThrow(
      new TaskRefused(["A Task in Ready can't move to Backlog."]),
    );
  });

  it("refuses once the Task has started, and an empty Plan", () => {
    expect(() => savePlan(aPlannedTask({ state: "in-progress" }), { plan: "" }, ANN_LEE)).toThrow(
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

  it("refuses outside Planning and Ready", () => {
    expect(() => proposeDefinitionOfDone(aTask(), ["One."])).toThrow(
      new TaskRefused([
        "The Definition of Done is proposed while the Task is in Planning or Ready, before it starts; this one is in Backlog.",
      ]),
    );
  });
});

describe("saveDefinitionOfDone", () => {
  it("writes the statements, trimmed, without confirming them", () => {
    const change = saveDefinitionOfDone(aPlannedTask({ state: "planning" }), [" Mine. "], ANN_LEE);

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

    expect(
      saveDefinitionOfDone(confirmed, [...confirmed.definitionOfDone], ANN_LEE),
    ).toBeUndefined();
    expect(
      saveDefinitionOfDone(unconfirmed, [...unconfirmed.definitionOfDone], ANN_LEE),
    ).toBeUndefined();
  });

  it("moves a planned Ready Task back to Planning, and one never planned to Backlog, the user's moves", () => {
    const planned = saveDefinitionOfDone(aPlannedTask({ state: "ready" }), ["Mine."], ANN_LEE);
    const neverPlanned = saveDefinitionOfDone(
      aPlannedTask({ state: "ready", hasPlanningThread: false }),
      ["Mine."],
      ANN_LEE,
    );

    expect(planned?.task).toMatchObject({
      state: "planning",
      definitionOfDoneConfirmed: false,
      planConfirmed: true,
      markedPlanned: false,
    });
    expect(planned?.event.leftReady).toMatchObject({ from: "ready", to: "planning" });
    expect(planned?.stateChange).toMatchObject({ to: "planning", by: { kind: "user" } });
    expect(neverPlanned?.task).toMatchObject({
      state: "backlog",
      definitionOfDoneConfirmed: false,
    });
    expect(neverPlanned?.event.leftReady).toMatchObject({ from: "ready", to: "backlog" });
    expect(neverPlanned?.stateChange).toMatchObject({ to: "backlog", by: { kind: "user" } });
  });

  it("refuses no statements, and once the Task has started", () => {
    expect(() => saveDefinitionOfDone(aPlannedTask(), [], ANN_LEE)).toThrow(
      new TaskRefused(["A Definition of Done needs at least one statement."]),
    );
    expect(() => saveDefinitionOfDone(aPlannedTask({ state: "done" }), ["One."], ANN_LEE)).toThrow(
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

  it("gives a Task with no Pipeline the proposed one, and refuses it with none proposed", () => {
    const noPipeline = { ...PROPOSED, pipelineId: undefined };

    expect(acceptInAutoMode(noPipeline, 0).task).toMatchObject({
      state: "ready",
      pipelineId: "document",
    });
    expect(() => acceptInAutoMode({ ...noPipeline, proposedPipeline: undefined }, 0)).toThrow(
      new TaskRefused([
        "The Task has no Pipeline yet: propose a Pipeline with propose_pipeline first.",
      ]),
    );
  });
});

describe("markingPlannedProblems", () => {
  it("refuses a Task with neither a Pipeline nor a proposed one, with the reason", () => {
    const planning = aPlannedTask({ state: "planning", pipelineId: undefined });

    expect(markingPlannedProblems(planning)).toEqual([
      "The Task has no Pipeline yet: propose a Pipeline with propose_pipeline first.",
    ]);
    expect(
      markingPlannedProblems({
        ...planning,
        proposedPipeline: { pipelineId: "full", reason: "It changes code." },
      }),
    ).toEqual([]);
  });
});
