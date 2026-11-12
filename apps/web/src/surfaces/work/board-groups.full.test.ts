import type { Initiative, QueuedTask, Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { COLUMNS } from "./board-columns.ts";
import {
  boardGroups,
  columnCount,
  emptyGroupWords,
  foldedGroupWords,
  groupCountWords,
  groupKeyOf,
  groupName,
  groupProgress,
  leftOutWords,
  NO_INITIATIVE,
  type BoardGroup,
  type BoardGroups,
  type BoardGroupsInput,
} from "./board-groups.ts";

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

function anInitiative(id: string, fields: Partial<Initiative> = {}): Initiative {
  return {
    id,
    name: `Initiative ${id}`,
    outcome: "",
    state: "active",
    originIdeaId: "idea",
    projectIds: ["firmware"],
    createdBy: { kind: "user" },
    createdAt: "2026-10-28T10:00:00.000Z",
    endedAt: null,
    archivedAt: null,
    pausedAt: null,
    planningThreadId: null,
    planningAutoMode: false,
    pipelineId: null,
    shortName: null,
    branches: [],
    ...fields,
  };
}

const ARCHIVED = "2026-11-07T10:00:00.000Z";

// As GET /initiatives answers: the newest first.
const pairing = anInitiative("pairing");
const billing = anInitiative("billing", { state: "done" });
const sync = anInitiative("sync", { projectIds: ["firmware", "app"] });
const notes = anInitiative("notes", { state: "shaping" });
const legacy = anInitiative("legacy", { state: "dropped" });
const INITIATIVES = [pairing, billing, sync, notes, legacy];

const TASKS = [
  aTask("pair-1", { initiativeId: "pairing", priority: "high" }),
  aTask("pair-2", { initiativeId: "pairing", state: "ready" }),
  aTask("bill-1", { initiativeId: "billing", state: "done" }),
  aTask("bill-2", { initiativeId: "billing", state: "done", archivedAt: ARCHIVED }),
  aTask("sync-1", { initiativeId: "sync", projectId: "app" }),
  aTask("sync-2", { initiativeId: "sync", state: "in-progress" }),
  aTask("notes-1", { initiativeId: "notes", state: "shaping" }),
  aTask("legacy-1", { initiativeId: "legacy", state: "dropped", archivedAt: ARCHIVED }),
  aTask("loose-1"),
  aTask("loose-2", { priority: "low", state: "done" }),
];

function groupsOf(input: Partial<BoardGroupsInput> = {}): BoardGroups {
  return boardGroups({
    tasks: TASKS,
    initiatives: INITIATIVES,
    inProjectFilter: () => true,
    matches: () => true,
    chosenInitiative: undefined,
    ...input,
  });
}

function all(groups: BoardGroups): Extract<BoardGroups, { kind: "all" }> {
  if (groups.kind !== "all") throw new Error("The Initiative filter gave one group");
  return groups;
}

function alone(groups: BoardGroups): Extract<BoardGroups, { kind: "alone" }> {
  if (groups.kind !== "alone") throw new Error("Every group shows");
  return groups;
}

const keys = (groups: readonly BoardGroup[]): string[] => groups.map(({ key }) => key);
const ids = (tasks: readonly Task[]): string[] => tasks.map(({ id }) => id);
const group = (groups: BoardGroups, key: string): BoardGroup => {
  const found = all(groups).groups.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`No group ${key}`);
  return found;
};

describe("boardGroups", () => {
  it("orders the groups newest first, the Active ones before those that ended, No Initiative last", () => {
    expect(keys(all(groupsOf()).groups)).toEqual(["pairing", "sync", "billing", NO_INITIATIVE]);
  });

  it("gives no group to a shaping Initiative, nor to one whose cards are all archived", () => {
    const shown = keys(all(groupsOf()).groups);

    expect(shown).not.toContain("notes");
    expect(shown).not.toContain("legacy");
  });

  it("keeps a Done Initiative's group while it has cards on the board", () => {
    expect(ids(group(groupsOf(), "billing").onBoard)).toEqual(["bill-1"]);
  });

  it("puts the Tasks with no Initiative in No Initiative", () => {
    const none = group(groupsOf(), NO_INITIATIVE);

    expect(none.initiative).toBeUndefined();
    expect(groupName(none)).toBe("No Initiative");
    expect(ids(none.shown)).toEqual(["loose-1", "loose-2"]);
    expect(groupKeyOf(aTask("x"))).toBe(NO_INITIATIVE);
  });

  it("leaves out a group with no card in the Projects the Project filter shows, without naming it", () => {
    const groups = all(groupsOf({ inProjectFilter: ({ projectId }) => projectId === "app" }));

    expect(keys(groups.groups)).toEqual(["sync"]);
    expect(groups.leftOut).toEqual([]);
    expect(ids(groups.groups[0]?.shown ?? [])).toEqual(["sync-1"]);
  });

  it("leaves out a group search, Priority or Blocked leave with no card, and names it", () => {
    const groups = all(groupsOf({ matches: ({ priority }) => priority !== "normal" }));

    expect(keys(groups.groups)).toEqual(["pairing", NO_INITIATIVE]);
    expect(keys(groups.leftOut)).toEqual(["sync", "billing"]);
    expect(leftOutWords(groups.leftOut)).toBe(
      "No Task matches the filters in Initiative sync, Initiative billing, so their groups are left out.",
    );
    expect(leftOutWords(groups.leftOut.slice(0, 1))).toBe(
      "No Task matches the filters in Initiative sync, so its group is left out.",
    );
  });

  it("leaves no group when nothing matches, saying so once rather than naming each group", () => {
    const groups = all(groupsOf({ matches: () => false }));

    expect(groups.groups).toEqual([]);
    expect(groups.leftOut).toEqual([]);
    expect(groups.nothingMatches).toBe(true);
  });

  it("says nothing matches when the Project filter hides every card", () => {
    const groups = all(groupsOf({ inProjectFilter: () => false }));

    expect(groups.groups).toEqual([]);
    expect(groups.nothingMatches).toBe(true);
  });

  it("doesn't say nothing matches while the board has no card at all", () => {
    const groups = all(groupsOf({ tasks: [] }));

    expect(groups.groups).toEqual([]);
    expect(groups.nothingMatches).toBe(false);
  });

  it("says nothing matches only while no group shows", () => {
    expect(all(groupsOf()).nothingMatches).toBe(false);
  });
});

function chosen(
  chosenInitiative: string,
  input: Partial<BoardGroupsInput> = {},
): Extract<BoardGroups, { kind: "alone" }> {
  return alone(groupsOf({ chosenInitiative, ...input }));
}

describe("boardGroups with the Initiative filter set", () => {
  it("gives that group alone", () => {
    const groups = chosen("sync");

    expect(groups.group.key).toBe("sync");
    expect(ids(groups.group.shown)).toEqual(["sync-1", "sync-2"]);
    expect(groups.emptyBecause).toBeUndefined();
  });

  it("says why it has no card: being shaped, all archived, hidden by the Project filter or no match", () => {
    expect(chosen("notes").emptyBecause).toBe("being-shaped");
    expect(chosen("legacy").emptyBecause).toBe("all-archived");
    expect(chosen("pairing", { inProjectFilter: () => false }).emptyBecause).toBe("other-projects");
    expect(chosen("pairing", { matches: () => false }).emptyBecause).toBe("no-match");
  });

  it("words each reason", () => {
    expect(emptyGroupWords("being-shaped")).toBe(
      "Its Tasks join the board once the Initiative is confirmed.",
    );
    expect(emptyGroupWords("all-archived")).toBe("None of its Tasks is on the board.");
    expect(emptyGroupWords("other-projects")).toBe(
      "Its Tasks on the board are in Projects the Project filter hides.",
    );
    expect(emptyGroupWords("no-match")).toBe("None of its Tasks on the board matches the filters.");
  });
});

describe("a group's header", () => {
  it("counts progress over every Task of the Initiative, archived and in Shaping too", () => {
    expect(groupProgress(billing, TASKS)).toEqual({ done: 2, counted: 2, readyToStart: 0 });
    expect(groupProgress(notes, TASKS)).toEqual({ done: 0, counted: 1, readyToStart: 0 });
  });

  it("counts its cards on the board, or how many show while a filter hides some", () => {
    expect(groupCountWords(group(groupsOf(), "sync"))).toBe("2 on the board");
    expect(
      groupCountWords(
        group(groupsOf({ inProjectFilter: ({ projectId }) => projectId === "firmware" }), "sync"),
      ),
    ).toBe("1 of 2 shown");
    expect(
      groupCountWords(
        group(groupsOf({ matches: ({ priority }) => priority === "high" }), "pairing"),
      ),
    ).toBe("1 of 2 shown");
  });
});

describe("foldedGroupWords", () => {
  const queue: QueuedTask[] = [];

  it("counts the cards per column, leaving the empty columns out", () => {
    expect(foldedGroupWords(group(groupsOf(), "pairing"), queue)).toBe("Backlog 1 · Ready 1");
    expect(foldedGroupWords(group(groupsOf(), NO_INITIATIVE), queue)).toBe("Backlog 1 · Done 1");
  });
});

describe("columnCount", () => {
  it("counts a column's cards shown in every group", () => {
    const groups = all(groupsOf()).groups;
    const count = (key: string): number =>
      columnCount(COLUMNS.find((column) => column.key === key) ?? COLUMNS[0]!, groups, []);

    expect(count("backlog")).toBe(3);
    expect(count("done")).toBe(2);
    expect(count("in-progress")).toBe(1);
  });
});
