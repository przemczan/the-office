import type { Idea, Initiative, Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { newIdeasCount, openTasksCount, shapingInitiativesCount } from "./work-tab-counts.ts";

const ARCHIVED_AT = "2026-11-01T10:00:00.000Z";

/** The Project filter showing only firmware. */
const showsFirmware = (projectIds: readonly string[]): boolean => projectIds.includes("firmware");
const showsAll = (): boolean => true;

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
    initiativeId: null,
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
    state: "shaping",
    originIdeaId: "idea",
    projectIds: ["firmware"],
    createdBy: { kind: "user" },
    createdAt: "2026-10-28T10:00:00.000Z",
    endedAt: null,
    archivedAt: null,
    planningThreadId: null,
    planningAutoMode: false,
    ...fields,
  };
}

function anIdea(id: string, fields: Partial<Idea> = {}): Idea {
  return {
    id,
    title: `Idea ${id}`,
    notes: "",
    projectId: "firmware",
    state: "new",
    taskId: null,
    initiativeId: null,
    capturedBy: { kind: "user" },
    capturedAt: "2026-10-28T10:00:00.000Z",
    droppedAt: null,
    ...fields,
  };
}

describe("openTasksCount", () => {
  it("counts the Tasks on the board that are neither Done nor Dropped", () => {
    const tasks = [
      aTask("backlog"),
      aTask("ready", { state: "ready" }),
      aTask("in progress", { state: "in-progress" }),
      aTask("done", { state: "done" }),
      aTask("dropped", { state: "dropped" }),
    ];
    expect(openTasksCount(tasks, showsAll)).toBe(3);
  });

  it("leaves out the Tasks in Shaping and the archived ones", () => {
    const tasks = [
      aTask("shaping", { state: "shaping" }),
      aTask("archived", { state: "backlog", archivedAt: ARCHIVED_AT }),
    ];
    expect(openTasksCount(tasks, showsAll)).toBe(0);
  });

  it("counts only the Projects the Project filter shows", () => {
    const tasks = [aTask("firmware"), aTask("website", { projectId: "website" })];
    expect(openTasksCount(tasks, showsFirmware)).toBe(1);
  });
});

describe("shapingInitiativesCount", () => {
  it("counts the Initiatives in Shaping that aren't archived", () => {
    const initiatives = [
      anInitiative("shaping"),
      anInitiative("active", { state: "active" }),
      anInitiative("done", { state: "done" }),
      anInitiative("dropped", { state: "dropped" }),
      anInitiative("archived", { archivedAt: ARCHIVED_AT }),
    ];
    expect(shapingInitiativesCount(initiatives, showsAll)).toBe(1);
  });

  it("counts one spanning a shown Project, and none spanning only others", () => {
    const initiatives = [
      anInitiative("both", { projectIds: ["website", "firmware"] }),
      anInitiative("website", { projectIds: ["website"] }),
    ];
    expect(shapingInitiativesCount(initiatives, showsFirmware)).toBe(1);
  });

  it("is 0 when none is in Shaping", () => {
    expect(shapingInitiativesCount([anInitiative("active", { state: "active" })], showsAll)).toBe(
      0,
    );
  });
});

describe("newIdeasCount", () => {
  it("counts the new Ideas in the Projects the Project filter shows", () => {
    const ideas = [
      anIdea("new"),
      anIdea("shaped", { state: "shaped" }),
      anIdea("dropped", { state: "dropped" }),
      anIdea("website", { projectId: "website" }),
    ];
    expect(newIdeasCount(ideas, showsFirmware)).toBe(1);
  });

  it("is 0 when there is no new Idea", () => {
    expect(newIdeasCount([], showsAll)).toBe(0);
  });
});
