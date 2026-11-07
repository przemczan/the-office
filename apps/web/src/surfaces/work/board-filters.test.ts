import type { Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  boardFilter,
  boardFiltersOf,
  hasBoardFilters,
  isOnBoard,
  sameBoardFilters,
  tagsOffered,
  withBoardFilter,
  withoutBoardFilters,
  withTagToggled,
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
    createdBy: { kind: "user" },
    createdAt: "2026-10-28T10:00:00.000Z",
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
        tags: ["ble", 3],
        initiative: "launch",
        blocked: true,
        chat: "cto",
      }),
    ).toEqual({
      query: "pairing",
      priority: "high",
      tags: ["ble"],
      initiative: "launch",
      blocked: true,
    });
    expect(
      boardFiltersOf({
        query: "  ",
        priority: "urgent",
        tags: "ble",
        initiative: "",
        blocked: "yes",
      }),
    ).toEqual({});
  });
});

describe("withBoardFilter, withTagToggled and hasBoardFilters", () => {
  it("sets a filter, leaves out one emptied, and toggles a Tag", () => {
    const filters = withBoardFilter({}, "priority", "low");

    expect(filters).toEqual({ priority: "low" });
    expect(hasBoardFilters(filters)).toBe(true);
    expect(withBoardFilter(filters, "priority", undefined)).toEqual({});
    expect(hasBoardFilters({})).toBe(false);

    const tagged = withTagToggled(withTagToggled({}, "ble"), "ui");
    expect(tagged).toEqual({ tags: ["ble", "ui"] });
    expect(withTagToggled(withTagToggled(tagged, "ble"), "ui")).toEqual({});
  });
});

describe("sameBoardFilters", () => {
  it("matches the same filters, the Tags in any order and the search's words trimmed", () => {
    const view = { query: "flash", tags: ["ble", "ui"], blocked: true as const };

    expect(sameBoardFilters(view, { query: " flash", tags: ["ui", "ble"], blocked: true })).toBe(
      true,
    );
    expect(sameBoardFilters({}, {})).toBe(true);
  });

  it("tells apart filters that narrow the board differently", () => {
    const view = { priority: "high" as const, tags: ["ble"] };

    expect(sameBoardFilters(view, { priority: "high" })).toBe(false);
    expect(sameBoardFilters(view, { ...view, tags: ["ble", "ui"] })).toBe(false);
    expect(sameBoardFilters(view, { ...view, blocked: true })).toBe(false);
    expect(sameBoardFilters(view, { ...view, initiative: "i" })).toBe(false);
  });
});

describe("withoutBoardFilters", () => {
  it("keeps what opens over the page", () => {
    expect(withoutBoardFilters({ query: "x", tags: ["ble"], chat: "cto", needsYou: true })).toEqual(
      { chat: "cto", needsYou: true },
    );
  });
});

describe("tagsOffered", () => {
  it("offers the Tags in use and any chosen that no Task has any more", () => {
    const tasks = [aTask("a", { tags: ["ui"] }), aTask("b", { tags: ["ble", "ui"] })];

    expect(tagsOffered(tasks, { tags: ["gone"] })).toEqual(["ble", "gone", "ui"]);
  });
});

describe("isOnBoard", () => {
  it("leaves out only a Task in Shaping, whose Initiative isn't confirmed", () => {
    expect(isOnBoard({ state: "shaping" })).toBe(false);
    for (const state of ["backlog", "planning", "ready", "in-progress", "done"] as const) {
      expect(isOnBoard({ state })).toBe(true);
    }
  });
});

describe("boardFilter", () => {
  const protocol = aTask("protocol", { priority: "high", tags: ["ble", "ui"] });
  const client = aTask("client", {
    tags: ["ble"],
    blockedBy: ["protocol"],
    initiativeId: "launch",
  });
  const docs = aTask("docs", { priority: "low", blockedBy: ["finished"] });
  const finished = aTask("finished", { state: "done", tags: ["ui"] });
  const tasks = [protocol, client, docs, finished];

  it("shows every Task with no filters", () => {
    expect(shown(tasks, boardFilter({}, tasks))).toEqual([
      "protocol",
      "client",
      "docs",
      "finished",
    ]);
  });

  it("narrows by priority, by every Tag chosen, by Initiative, and to those blocked", () => {
    expect(shown(tasks, boardFilter({ priority: "high" }, tasks))).toEqual(["protocol"]);
    expect(shown(tasks, boardFilter({ tags: ["ble"] }, tasks))).toEqual(["protocol", "client"]);
    expect(shown(tasks, boardFilter({ tags: ["ble", "ui"] }, tasks))).toEqual(["protocol"]);
    expect(shown(tasks, boardFilter({ initiative: "launch" }, tasks))).toEqual(["client"]);
    // A Done blocker no longer holds a Task back.
    expect(shown(tasks, boardFilter({ blocked: true }, tasks))).toEqual(["client"]);
  });

  it("narrows to the Tasks the search found, once the service has answered", () => {
    const filters = { query: "pair", tags: ["ble"] };

    expect(shown(tasks, boardFilter(filters, tasks))).toEqual(["protocol", "client"]);
    expect(shown(tasks, boardFilter(filters, tasks, new Set(["client", "docs"])))).toEqual([
      "client",
    ]);
  });
});
