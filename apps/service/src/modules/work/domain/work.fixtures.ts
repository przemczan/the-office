import type { Attachment } from "./attachment.js";
import { THE_USER } from "./author.js";
import type { UsageAtStart } from "./cap-waits.js";
import type { Idea } from "./idea.js";
import type { Initiative } from "./initiative.js";
import type { Task } from "./task.js";

export function anIdea(fields: Partial<Idea> = {}): Idea {
  return {
    id: "idea-1",
    title: "Export usage as CSV",
    notes: "Monthly, per Project, for the accountant.",
    projectId: "admin-panel",
    state: "new",
    taskId: undefined,
    initiativeId: undefined,
    capturedBy: THE_USER,
    capturedAt: new Date("2026-10-25T09:00:00.000Z"),
    droppedAt: undefined,
    ...fields,
  };
}

export function anInitiative(fields: Partial<Initiative> = {}): Initiative {
  return {
    id: "initiative-1",
    name: "Usage exports",
    outcome: "",
    state: "shaping",
    originIdeaId: "idea-1",
    createdBy: THE_USER,
    createdAt: new Date("2026-10-25T09:10:00.000Z"),
    ...fields,
  };
}

export function aTask(fields: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Fix the login redirect",
    projectId: "admin-panel",
    state: "backlog",
    priority: "normal",
    tags: [],
    order: "a0",
    description: "",
    plan: "",
    planConfirmed: false,
    filesToChange: [],
    estimatedTokens: undefined,
    definitionOfDone: [],
    definitionOfDoneConfirmed: false,
    pipelineId: "full",
    proposedPipeline: undefined,
    personRole: undefined,
    pausedByAlarm: false,
    isOnboardTask: false,
    blockedBy: [],
    originIdeaId: undefined,
    initiativeId: undefined,
    projectMoves: [],
    createdBy: THE_USER,
    createdAt: new Date("2026-10-25T09:30:00.000Z"),
    archivedAt: undefined,
    restoredAt: undefined,
    ...fields,
  };
}

/** A Task that may go to Ready: the user confirmed its Plan and its Definition of Done. */
export function aPlannedTask(fields: Partial<Task> = {}): Task {
  return aTask({
    state: "planning",
    plan: "Keep the requested path through the sign-in.",
    planConfirmed: true,
    filesToChange: [],
    definitionOfDone: ["Signing in returns the user to the page they asked for."],
    definitionOfDoneConfirmed: true,
    ...fields,
  });
}

export function aLink(fields: Partial<Pick<Attachment, "id" | "owner">> = {}): Attachment {
  return {
    id: "attachment-1",
    owner: { kind: "idea", ideaId: "idea-1" },
    name: "CSV format notes",
    addedBy: THE_USER,
    addedAt: new Date("2026-10-25T09:05:00.000Z"),
    kind: "link",
    url: "https://example.com/csv",
    ...fields,
  };
}

/** No estimate, and no windows or Daily caps the Task spends under. */
export const NO_USAGE_AT_START: UsageAtStart = {
  now: new Date("2026-10-29T09:00:00.000Z"),
  measures: [],
  estimate: [],
  windows: [],
  daily: [],
  engineNames: new Map(),
};
