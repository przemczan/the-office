import type { Attachment } from "./attachment.js";
import { byTheUser, type Author } from "./author.js";
import type { UsageAtStart } from "./cap-waits.js";
import type { Idea } from "./idea.js";
import type { Initiative } from "./initiative.js";
import type { Task } from "./task.js";

/** The user the test apps take every request as signed in by (`SIGNED_IN_FOR_TESTS`). */
export const ANN_LEE: Author = byTheUser({
  userId: "00000000-0000-4000-8000-0000000005e1",
  name: "Ann Lee",
});

/** The second user, whom a request names with `signedInAs(ANOTHER_SIGNED_IN_FOR_TESTS)`. */
export const BEN_ITO: Author = byTheUser({
  userId: "00000000-0000-4000-8000-0000000005e2",
  name: "Ben Ito",
});

export function anIdea(fields: Partial<Idea> = {}): Idea {
  return {
    id: "idea-1",
    title: "Export usage as CSV",
    notes: "Monthly, per Project, for the accountant.",
    projectId: "admin-panel",
    state: "new",
    taskId: undefined,
    initiativeId: undefined,
    capturedBy: ANN_LEE,
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
    createdBy: ANN_LEE,
    createdAt: new Date("2026-10-25T09:10:00.000Z"),
    planningThreadIds: [],
    planningAutoMode: false,
    planningWithUser: false,
    pipelines: [],
    branches: [],
    engineOverride: null,
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
    commitMessage: "",
    commitMessagePublishedAt: undefined,
    pipelineId: "full",
    proposedPipeline: undefined,
    autoMode: false,
    initiativePlanningThreadId: undefined,
    markedPlanned: false,
    hasPlanningThread: false,
    personRole: undefined,
    engineStandIns: [],
    pausedBy: undefined,
    resumesAt: undefined,
    usageWindowEngineId: undefined,
    usageWindowPausedAt: undefined,
    madeFor: undefined,
    resolvesTaskId: undefined,
    blockedBy: [],
    originIdeaId: undefined,
    initiativeId: undefined,
    projectMoves: [],
    createdBy: ANN_LEE,
    createdAt: new Date("2026-10-25T09:30:00.000Z"),
    archivedAt: undefined,
    archivedBy: undefined,
    restoredAt: undefined,
    restoredBy: undefined,
    endedAt: undefined,
    pullRequestEnd: undefined,
    branchDeletion: undefined,
    kind: "feature",
    causedBy: undefined,
    foundInVersion: undefined,
    foundWhileWorkingOn: undefined,
    dropReason: undefined,
    createdByTheOffice: false,
    engineOverride: null,
    ...fields,
  };
}

/**
 * A Task that may go to Ready: planned in its planning Thread, the user confirmed its Plan and its
 * Definition of Done.
 */
export function aPlannedTask(fields: Partial<Task> = {}): Task {
  return aTask({
    state: "planning",
    hasPlanningThread: true,
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
    addedBy: ANN_LEE,
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
  usedUp: [],
};
