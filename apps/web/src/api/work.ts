import { queryOptions } from "@tanstack/react-query";
import {
  attachmentListSchema,
  attachmentSchema,
  ideaListSchema,
  ideaSchema,
  taskListSchema,
  taskSchema,
  type Attachment,
  type AttachmentOwner,
  type Idea,
  type NewIdea,
  type NewLink,
  type NewTask,
  type Priority,
  type Task,
  type TaskPlacement,
  type WorkWebEvent,
} from "@the-office/contracts";
import { deleteFromApi, getFromApi, sendFileToApi, sendToApi } from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const IDEAS = ["ideas"] as const;
const TASKS = ["tasks"] as const;
const ATTACHMENTS = ["attachments"] as const;

export const ideaQueries = {
  /** Every Idea, the newest captured first. */
  list: () =>
    queryOptions({
      queryKey: IDEAS,
      queryFn: ({ signal }) => getFromApi("/ideas", ideaListSchema, signal),
    }),
  one: (id: string) =>
    queryOptions({
      queryKey: [...IDEAS, id],
      queryFn: ({ signal }) => getFromApi(ideaPath(id), ideaSchema, signal),
    }),
};

export const taskQueries = {
  /** Every Task, in the board's order: by priority, then by manual order. */
  list: () =>
    queryOptions({
      queryKey: TASKS,
      queryFn: ({ signal }) => getFromApi("/tasks", taskListSchema, signal),
    }),
  one: (id: string) =>
    queryOptions({
      queryKey: [...TASKS, id],
      queryFn: ({ signal }) => getFromApi(taskPath(id), taskSchema, signal),
    }),
};

export const attachmentQueries = {
  /** The Idea's or Task's Attachments, in the order they were added. */
  of: (owner: AttachmentOwner) =>
    queryOptions({
      queryKey: [...ATTACHMENTS, owner.kind, ownerId(owner)],
      queryFn: ({ signal }) =>
        getFromApi(`${ownerPath(owner)}/attachments`, attachmentListSchema, signal),
    }),
  /** A document Attachment's Markdown, as text; it never changes. */
  document: (id: string) =>
    queryOptions({
      queryKey: [...ATTACHMENTS, id, "document"],
      queryFn: ({ signal }) => readDocument(id, signal),
      staleTime: Number.POSITIVE_INFINITY,
    }),
};

export function captureIdea(newIdea: NewIdea): Promise<Idea> {
  return sendToApi("POST", "/ideas", newIdea, ideaSchema);
}

/** The Task the Idea became, in Backlog in the Project. */
export function shapeIdea(id: string, projectId: string): Promise<Task> {
  return sendToApi("POST", `${ideaPath(id)}/shape`, { projectId }, taskSchema);
}

export function dropIdea(id: string): Promise<Idea> {
  return sendToApi("POST", `${ideaPath(id)}/drop`, {}, ideaSchema);
}

export function restoreIdea(id: string): Promise<Idea> {
  return sendToApi("POST", `${ideaPath(id)}/restore`, {}, ideaSchema);
}

export function createTask(newTask: NewTask): Promise<Task> {
  return sendToApi("POST", "/tasks", newTask, taskSchema);
}

export function changePriority(id: string, priority: Priority): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/priority`, { priority }, taskSchema);
}

/** Moves a Task between two others in its column; it takes the priority that keeps it there. */
export function placeTask(id: string, placement: TaskPlacement): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/place`, placement, taskSchema);
}

export function dropTask(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/drop`, {}, taskSchema);
}

export function addLink(owner: AttachmentOwner, link: NewLink): Promise<Attachment> {
  return sendToApi("POST", `${ownerPath(owner)}/attachments/links`, link, attachmentSchema);
}

export function addFile(owner: AttachmentOwner, file: File): Promise<Attachment> {
  return sendFileToApi(`${ownerPath(owner)}/attachments/files`, file, attachmentSchema, {
    mediaType: file.type,
  });
}

export function removeAttachment(id: string): Promise<void> {
  return deleteFromApi(`/attachments/${encodeURIComponent(id)}`);
}

/** Where a file Attachment opens: images and Markdown show, any other file downloads. */
export function attachmentContentUrl(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/content`;
}

async function readDocument(id: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(attachmentContentUrl(id), { signal });
  if (!response.ok) throw new Error(`The document can't be read: ${response.statusText}.`);
  return response.text();
}

/**
 * Each Work event makes its kind stale: ["ideas"] and ["tasks"] cover the lists and each record,
 * ["attachments"] every owner's list. Shaping touches all three, so each of its events names
 * what it changed.
 */
export const workEventInvalidations: Readonly<
  Record<WorkWebEvent["type"], EventInvalidations[string]>
> = {
  "idea.captured": () => [IDEAS],
  "idea.shaped": () => [IDEAS, TASKS],
  "idea.dropped": () => [IDEAS],
  "idea.restored": () => [IDEAS],
  "task.created": () => [TASKS],
  "task.state-changed": () => [TASKS],
  "task.priority-changed": () => [TASKS],
  "task.reordered": () => [TASKS],
  "task.plan-proposed": () => [TASKS],
  "task.plan-confirmed": () => [TASKS],
  "task.definition-of-done-proposed": () => [TASKS],
  "task.definition-of-done-confirmed": () => [TASKS],
  "task.pipeline-proposed": () => [TASKS],
  "task.pipeline-confirmed": () => [TASKS],
  "attachment.added": () => [ATTACHMENTS],
  "attachment.moved": () => [ATTACHMENTS],
  "attachment.removed": () => [ATTACHMENTS],
};

function ownerId(owner: AttachmentOwner): string {
  return owner.kind === "idea" ? owner.ideaId : owner.taskId;
}

function ownerPath(owner: AttachmentOwner): `/${string}` {
  return owner.kind === "idea" ? ideaPath(owner.ideaId) : taskPath(owner.taskId);
}

function ideaPath(id: string): `/${string}` {
  return `/ideas/${encodeURIComponent(id)}`;
}

function taskPath(id: string): `/${string}` {
  return `/tasks/${encodeURIComponent(id)}`;
}
