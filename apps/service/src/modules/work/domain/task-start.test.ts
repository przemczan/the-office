import { describe, expect, it } from "vitest";
import type { Task } from "./task.js";
import { TaskStarted } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { startProblems, startTask, type StartConditions } from "./task-start.js";
import { aTask } from "./work.fixtures.js";

const ready = aTask({ id: "task-ready", state: "ready", projectId: "admin-panel" });

const conditions: StartConditions = {
  projectName: "Admin panel",
  stages: [
    { name: "Implement", role: "developer" },
    { name: "Tests" },
    { name: "Review & fix", role: "reviewer" },
  ],
  person: { name: "Ada", taskLimit: 2 },
  officeWideLimit: 3,
};

/** A Task already started elsewhere, by default on another Project and another person. */
function started(id: string, fields: Partial<Task> = {}): Task {
  return aTask({
    id,
    title: `Task ${id}`,
    projectId: `project-${id}`,
    state: "in-progress",
    personRole: "planner",
    ...fields,
  });
}

describe("startTask", () => {
  it("moves a Ready Task to In progress, counted against its first Agent Stage's Role", () => {
    const { task, event } = startTask(ready, conditions, []);

    expect(task).toEqual({ ...ready, state: "in-progress", personRole: "developer" });
    expect(event).toBeInstanceOf(TaskStarted);
    expect(event).toMatchObject({ taskId: "task-ready", pipelineId: ready.pipelineId });
  });

  it("counts against nobody when the Pipeline has no Agent Stage", () => {
    const scriptsOnly = { ...conditions, stages: [{ name: "Tests" }], person: undefined };

    expect(startTask(ready, scriptsOnly, []).task.personRole).toBeUndefined();
  });

  it("refuses with every reason", () => {
    const others = [
      started("a", { projectId: "admin-panel", title: "Fix the login redirect" }),
      started("b", { personRole: "developer" }),
      started("c", { personRole: "developer" }),
    ];

    expect(() => startTask(ready, conditions, others)).toThrow(
      new TaskRefused([
        'Admin panel already has a Task in progress: "Fix the login redirect".',
        "The Office-wide limit is reached: all 3 desks are in use.",
        "Ada is at the Task limit (2).",
      ]),
    );
  });
});

describe("startProblems", () => {
  it("is empty when the Task can start", () => {
    expect(startProblems(ready, conditions, [started("a"), started("b")])).toEqual([]);
  });

  it("refuses a Task that isn't Ready", () => {
    expect(startProblems({ ...ready, state: "planning" }, conditions, [])).toEqual([
      "Only a Ready Task can start; this one is in Planning.",
    ]);
  });

  it("refuses a Pipeline the library doesn't have", () => {
    expect(startProblems(ready, { ...conditions, stages: undefined }, [])).toEqual([
      `There is no Pipeline "${ready.pipelineId}" in the library.`,
    ]);
  });

  it.each(["in-progress", "waiting-on-you", "paused"] as const)(
    "refuses while the Project has a Task %s",
    (state) => {
      const other = started("a", { state, projectId: "admin-panel", title: "Export as CSV" });

      expect(startProblems(ready, conditions, [other])).toEqual([
        'Admin panel already has a Task in progress: "Export as CSV".',
      ]);
    },
  );

  it.each(["in-progress", "waiting-on-you", "paused"] as const)(
    "counts a Task %s against the Office-wide limit",
    (state) => {
      const others = [started("a", { state }), started("b"), started("c")];

      expect(startProblems(ready, conditions, others)).toEqual([
        "The Office-wide limit is reached: all 3 desks are in use.",
      ]);
    },
  );

  it("refuses when more Tasks are started than a lowered Office-wide limit allows", () => {
    const lowered = { ...conditions, officeWideLimit: 1 };

    expect(startProblems(ready, lowered, [started("a"), started("b")])).toEqual([
      "The Office-wide limit is reached: the only desk is in use.",
    ]);
  });

  it.each(["in-progress", "waiting-on-you", "paused"] as const)(
    "counts a Task %s against its person's Task limit",
    (state) => {
      const others = [
        started("a", { state, personRole: "developer" }),
        started("b", { personRole: "developer" }),
      ];

      expect(startProblems(ready, conditions, others)).toEqual(["Ada is at the Task limit (2)."]);
    },
  );

  it("doesn't count Tasks that are done, dropped or not started", () => {
    const others = (["done", "dropped", "ready", "planning"] as const).map((state) =>
      started(state, { state, projectId: "admin-panel", personRole: "developer" }),
    );

    expect(startProblems(ready, { ...conditions, officeWideLimit: 1 }, others)).toEqual([]);
  });

  it("refuses when nobody fills the first Agent Stage's Role", () => {
    expect(startProblems(ready, { ...conditions, person: undefined }, [])).toEqual([
      "Nobody fills the Role Implement needs: hire a person for it on People first.",
    ]);
  });

  it("refuses when the first Agent Stage's person only talks", () => {
    const talker = { ...conditions, person: { name: "Ada", taskLimit: "none" as const } };

    expect(startProblems(ready, talker, [])).toEqual([
      "Ada only talks (Task limit none), so can't work Implement.",
    ]);
  });
});
