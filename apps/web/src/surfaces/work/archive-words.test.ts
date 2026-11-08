import type { Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { archivedTasks } from "./archive-words.ts";

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

describe("archivedTasks", () => {
  it("lists only the archived Tasks, the newest archived first", () => {
    const older = aTask("older", "2026-11-01T10:00:00.000Z");
    const newer = aTask("newer", "2026-11-07T10:00:00.000Z");

    expect(archivedTasks([older, aTask("on-board", null), newer])).toEqual([newer, older]);
  });
});
