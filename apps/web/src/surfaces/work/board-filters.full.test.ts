import type { Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  boardFilter,
  boardFiltersOf,
  hasBoardFilters,
  isOnBoard,
  sameBoardFilters,
  withBoardFilter,
  withoutBoardFilters,
} from "./board-filters.ts";

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
    pausedByAlarm: false,
    autoMode: false,
    initiativePlanningThreadId: null,
    markedPlanned: false,
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
    archivedAt: null,
    ...fields,
  };
}

const shown = (tasks: readonly Task[], show: (task: Task) => boolean): string[] =>
  tasks.filter(show).map(({ id }) => id);

describe("boardFiltersOf", () => {
  it("keeps only the filters set, leaving out what isn't one", () => {
    expect(
      boardFiltersOf({
        query: "pairing",
        priority: "high",
        tags: ["ble"],
        initiative: "launch",
        blocked: true,
        chat: "cto",
      }),
    ).toEqual({
      query: "pairing",
      priority: "high",
      initiative: "launch",
      blocked: true,
    });
    expect(
      boardFiltersOf({
        query: "  ",
        priority: "urgent",
        initiative: "",
        blocked: "yes",
      }),
    ).toEqual({});
  });
});

describe("withBoardFilter and hasBoardFilters", () => {
  it("sets a filter and leaves out one emptied", () => {
    const filters = withBoardFilter({}, "priority", "low");

    expect(filters).toEqual({ priority: "low" });
    expect(hasBoardFilters(filters)).toBe(true);
    expect(withBoardFilter(filters, "priority", undefined)).toEqual({});
    expect(hasBoardFilters({})).toBe(false);
  });
});

describe("sameBoardFilters", () => {
  it("matches the same filters, the search's words trimmed", () => {
    const view = { query: "flash", blocked: true as const };

    expect(sameBoardFilters(view, { query: " flash", blocked: true })).toBe(true);
    expect(sameBoardFilters({}, {})).toBe(true);
  });

  it("tells apart filters that narrow the board differently", () => {
    const view = { priority: "high" as const, query: "flash" };

    expect(sameBoardFilters(view, { priority: "high" })).toBe(false);
    expect(sameBoardFilters(view, { ...view, blocked: true })).toBe(false);
    expect(sameBoardFilters(view, { ...view, initiative: "i" })).toBe(false);
  });
});

describe("withoutBoardFilters", () => {
  it("keeps what opens over the page", () => {
    expect(withoutBoardFilters({ query: "x", chat: "cto", needsYou: true })).toEqual({
      chat: "cto",
      needsYou: true,
    });
  });

  it("keeps the grouping, so Clear and a Saved view leave it as it is", () => {
    expect(withoutBoardFilters({ priority: "high", group: "initiative" })).toEqual({
      group: "initiative",
    });
  });
});

describe("isOnBoard", () => {
  it("leaves out a Task in Shaping, whose Initiative isn't confirmed", () => {
    expect(isOnBoard({ state: "shaping", archivedAt: null })).toBe(false);
    for (const state of ["backlog", "planning", "ready", "in-progress", "done"] as const) {
      expect(isOnBoard({ state, archivedAt: null })).toBe(true);
    }
  });

  it("leaves out an archived Task, in the state it stays in", () => {
    const archivedAt = "2026-11-07T10:00:00.000Z";
    expect(isOnBoard({ state: "done", archivedAt })).toBe(false);
    expect(isOnBoard({ state: "dropped", archivedAt })).toBe(false);
  });
});

describe("boardFilter", () => {
  const protocol = aTask("protocol", { priority: "high" });
  const client = aTask("client", { blockedBy: ["protocol"], initiativeId: "launch" });
  const docs = aTask("docs", { priority: "low", blockedBy: ["finished"] });
  const finished = aTask("finished", { state: "done" });
  const tasks = [protocol, client, docs, finished];

  it("shows every Task with no filters", () => {
    expect(shown(tasks, boardFilter({}, tasks))).toEqual([
      "protocol",
      "client",
      "docs",
      "finished",
    ]);
  });

  it("narrows by priority, by Initiative, and to those blocked", () => {
    expect(shown(tasks, boardFilter({ priority: "high" }, tasks))).toEqual(["protocol"]);
    expect(shown(tasks, boardFilter({ initiative: "launch" }, tasks))).toEqual(["client"]);
    // A Done blocker no longer holds a Task back.
    expect(shown(tasks, boardFilter({ blocked: true }, tasks))).toEqual(["client"]);
  });

  it("narrows to the Tasks the search found, once the service has answered", () => {
    const filters = { query: "pair", priority: "normal" as const };

    expect(shown(tasks, boardFilter(filters, tasks))).toEqual(["client", "finished"]);
    expect(shown(tasks, boardFilter(filters, tasks, new Set(["client", "docs"])))).toEqual([
      "client",
    ]);
  });
});
