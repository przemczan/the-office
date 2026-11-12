import type { Initiative, Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  activeEdge,
  archivedMatchesWords,
  emptyColumnWords,
  endedWords,
  finalCountWords,
  INITIATIVE_COLUMNS,
  initiativesFiltersOf,
  inStateInOrder,
  nothingToCountWords,
  onTheBoard,
  tasksSoFarWords,
  whatMovesNow,
} from "./initiative-columns.ts";

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
    planningThreadId: null,
    planningAutoMode: false,
    pipelineId: null,
    shortName: null,
    branches: [],
    ...fields,
  };
}

function aTask(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    projectId: "firmware",
    state: "backlog",
    priority: "normal",
    tags: [],
    description: "",
    plan: "",
    planConfirmed: false,
    filesToChange: [],
    estimatedTokens: null,
    definitionOfDone: [],
    definitionOfDoneConfirmed: false,
    pipelineId: "full",
    proposedPipeline: null,
    pausedByAlarm: false,
    autoMode: false,
    initiativePlanningThreadId: null,
    markedPlanned: false,
    hasPlanningThread: false,
    blockedBy: [],
    originIdeaId: null,
    initiativeId: "initiative",
    madeFor: null,
    projectMoves: [],
    createdBy: { kind: "user" },
    createdAt: "2026-10-28T10:00:00.000Z",
    archivedAt: null,
    endedAt: null,
    ...fields,
  };
}

const [SHAPING, ACTIVE, DONE] = INITIATIVE_COLUMNS;

/** The Project filter showing firmware alone. */
function inProjectFilter({ projectIds }: Initiative): boolean {
  return projectIds.includes("firmware");
}

function waitsOnYou(task: Task): boolean {
  return task.state === "waiting-on-you";
}

describe("the Initiatives board's filters", () => {
  it("reads the search and Waiting on you from the address, leaving out the rest", () => {
    expect(initiativesFiltersOf({ query: "sync", waiting: 1, state: "done" })).toEqual({
      query: "sync",
      waiting: 1,
    });
    expect(initiativesFiltersOf({ waiting: true })).toEqual({ waiting: 1 });
    expect(initiativesFiltersOf({ query: "  ", waiting: 0 })).toEqual({});
  });
});

describe("the Initiatives board's columns", () => {
  it("are Shaping, Active and Done, left to right as an Initiative moves", () => {
    expect(INITIATIVE_COLUMNS.map(({ label }) => label)).toEqual(["Shaping", "Active", "Done"]);
    expect(SHAPING?.hint("Michael", 30)).toBe("With Michael, until you confirm them");
    expect(DONE?.hint("Michael", 30)).toBe("Done and dropped in the last 30 days, then archived");
  });

  it("leave archived Initiatives out", () => {
    const archived = anInitiative("a", { state: "done", archivedAt: "2026-11-01T10:00:00.000Z" });
    const done = anInitiative("b", { state: "done" });

    expect(onTheBoard([archived, done])).toEqual([done]);
  });

  it("keep Shaping and Active newest first, as the service answers them", () => {
    const newer = anInitiative("newer", { createdAt: "2026-11-02T10:00:00.000Z" });
    const older = anInitiative("older", { createdAt: "2026-10-02T10:00:00.000Z" });
    const ended = anInitiative("ended", { state: "done" });

    expect(inStateInOrder([newer, older, ended], "active")).toEqual([newer, older]);
  });

  it("put the one that ended last on top in Done and Dropped, one nothing dates last", () => {
    const early = anInitiative("early", { state: "dropped", endedAt: "2026-10-20T10:00:00.000Z" });
    const undated = anInitiative("undated", { state: "dropped" });
    const late = anInitiative("late", { state: "dropped", endedAt: "2026-10-30T10:00:00.000Z" });

    expect(inStateInOrder([early, undated, late], "dropped").map(({ id }) => id)).toEqual([
      "late",
      "early",
      "undated",
    ]);
  });

  it("say why a column is empty, or what would fill it", () => {
    const shown = anInitiative("shown");
    const elsewhere = anInitiative("elsewhere", { projectIds: ["web"] });
    if (!ACTIVE || !DONE) throw new Error("The board has no Active or Done column.");

    expect(emptyColumnWords(ACTIVE, [shown], inProjectFilter, 30)).toBe(
      "None matches the filters.",
    );
    expect(emptyColumnWords(ACTIVE, [elsewhere], inProjectFilter, 30)).toBe(
      "None in the Projects shown.",
    );
    expect(emptyColumnWords(ACTIVE, [], inProjectFilter, 30)).toBe(
      "Nothing Active. Confirm an Initiative in Shaping to start its Tasks.",
    );
    expect(emptyColumnWords(DONE, [], inProjectFilter, 7)).toBe("Nothing done in the last 7 days.");
  });
});

describe("an Initiative's card", () => {
  it("counts what moves now: waiting on you, in progress or paused, and blocked", () => {
    const blocker = aTask("blocker", { state: "ready", initiativeId: null });
    const tasks = [
      aTask("waiting", { state: "waiting-on-you" }),
      aTask("running", { state: "in-progress" }),
      aTask("paused", { state: "paused" }),
      aTask("blocked", { state: "backlog", blockedBy: ["blocker"] }),
      aTask("free", { state: "ready" }),
    ];

    const now = whatMovesNow(tasks, [...tasks, blocker], waitsOnYou);

    expect(now).toEqual({ waitingOnYou: 1, inProgress: 2, blocked: 1 });
    expect(activeEdge(now)).toBe("edge-decision");
    expect(activeEdge({ ...now, waitingOnYou: 0 })).toBe("edge-running");
    expect(activeEdge({ waitingOnYou: 0, inProgress: 0, blocked: 3 })).toBeUndefined();
  });

  it("says why an Active one has nothing to count", () => {
    expect(nothingToCountWords([aTask("gone", { state: "dropped" })])).toBe(
      "No Task left: every one was dropped. Add a Task or drop the Initiative on its page.",
    );
    expect(nothingToCountWords([])).toBe("No Task yet. Add one on its page.");
  });

  it("counts a Shaping one's Tasks so far", () => {
    expect(tasksSoFarWords(0)).toBe("No Task yet");
    expect(tasksSoFarWords(1)).toBe("1 Task so far");
    expect(tasksSoFarWords(2)).toBe("2 Tasks so far");
  });

  it("gives an ended one its final count and when it ended", () => {
    const now = new Date("2026-11-09T10:00:00.000Z");

    expect(finalCountWords({ done: 3, counted: 3 })).toBe("3 of 3 Tasks done");
    expect(finalCountWords({ done: 0, counted: 0 })).toBe("No Task done");
    expect(
      endedWords(anInitiative("a", { state: "done", endedAt: "2026-11-03T10:00:00.000Z" }), now),
    ).toBe("Done 3 Nov");
    expect(endedWords(anInitiative("b", { state: "dropped" }), now)).toBe("Dropped");
  });

  it("says when the search matches archived Initiatives too", () => {
    expect(archivedMatchesWords(2, " sync ")).toBe("2 archived Initiatives match “sync” too.");
    expect(archivedMatchesWords(1, "sync")).toBe("1 archived Initiative matches “sync” too.");
  });
});
