import { queryOptions } from "@tanstack/react-query";
import {
  attachmentListSchema,
  attachmentSchema,
  ideaListSchema,
  ideaSchema,
  initiativeListSchema,
  initiativeSchema,
  fireAlarmSchema,
  officeWideLimitSchema,
  projectOnboardingListSchema,
  readinessSchema,
  savedViewListSchema,
  savedViewSchema,
  searchResultsSchema,
  queueSchema,
  startAnswerSchema,
  startCheckSchema,
  taskListSchema,
  taskSchema,
  type Attachment,
  type AttachmentOwner,
  type Idea,
  type Initiative,
  type NewIdea,
  type NewInitiativeTask,
  type NewLink,
  type NewSavedView,
  type NewTask,
  type OfficeWideLimit,
  type OutcomeChange,
  type OverlapChoice,
  type PlanChange,
  type Priority,
  type ProjectFilter,
  type Readiness,
  type SavedView,
  type QueuedTask,
  type StartAnswer,
  type StartCheck,
  type AllClear,
  type FireAlarm,
  type Task,
  type TaskPlacement,
  type WorkWebEvent,
} from "@the-office/contracts";
import {
  deleteFromApi,
  deleteFromApiReturning,
  getFromApi,
  postToApi,
  sendFileToApi,
  sendToApi,
} from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";

const IDEAS = ["ideas"] as const;
const INITIATIVES = ["initiatives"] as const;
export const TASKS = ["tasks"] as const;
const ATTACHMENTS = ["attachments"] as const;
const OFFICE_WIDE_LIMIT = ["settings", "office-wide-limit"] as const;
const SAVED_VIEWS = ["saved-views"] as const;
/** The fire alarm and the Threads it is lifted for. */
export const FIRE_ALARM = ["fire-alarm"] as const;

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

export const initiativeQueries = {
  /** Every Initiative, the newest first; a Task's events refresh it, as it spans their Projects. */
  list: () =>
    queryOptions({
      queryKey: INITIATIVES,
      queryFn: ({ signal }) => getFromApi("/initiatives", initiativeListSchema, signal),
    }),
  one: (id: string) =>
    queryOptions({
      queryKey: [...INITIATIVES, id],
      queryFn: ({ signal }) => getFromApi(initiativePath(id), initiativeSchema, signal),
    }),
};

/** Settings › Office limits: how many Tasks may be started at once across The Office. */
export const officeWideLimitQuery = () =>
  queryOptions({
    queryKey: OFFICE_WIDE_LIMIT,
    queryFn: ({ signal }) =>
      getFromApi("/settings/office-wide-limit", officeWideLimitSchema, signal),
  });

export function changeOfficeWideLimit(officeWideLimit: number): Promise<OfficeWideLimit> {
  return sendToApi(
    "PUT",
    "/settings/office-wide-limit",
    { officeWideLimit },
    officeWideLimitSchema,
  );
}

/** Sounds the one Office-wide fire alarm (spec §2.8); Now carries it from then on. */
export function soundTheAlarm(): Promise<FireAlarm> {
  return sendToApi("POST", "/fire-alarm/sound", {}, fireAlarmSchema);
}

/** The all clear: every Task the alarm paused resumes, unless the user holds or drops it. */
export function giveTheAllClear(choices: AllClear): Promise<FireAlarm> {
  return sendToApi("POST", "/fire-alarm/all-clear", choices, fireAlarmSchema);
}

/** The board's Saved views, in the order saved. */
export const savedViewsQuery = () =>
  queryOptions({
    queryKey: SAVED_VIEWS,
    queryFn: ({ signal }) => getFromApi("/saved-views", savedViewListSchema, signal),
  });

/** Saves the board's filters under a name; refused with the reasons, as for a name taken. */
export function saveView(newSavedView: NewSavedView): Promise<SavedView> {
  return sendToApi("POST", "/saved-views", newSavedView, savedViewSchema);
}

export function removeView(id: string): Promise<void> {
  return deleteFromApi(`/saved-views/${encodeURIComponent(id)}`);
}

/**
 * What the top bar's search finds in the Projects the Project filter shows, each named as a
 * `project`; nothing for no words.
 */
export const searchQuery = (query: string, filter: ProjectFilter) =>
  queryOptions({
    queryKey: ["search", query, filter],
    queryFn: ({ signal }) => {
      const projects =
        filter === "all" ? [] : filter.map((id): [string, string] => ["project", id]);
      const params = new URLSearchParams([["query", query], ...projects]);
      return getFromApi(`/search?${params}`, searchResultsSchema, signal);
    },
  });

export const taskQueries = {
  /** Every Task, in the board's order: by priority, then by manual order. */
  list: () =>
    queryOptions({
      queryKey: TASKS,
      queryFn: ({ signal }) => getFromApi("/tasks", taskListSchema, signal),
    }),
  /** The Tasks the board's search matches, by the service's full-text search; under the Tasks' key. */
  matching: (query: string) =>
    queryOptions({
      queryKey: [...TASKS, "matching", query],
      queryFn: ({ signal }) =>
        getFromApi(`/tasks?query=${encodeURIComponent(query)}`, taskListSchema, signal),
    }),
  one: (id: string) =>
    queryOptions({
      queryKey: [...TASKS, id],
      queryFn: ({ signal }) => getFromApi(taskPath(id), taskSchema, signal),
    }),
  /** The queue for Start, first place first; under the Tasks' key, so any Task event refreshes it. */
  queue: () =>
    queryOptions({
      queryKey: [...TASKS, "queue"],
      queryFn: ({ signal }): Promise<QueuedTask[]> => getFromApi("/queue", queueSchema, signal),
    }),
  /** Why Start would be refused now; under the Task's key, so any Task event refreshes it. */
  startCheck: (id: string) =>
    queryOptions({
      queryKey: [...TASKS, id, "start"],
      queryFn: ({ signal }): Promise<StartCheck> =>
        getFromApi(`${taskPath(id)}/start`, startCheckSchema, signal),
    }),
  /** The "Before Ready" checklist; under the Task's key, and a Decision's events refresh it too. */
  readiness: (id: string) =>
    queryOptions({
      queryKey: [...TASKS, id, "readiness"],
      queryFn: ({ signal }): Promise<Readiness> =>
        getFromApi(`${taskPath(id)}/readiness`, readinessSchema, signal),
    }),
};

/**
 * Every Project's onboarding, read from its Onboard Task; a Project not listed has none. Under the
 * Tasks' key, so any Task event refreshes it.
 */
export const onboardingsQuery = () =>
  queryOptions({
    queryKey: [...TASKS, "onboardings"],
    queryFn: ({ signal }) => getFromApi("/onboardings", projectOnboardingListSchema, signal),
  });

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

/** Plan as a Task with the Planner: the Task the Idea became, in Planning with its Thread. */
export function planIdea(id: string, projectId: string): Promise<Task> {
  return sendToApi("POST", `${ideaPath(id)}/plan`, { projectId }, taskSchema);
}

/** The Initiative the Idea became, being shaped; with the CTO in its Thread when one is hired. */
export function shapeIntoInitiative(id: string): Promise<Initiative> {
  return sendToApi("POST", `${ideaPath(id)}/initiative`, {}, initiativeSchema);
}

/** A new shaping Thread with the CTO, who starts on it at once. */
export function startShapingThread(id: string): Promise<Initiative> {
  return sendToApi("POST", `${initiativePath(id)}/shaping`, {}, initiativeSchema);
}

/** "Confirm the Initiative": active, or done at once when its Tasks already are. */
export function confirmInitiative(id: string): Promise<Initiative> {
  return sendToApi("POST", `${initiativePath(id)}/confirm`, {}, initiativeSchema);
}

/** Its Tasks stay as they are. */
export function dropInitiative(id: string): Promise<Initiative> {
  return sendToApi("POST", `${initiativePath(id)}/drop`, {}, initiativeSchema);
}

/** The user's outcome, while the Initiative is being shaped. */
export function writeInitiativeOutcome(id: string, change: OutcomeChange): Promise<Initiative> {
  return sendToApi("PUT", `${initiativePath(id)}/outcome`, change, initiativeSchema);
}

/** "Add a Task": in Backlog in its Project, waiting for the Tasks it names. */
export function addTaskToInitiative(id: string, newTask: NewInitiativeTask): Promise<Task> {
  return sendToApi("POST", `${initiativePath(id)}/tasks`, newTask, taskSchema);
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

/** Sets the Task's Tags as given; the service keeps each lower-case, once. */
export function changeTags(id: string, tags: readonly string[]): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/tags`, { tags }, taskSchema);
}

/** Moves a Task between two others in its column; it takes the priority that keeps it there. */
export function placeTask(id: string, placement: TaskPlacement): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/place`, placement, taskSchema);
}

/** Plan with the Planner: the Task moves to Planning, and its planning Thread opens. */
export function planTask(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/planning`, {}, taskSchema);
}

/**
 * A Plan as the user confirms it: its words and files to change, always sent whole. The Planner's
 * token estimate, which the Task page doesn't edit, is kept by leaving it out.
 */
export type PlanConfirmation = Required<Omit<PlanChange, "estimatedTokens">>;

/** The user's Plan, confirmed: the proposed one exactly as shown, or their edit of it. */
export function confirmPlan(id: string, plan: PlanConfirmation): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/plan`, plan, taskSchema);
}

/** The user's Definition of Done, confirmed, as with the Plan. */
export function confirmDefinitionOfDone(
  id: string,
  definitionOfDone: readonly string[],
): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/definition-of-done`, { definitionOfDone }, taskSchema);
}

/** Sets the Task's Pipeline: the proposed one to confirm it, or another; either ends the proposal. */
export function setPipeline(id: string, pipelineId: string): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/pipeline`, { pipelineId }, taskSchema);
}

/** The Task waits for `blockerId` to be Done before it can start; refused with every reason. */
export function addDependency(id: string, blockerId: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/dependencies`, { blockerId }, taskSchema);
}

export function removeDependency(id: string, blockerId: string): Promise<Task> {
  return deleteFromApiReturning(
    `${taskPath(id)}/dependencies/${encodeURIComponent(blockerId)}`,
    taskSchema,
  );
}

/** Refused with the reasons until the Plan and the Definition of Done are confirmed. */
export function markReady(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/ready`, {}, taskSchema);
}

/**
 * Start: Ready → In progress, or into the queue when only a limit holds it or `onOverlap` queues
 * it behind the Tasks it overlaps; refused with the reasons when anything else does, or an Overlap
 * stands unanswered.
 */
export function startTask(id: string, onOverlap?: OverlapChoice): Promise<StartAnswer> {
  const request = onOverlap ? { onOverlap } : {};
  return sendToApi("POST", `${taskPath(id)}/start`, request, startAnswerSchema);
}

/** Take out of the queue: the Task stays Ready. */
export function takeOutOfQueue(taskId: string): Promise<void> {
  return deleteFromApi(`/queue/${encodeURIComponent(taskId)}`);
}

/** Move up: one place in the queue, past the Task ahead of it. */
export function moveUpInQueue(taskId: string): Promise<void> {
  return postToApi(`/queue/${encodeURIComponent(taskId)}/move-up`, {});
}

/** Pause: held once the Agent's current turn ends, its edits kept (spec §2.4). */
export function pauseTask(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/pause`, {}, taskSchema);
}

/** Stop: the Agent's turn is interrupted now and the Stage's uncommitted edits discarded. */
export function stopTask(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/stop`, {}, taskSchema);
}

/** Resume: a Paused Task goes on through the Context policy. */
export function resumeTask(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/resume`, {}, taskSchema);
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
 * Each Work event makes its kind stale: ["ideas"], ["initiatives"] and ["tasks"] cover the lists
 * and each record, ["attachments"] every owner's list. Shaping touches several, so each of its
 * events names what it changed; an Initiative spans its Tasks' Projects and is done with them.
 */
export const workEventInvalidations: Readonly<
  Record<WorkWebEvent["type"], EventInvalidations[string]>
> = {
  "idea.captured": () => [IDEAS],
  "idea.shaped": () => [IDEAS, TASKS],
  "idea.shaped-into-initiative": () => [IDEAS, INITIATIVES],
  "idea.dropped": () => [IDEAS],
  "idea.restored": () => [IDEAS],
  "initiative.created": () => [INITIATIVES],
  "initiative.state-changed": () => [INITIATIVES],
  "initiative.outcome-written": () => [INITIATIVES],
  "task.created": () => [TASKS, INITIATIVES],
  "task.state-changed": () => [TASKS, INITIATIVES],
  "task.started": () => [TASKS],
  "task.paused": () => [TASKS],
  "task.stopped": () => [TASKS],
  "task.resumed": () => [TASKS],
  "task.queued": () => [TASKS],
  "task.left-queue": () => [TASKS],
  "task.moved-up-in-queue": () => [TASKS],
  "task.priority-changed": () => [TASKS],
  "task.tags-changed": () => [TASKS],
  "task.reordered": () => [TASKS],
  "task.dependency-added": () => [TASKS],
  "task.dependency-removed": () => [TASKS],
  "task.plan-proposed": () => [TASKS],
  "task.plan-confirmed": () => [TASKS],
  "task.definition-of-done-proposed": () => [TASKS],
  "task.definition-of-done-confirmed": () => [TASKS],
  "task.pipeline-proposed": () => [TASKS],
  "task.pipeline-confirmed": () => [TASKS],
  "attachment.added": () => [ATTACHMENTS],
  "attachment.moved": () => [ATTACHMENTS],
  "attachment.removed": () => [ATTACHMENTS],
  "saved-view.saved": () => [SAVED_VIEWS],
  "saved-view.removed": () => [SAVED_VIEWS],
  // Each Task's start check reads the limit too.
  "office-wide-limit.changed": () => [OFFICE_WIDE_LIMIT, TASKS],
  // Each Task's start check reads the alarm too.
  "fire-alarm.sounded": () => [FIRE_ALARM, TASKS],
  "fire-alarm.all-clear": () => [FIRE_ALARM, TASKS],
};

function ownerId(owner: AttachmentOwner): string {
  switch (owner.kind) {
    case "idea":
      return owner.ideaId;
    case "initiative":
      return owner.initiativeId;
    case "task":
      return owner.taskId;
  }
}

function ownerPath(owner: AttachmentOwner): `/${string}` {
  switch (owner.kind) {
    case "idea":
      return ideaPath(owner.ideaId);
    case "initiative":
      return initiativePath(owner.initiativeId);
    case "task":
      return taskPath(owner.taskId);
  }
}

function initiativePath(id: string): `/${string}` {
  return `/initiatives/${encodeURIComponent(id)}`;
}

function ideaPath(id: string): `/${string}` {
  return `/ideas/${encodeURIComponent(id)}`;
}

function taskPath(id: string): `/${string}` {
  return `/tasks/${encodeURIComponent(id)}`;
}
