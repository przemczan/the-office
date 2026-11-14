import { describe, expect, it } from "vitest";
import type { Stage } from "./stage.js";
import { agentStage, gate } from "./stage.fixtures.js";
import {
  editProblems,
  followsPipeline,
  lockedStageCount,
  rolesNamedByOpenTasks,
} from "./task-stages.js";
import {
  implement,
  tests,
  review,
  publish,
  stages,
  own,
  roles,
  ranOnce,
} from "./task-stages.fixtures.js";

describe("lockedStageCount", () => {
  it("locks nothing before the first run", () => {
    expect(lockedStageCount(stages, [])).toBe(0);
  });

  it("locks every Stage up to the furthest one that ran, after a loop went back", () => {
    const runs = [ranOnce("implement", 1), ranOnce("tests", 2), ranOnce("implement", 3)];

    expect(lockedStageCount(stages, runs)).toBe(2);
  });
});

describe("editProblems", () => {
  it("passes an edit of a Task that hasn't started: a Gate before Publish, a model, a reorder", () => {
    const edited = [
      { ...implement, model: "claude-haiku-5-5", effort: "low" as const },
      review,
      tests,
      gate({ key: "look", name: "Look" }),
      publish,
    ];

    expect(editProblems(own, edited, [], roles)).toEqual([]);
  });

  it("passes changes after the started Stages, which stay as they were", () => {
    const edited = [implement, tests, gate({ key: "look", name: "Look" }), publish];

    expect(editProblems(own, edited, [ranOnce("implement"), ranOnce("tests", 2)], roles)).toEqual(
      [],
    );
  });

  it("takes a started Stage read back with its fields in another order as unchanged", () => {
    const reordered = Object.fromEntries(Object.entries(implement).toReversed()) as Stage;

    expect(editProblems(own, [reordered, tests], [ranOnce("implement")], roles)).toEqual([]);
  });

  it("flags a Role that only talks, on Stages not yet started", () => {
    const edited = [implement, tests, { ...review, role: "cto" }, publish];

    expect(editProblems(own, edited, [], roles).map(({ text }) => text)).toEqual([
      "Stage 3 · Review & fix: Nina's Task limit is none, so CTO only talks and can't work a Stage.",
    ]);
  });

  it("flags continuing a session without the same Role on the Stage before", () => {
    const edited = [implement, tests, { ...review, session: "continue" as const }, publish];

    expect(editProblems(own, edited, [], roles).map(({ text }) => text)).toEqual([
      "Stage 3 · Review & fix: continuing a session needs the same Role or the same duty in the Stage before.",
    ]);
  });

  it("flags an on-failure target that isn't earlier", () => {
    const edited = [{ ...implement, onFailure: { goBackTo: "review", rounds: 1 } }, review];

    expect(editProblems(own, edited, [], roles).map(({ text }) => text)).toEqual([
      "Stage 1 · Implement: on failure it can only go back to an earlier Stage.",
    ]);
  });
});

describe("followsPipeline", () => {
  it("leaves a copy behind once the Task's Pipeline was swapped", () => {
    expect(followsPipeline(own, "full")).toBe(true);
    expect(followsPipeline(own, "quick-fix")).toBe(false);
  });
});

describe("rolesNamedByOpenTasks", () => {
  const reviewed = { ...own, taskId: "task-2", stages: [agentStage({ role: "reviewer" })] };
  const task = { id: "task-1", state: "in-progress", projectId: "admin-panel", pipelineId: "full" };

  it("names each open Task's Agent Stage Roles in its own Project", () => {
    expect(
      rolesNamedByOpenTasks(
        [own, reviewed],
        [task, { ...task, id: "task-2", state: "todo", projectId: "billing" }],
      ),
    ).toEqual(
      new Map([
        ["admin-panel", { roles: new Set(["developer"]), duties: new Set() }],
        ["billing", { roles: new Set(["reviewer"]), duties: new Set() }],
      ]),
    );
  });

  it("leaves out a Task done or dropped, Stages it no longer follows, and a Task not listed", () => {
    expect(
      rolesNamedByOpenTasks(
        [own, reviewed, { ...own, taskId: "task-3" }],
        [
          { ...task, state: "done" },
          { ...task, id: "task-2", pipelineId: "quick-fix" },
        ],
      ),
    ).toEqual(new Map());
    expect(rolesNamedByOpenTasks([own], [{ ...task, state: "dropped" }])).toEqual(new Map());
  });
});
