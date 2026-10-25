import type { Attachment } from "./attachment.js";
import { THE_USER } from "./author.js";
import type { Idea } from "./idea.js";
import type { Task } from "./task.js";

export function anIdea(fields: Partial<Idea> = {}): Idea {
  return {
    id: "idea-1",
    title: "Export usage as CSV",
    notes: "Monthly, per Project, for the accountant.",
    projectId: "admin-panel",
    state: "new",
    capturedBy: THE_USER,
    capturedAt: new Date("2026-10-25T09:00:00.000Z"),
    droppedAt: undefined,
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
    order: "a0",
    plan: "",
    definitionOfDone: [],
    pipelineId: "full",
    originIdeaId: undefined,
    createdBy: THE_USER,
    createdAt: new Date("2026-10-25T09:30:00.000Z"),
    ...fields,
  };
}

/** A Task that may go to Ready: it has a Plan and a Definition of Done. */
export function aPlannedTask(fields: Partial<Task> = {}): Task {
  return aTask({
    state: "planning",
    plan: "Keep the requested path through the sign-in.",
    definitionOfDone: ["Signing in returns the user to the page they asked for."],
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
