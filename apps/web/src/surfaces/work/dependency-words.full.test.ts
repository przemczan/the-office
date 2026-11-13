import type { Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  blockerCandidates,
  blockersOf,
  blockingTasksOf,
  dependenciesSummary,
  waitingFor,
} from "./dependency-words.ts";

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
    pipelineId: "full",
    proposedPipeline: null,
    blockedBy: [],
    originIdeaId: null,
    initiativeId: null,
    madeFor: null,
    projectMoves: [],
    createdBy: { kind: "user" },
    createdAt: "2026-10-28T10:00:00.000Z",
    archivedAt: null,
    endedAt: null,
    ...fields,
  };
}

const ids = (tasks: readonly Task[]): string[] => tasks.map(({ id }) => id);

describe("blockersOf and blockingTasksOf", () => {
  it("lists every blocker in the order added, and only those neither Done nor Dropped as blocking", () => {
    const schema = aTask("schema", { state: "done" });
    const flash = aTask("flash", { state: "dropped" });
    const protocol = aTask("protocol", { state: "ready" });
    const client = aTask("client", { blockedBy: ["protocol", "schema", "flash", "gone"] });
    const tasks = [schema, flash, protocol, client];

    expect(ids(blockersOf(client, tasks))).toEqual(["protocol", "schema", "flash"]);
    expect(ids(blockingTasksOf(client, tasks))).toEqual(["protocol"]);
  });
});

describe("waitingFor", () => {
  it("lists the Tasks waiting for this one, leaving out the Dropped", () => {
    const schema = aTask("schema");
    const tasks = [
      schema,
      aTask("client", { blockedBy: ["schema"] }),
      aTask("old", { blockedBy: ["schema"], state: "dropped" }),
      aTask("other"),
    ];

    expect(ids(waitingFor(schema, tasks))).toEqual(["client"]);
  });
});

describe("blockerCandidates", () => {
  it("offers any Task that can still hold it back, but not itself, its blockers or what waits for it", () => {
    const schema = aTask("schema");
    const tasks = [
      schema,
      aTask("protocol", { blockedBy: ["schema"] }),
      aTask("client", { blockedBy: ["protocol"] }),
      aTask("queue"),
      aTask("done", { state: "done" }),
      aTask("dropped", { state: "dropped" }),
      aTask("flash", { projectId: "mobile" }),
    ];
    const withBlocker = { ...schema, blockedBy: ["queue"] };

    expect(ids(blockerCandidates(withBlocker, tasks))).toEqual(["flash"]);
  });
});

describe("dependenciesSummary", () => {
  const one = [aTask("schema")];
  const two = [aTask("schema"), aTask("flash")];

  it("names what it waits on and what waits for it", () => {
    expect(dependenciesSummary(one, [])).toBe("Waits on 1 Task");
    expect(dependenciesSummary(two, one)).toBe("Waits on 2 Tasks · 1 waits for it");
    expect(dependenciesSummary([], two)).toBe("2 wait for it");
  });

  it("says when there are none", () => {
    expect(dependenciesSummary([], [])).toBe("None");
  });
});
