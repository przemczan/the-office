import type { Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { archivedSearchOf, archivedTasks, monthLineWords, pageCountOf } from "./archive-words.ts";

function aTask(id: string, archivedAt: string | null): Task {
  return {
    id,
    title: `Task ${id}`,
    description: "",
    projectId: "web",
    priority: "normal",
    tags: [],
    state: "done",
    plan: "",
    pausedByAlarm: false,
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
    projectMoves: [],
    createdBy: { kind: "user" },
    createdAt: "2026-10-28T10:00:00.000Z",
    archivedAt,
  };
}

describe("the Archived tab's address", () => {
  it("keeps the kind, search, state and page, each only when it isn't its default", () => {
    expect(
      archivedSearchOf({ kind: "initiatives", query: "sync", state: "dropped", page: 3 }),
    ).toEqual({ kind: "initiatives", query: "sync", state: "dropped", page: 3 });
    expect(archivedSearchOf({ kind: "tasks", query: " ", state: "all", page: 1 })).toEqual({});
    expect(archivedSearchOf({ state: "active", page: "2" })).toEqual({ page: 2 });
    expect(archivedSearchOf({ page: 0 })).toEqual({});
    expect(archivedSearchOf({ page: 2.5 })).toEqual({});
  });
});

describe("the archive of Initiatives", () => {
  it("lines its rows up under the month they ended in", () => {
    expect(monthLineWords("2026-11-03T10:00:00.000Z")).toBe("November 2026");
    expect(monthLineWords(null)).toBe("Ended before its end was kept");
  });

  it("counts its pages, one at least", () => {
    expect(pageCountOf(0, 25)).toBe(1);
    expect(pageCountOf(25, 25)).toBe(1);
    expect(pageCountOf(1230, 25)).toBe(50);
  });
});

describe("archivedTasks", () => {
  it("lists only the archived Tasks, the newest archived first", () => {
    const older = aTask("older", "2026-11-01T10:00:00.000Z");
    const newer = aTask("newer", "2026-11-07T10:00:00.000Z");

    expect(archivedTasks([older, aTask("on-board", null), newer])).toEqual([newer, older]);
  });
});
