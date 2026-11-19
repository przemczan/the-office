import type { Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  attachmentsSummary,
  droppedWithIt,
  droppedWords,
  dropTasksWords,
  graphLineKinds,
  initiativePipelineIn,
  initiativeProgress,
  outcomeSummary,
  progressWords,
  taskGraph,
  tasksFoldSummary,
} from "./initiative-words.ts";

const INITIATIVE_ID = "3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";

function aTask(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    projectId: "firmware",
    priority: "normal",
    tags: [],
    state: "backlog",
    plan: "",
    pausedBy: null,
    engineStandIns: [],
    resumesAt: null,
    autoMode: false,
    initiativePlanningThreadId: null,
    markedPlanned: false,
    hasPlanningThread: false,
    planConfirmed: false,
    filesToChange: [],
    estimatedTokens: null,
    definitionOfDone: [],
    definitionOfDoneConfirmed: false,
    commitMessage: "Commit message",
    commitMessageWritten: false,
    commitMessagePublishedAt: null,
    pipelineId: "full",
    proposedPipeline: null,
    blockedBy: [],
    originIdeaId: null,
    initiativeId: INITIATIVE_ID,
    madeFor: null,
    projectMoves: [],
    createdBy: { kind: "user", user: null },
    createdAt: "2026-10-28T10:00:00.000Z",
    archivedAt: null,
    endedAt: null,
    pullRequestEnd: null,
    ...fields,
  };
}

const columnIds = (graph: ReturnType<typeof taskGraph>): string[][] =>
  graph.columns.map((column) => column.map(({ task }) => task.id));

describe("taskGraph", () => {
  it("puts each Task right of every Task it waits for", () => {
    const schema = aTask("schema");
    const api = aTask("api", { blockedBy: ["schema"], projectId: "service" });
    const app = aTask("app", { blockedBy: ["api"], projectId: "app" });
    const docs = aTask("docs", { blockedBy: ["schema", "app"] });
    const tasks = [schema, api, app, docs];

    expect(columnIds(taskGraph(tasks, tasks))).toEqual([["schema"], ["api"], ["app"], ["docs"]]);
  });

  it("draws an outside blocker once, marked, with no columns for its own blockers", () => {
    const older = aTask("older", { initiativeId: null });
    const elsewhere = aTask("elsewhere", {
      initiativeId: null,
      blockedBy: ["older"],
      state: "done",
    });
    const first = aTask("first", { blockedBy: ["elsewhere"] });
    const second = aTask("second", { blockedBy: ["elsewhere"] });
    const graph = taskGraph([first, second], [older, elsewhere, first, second]);

    expect(columnIds(graph)).toEqual([["elsewhere"], ["first", "second"]]);
    expect(graph.columns[0]?.[0]?.outside).toBe(true);
    expect(graph.edges).toEqual([
      { from: "elsewhere", to: "first", blockerDone: true },
      { from: "elsewhere", to: "second", blockerDone: true },
    ]);
  });

  it("orders a column by Project", () => {
    const service = aTask("service-task", { projectId: "service" });
    const app = aTask("app-task", { projectId: "app" });

    expect(columnIds(taskGraph([service, app], [service, app]))).toEqual([
      ["app-task", "service-task"],
    ]);
  });

  it("still ends on a cycle", () => {
    const first = aTask("first", { blockedBy: ["second"] });
    const second = aTask("second", { blockedBy: ["first"] });

    expect(taskGraph([first, second], [first, second]).columns.flat()).toHaveLength(2);
  });
});

describe("initiativeProgress", () => {
  it("leaves Dropped Tasks out, and counts Ready ones waiting for nothing", () => {
    const done = aTask("done", { state: "done" });
    const dropped = aTask("dropped", { state: "dropped" });
    const free = aTask("free", { state: "ready" });
    const blocked = aTask("blocked", { state: "ready", blockedBy: ["free"] });
    const tasks = [done, dropped, free, blocked];

    const progress = initiativeProgress(tasks, tasks);

    expect(progress).toEqual({ done: 1, counted: 3, readyToStart: 1 });
    expect(progressWords(progress)).toBe("1 of 3 Tasks done · 1 ready to start");
  });
});

describe("what a Drop takes with it", () => {
  it("counts the Tasks not yet Done or Dropped, and those of them started", () => {
    const states: Task["state"][] = [
      "shaping",
      "backlog",
      "ready",
      "in-progress",
      "waiting-on-you",
      "done",
      "dropped",
    ];
    const tasks = states.map((state) => aTask(state, { state }));

    expect(droppedWithIt(tasks)).toEqual({ open: 5, started: 2 });
  });

  it("says how many Tasks the Drop takes along and how many of them are started", () => {
    expect(dropTasksWords({ open: 0, started: 0 })).toBe(
      "Its Tasks are all Done or Dropped already, so it drops none.",
    );
    expect(dropTasksWords({ open: 1, started: 0 })).toBe(
      "It drops its 1 Task not yet Done or Dropped, not started yet.",
    );
    expect(dropTasksWords({ open: 1, started: 1 })).toBe(
      "It drops its 1 Task not yet Done or Dropped, which has started: its Stage stops.",
    );
    expect(dropTasksWords({ open: 3, started: 0 })).toBe(
      "It drops its 3 Tasks not yet Done or Dropped, none of them started.",
    );
    expect(dropTasksWords({ open: 3, started: 1 })).toBe(
      "It drops its 3 Tasks not yet Done or Dropped, 1 of them started: its Stage stops.",
    );
  });

  it("says in the toast that the Initiative was dropped with its open Tasks", () => {
    expect(droppedWords({ open: 0 })).toBe("Initiative dropped.");
    expect(droppedWords({ open: 1 })).toBe("Initiative dropped, with its 1 open Task.");
    expect(droppedWords({ open: 3 })).toBe("Initiative dropped, with its 3 open Tasks.");
  });
});

describe("the folded lines", () => {
  it("opens with the outcome's first line, without its Markdown", () => {
    expect(outcomeSummary("")).toBe("Not written yet");
    expect(outcomeSummary("**Monthly** exports\n\nAnd more.")).toBe("Monthly exports");
  });

  it("counts the Attachments", () => {
    expect(attachmentsSummary(0)).toBe("None");
    expect(attachmentsSummary(1)).toBe("1 Attachment");
    expect(attachmentsSummary(2)).toBe("2 Attachments");
  });
  it("says what the Tasks fold holds and what moves, each state only when a Task is in it", () => {
    const tasks = [
      aTask("a", { state: "done" }),
      aTask("b", { state: "done", projectId: "app" }),
      aTask("c", { state: "in-progress" }),
      aTask("d", { state: "waiting-on-you", projectId: "app" }),
      aTask("e"),
      aTask("f", { state: "dropped" }),
    ];

    expect(tasksFoldSummary({ state: "active" }, tasks)).toBe(
      "6 across 2 Projects · 2 done · 1 in progress · 1 waiting on you · 1 dropped",
    );
    expect(tasksFoldSummary({ state: "active" }, [aTask("a")])).toBe("1 across 1 Project");
  });

  it("says the Tasks are in Shaping until confirmed, or that there are none yet", () => {
    expect(
      tasksFoldSummary({ state: "shaping" }, [aTask("a"), aTask("b", { projectId: "app" })]),
    ).toBe("2 across 2 Projects · in Shaping until you confirm");
    expect(tasksFoldSummary({ state: "shaping" }, [])).toBe("None yet");
  });
});

describe("graphLineKinds", () => {
  it("samples only the kinds of line the graph draws", () => {
    const schema = aTask("schema", { state: "done" });
    const api = aTask("api", { blockedBy: ["schema"] });
    const outside = aTask("outside", { initiativeId: null });
    const app = aTask("app", { blockedBy: ["api", "outside"] });

    expect(graphLineKinds(taskGraph([api, app], [api, app]))).toEqual(["must-be-done-first"]);
    expect(graphLineKinds(taskGraph([schema, api], [schema, api]))).toEqual([
      "must-be-done-first",
      "blocker-done",
    ]);
    expect(graphLineKinds(taskGraph([api, app], [api, app, outside]))).toEqual([
      "must-be-done-first",
      "from-outside",
    ]);
  });
});

describe("initiativePipelineIn", () => {
  it("answers the Pipeline of each Project, null for None", () => {
    const initiative = {
      pipelines: [
        { projectId: "firmware", pipelineId: "full" },
        { projectId: "app", pipelineId: null },
      ],
    };

    expect(initiativePipelineIn(initiative, "firmware")).toBe("full");
    expect(initiativePipelineIn(initiative, "app")).toBeNull();
    expect(initiativePipelineIn(initiative, "service")).toBeNull();
  });
});
