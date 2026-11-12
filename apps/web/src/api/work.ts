import { queryOptions, type QueryKey } from "@tanstack/react-query";
import {
  archivedInitiativesPageSchema,
  autoModeSettingSchema,
  attachmentListSchema,
  attachmentSchema,
  ideaListSchema,
  ideaSchema,
  initiativeListSchema,
  initiativeSchema,
  fireAlarmSchema,
  officeWideLimitSchema,
  archivePeriodSchema,
  projectOnboardingListSchema,
  readinessSchema,
  readyTasksStartedSchema,
  savedViewListSchema,
  savedViewSchema,
  searchResultsSchema,
  queueSchema,
  startAnswerSchema,
  startCheckSchema,
  taskMoveCheckSchema,
  taskListSchema,
  taskSchema,
  taskUsageEstimateListSchema,
  usageSettingsSchema,
  type ArchiveStateFilter,
  type Attachment,
  type AttachmentOwner,
  type Idea,
  type Initiative,
  type InitiativePipelineChoice,
  type NewIdea,
  type NewInitiativeTask,
  type NewLink,
  type NewSavedView,
  type NewTask,
  type OfficeWideLimit,
  type ArchivePeriod,
  type OutcomeChange,
  type OverlapChoice,
  type PlanChange,
  type Priority,
  type ProjectFilter,
  type Readiness,
  type ReadyTasksStarted,
  type SavedView,
  type ShortNameChange,
  type QueuedTask,
  type StartAnswer,
  type StartCheck,
  type AllClear,
  type FireAlarm,
  type Task,
  type TaskMoveCheck,
  type TaskPlacement,
  type TaskUsageEstimateList,
  type UsageSettings,
  type WebEvent,
  type WorkWebEvent,
} from "@the-office/contracts";
import {
  deleteFromApi,
  deleteFromApiReturning,
  getFromApi,
  sendFileToApi,
  sendToApi,
  sendToApiWithNoAnswer,
} from "./api-client.ts";
import type { EventInvalidations } from "./event-stream-provider.tsx";
import { RUN_ENVIRONMENTS } from "./projects.ts";

const IDEAS = ["ideas"] as const;
const INITIATIVES = ["initiatives"] as const;
export const TASKS = ["tasks"] as const;
const ATTACHMENTS = ["attachments"] as const;
const OFFICE_WIDE_LIMIT = ["settings", "office-wide-limit"] as const;
const ARCHIVE_PERIOD = ["settings", "archive-period"] as const;
const USAGE_SETTINGS = ["settings", "usage"] as const;
const AUTO_MODE = ["settings", "auto-mode"] as const;
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

/** What a page of the Archive of Initiatives is asked for. */
export interface ArchivedInitiativesAsked {
  readonly query: string;
  readonly state: ArchiveStateFilter;
  /** Counting from 1. */
  readonly page: number;
  readonly projects: ProjectFilter;
}

export const initiativeQueries = {
  /**
   * Every Initiative, archived ones too, the newest first; a Task's events refresh it, as it spans
   * their Projects.
   */
  list: () =>
    queryOptions({
      queryKey: INITIATIVES,
      queryFn: ({ signal }) => getFromApi("/initiatives", initiativeListSchema, signal),
    }),
  /** The Initiatives whose name or outcome the words match, archived ones too. */
  matching: (query: string) =>
    queryOptions({
      queryKey: [...INITIATIVES, "matching", query],
      queryFn: ({ signal }) =>
        getFromApi(`/initiatives?query=${encodeURIComponent(query)}`, initiativeListSchema, signal),
    }),
  /** A page of the Archive, searched, filtered and counted by the service. */
  archived: ({ query, state, page, projects }: ArchivedInitiativesAsked) =>
    queryOptions({
      queryKey: [...INITIATIVES, "archived", { query, state, page, projects }],
      queryFn: ({ signal }) => {
        const search = new URLSearchParams({ query, state, page: String(page) });
        if (projects !== "all") for (const id of projects) search.append("project", id);
        return getFromApi(
          `/initiatives/archived?${search.toString()}`,
          archivedInitiativesPageSchema,
          signal,
        );
      },
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

/** Settings › Office limits: how many days a finished Task stays on the board. */
export const archivePeriodQuery = () =>
  queryOptions({
    queryKey: ARCHIVE_PERIOD,
    queryFn: ({ signal }) => getFromApi("/settings/archive-period", archivePeriodSchema, signal),
  });

export function changeArchivePeriod(archivePeriod: number): Promise<ArchivePeriod> {
  return sendToApi("PUT", "/settings/archive-period", { archivePeriod }, archivePeriodSchema);
}

/** Whether Make a plan starts in auto mode: the user's last choice there, off until first made. */
export const autoModeQuery = () =>
  queryOptions({
    queryKey: AUTO_MODE,
    queryFn: ({ signal }) => getFromApi("/settings/auto-mode", autoModeSettingSchema, signal),
  });

/** Settings › Office limits: the ticked measures and every engine id's caps. */
export const usageSettingsQuery = () =>
  queryOptions({
    queryKey: USAGE_SETTINGS,
    queryFn: ({ signal }) => getFromApi("/settings/usage", usageSettingsSchema, signal),
  });

export function changeUsageSettings(settings: UsageSettings): Promise<UsageSettings> {
  return sendToApi("PUT", "/settings/usage", settings, usageSettingsSchema);
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
  /**
   * Every Ready Task's Usage estimate, queued ones too; empty with no measure ticked. Under the
   * Tasks' key, so any Task event and a change of the measures refresh it.
   */
  usageEstimates: () =>
    queryOptions({
      queryKey: [...TASKS, "usage-estimates"],
      queryFn: ({ signal }): Promise<TaskUsageEstimateList> =>
        getFromApi("/usage-estimates", taskUsageEstimateListSchema, signal),
    }),
  /** Why Start would be refused now; under the Task's key, so any Task event refreshes it. */
  startCheck: (id: string) =>
    queryOptions({
      queryKey: [...TASKS, id, "start"],
      queryFn: ({ signal }): Promise<StartCheck> =>
        getFromApi(`${taskPath(id)}/start`, startCheckSchema, signal),
    }),
  /** Why the Task can't move to another Project now; under the Task's key, so any Task event refreshes it. */
  moveCheck: (id: string) =>
    queryOptions({
      queryKey: [...TASKS, id, "move"],
      queryFn: ({ signal }): Promise<TaskMoveCheck> =>
        getFromApi(`${taskPath(id)}/move`, taskMoveCheckSchema, signal),
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
  /** A text file Attachment's text, up to `SHOWN_TEXT_LIMIT`; it never changes. */
  text: (id: string) =>
    queryOptions({
      queryKey: [...ATTACHMENTS, id, "text"],
      queryFn: ({ signal }) => readShownText(id, signal),
      staleTime: Number.POSITIVE_INFINITY,
    }),
};

/** The most of a text file the document window shows (spec §4.1): the rest is in the download. */
export const SHOWN_TEXT_LIMIT = 1024 * 1024;

/** A text file's text as the document window shows it. */
export interface ShownText {
  readonly text: string;
  /** Whether the file goes on past `SHOWN_TEXT_LIMIT`. */
  readonly cut: boolean;
}

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

/**
 * Plan the Initiative: a new planning Thread with the Planner, who plans its Backlog Tasks at once,
 * in auto mode or not. The choice becomes the remembered default.
 */
export function planInitiative(id: string, autoMode: boolean): Promise<Initiative> {
  return sendToApi("POST", `${initiativePath(id)}/planning`, { autoMode }, initiativeSchema);
}

/**
 * Start Ready Tasks: the normal Start on each of the Initiative's Ready Tasks, an Overlap queued
 * behind; what started, what was queued and what was refused.
 */
export function startReadyTasks(id: string): Promise<ReadyTasksStarted> {
  return sendToApi("POST", `${initiativePath(id)}/start`, {}, readyTasksStartedSchema);
}

/** "Confirm the Initiative": active, or done at once when its Tasks already are. */
export function confirmInitiative(id: string): Promise<Initiative> {
  return sendToApi("POST", `${initiativePath(id)}/confirm`, {}, initiativeSchema);
}

/** Its Tasks stay as they are. */
export function dropInitiative(id: string): Promise<Initiative> {
  return sendToApi("POST", `${initiativePath(id)}/drop`, {}, initiativeSchema);
}

/** Archive: a Done or Dropped Initiative leaves the board, its state kept. */
export function archiveInitiative(id: string): Promise<Initiative> {
  return sendToApi("POST", `${initiativePath(id)}/archive`, {}, initiativeSchema);
}

/** Restore: an archived Initiative returns to the board in the state it had. */
export function restoreInitiative(id: string): Promise<Initiative> {
  return sendToApi("POST", `${initiativePath(id)}/restore`, {}, initiativeSchema);
}

/** The user's outcome, while the Initiative is being shaped. */
export function writeInitiativeOutcome(id: string, change: OutcomeChange): Promise<Initiative> {
  return sendToApi("PUT", `${initiativePath(id)}/outcome`, change, initiativeSchema);
}

/** The Initiative's Pipeline, a library Pipeline or None (null), chosen while it is being shaped. */
export function chooseInitiativePipeline(
  id: string,
  pipelineId: InitiativePipelineChoice["pipelineId"],
): Promise<Initiative> {
  const choice: InitiativePipelineChoice = { pipelineId };
  return sendToApi("PUT", `${initiativePath(id)}/pipeline`, choice, initiativeSchema);
}

/** The Short name its branches are named by, edited while it is being shaped with a Pipeline. */
export function writeShortName(id: string, shortName: string): Promise<Initiative> {
  const change: ShortNameChange = { shortName };
  return sendToApi("PUT", `${initiativePath(id)}/short-name`, change, initiativeSchema);
}

/** "Add a Task": in Shaping or Backlog in its Project, as the Initiative stands, waiting for the Tasks it names. */
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

/** The user's Description, until the Task starts; empty leaves none. */
export function changeDescription(id: string, description: string): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/description`, { description }, taskSchema);
}

/** Plan with the Planner: the Task moves to Planning, and its planning Thread opens. */
export function planTask(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/planning`, {}, taskSchema);
}

/**
 * Make a plan: the Task moves to Planning, in auto mode or not, and the Planner starts at once
 * from its record. The choice becomes the remembered default.
 */
export function makeAPlan(id: string, autoMode: boolean): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/make-a-plan`, { autoMode }, taskSchema);
}

/**
 * A Plan as the user saves it: its words and files to change, always sent whole. The Planner's
 * token estimate, which the Task page doesn't edit, is kept by leaving it out.
 */
export type PlanSaving = Required<Omit<PlanChange, "estimatedTokens">>;

/**
 * Save: a change leaves the Plan unconfirmed, and moves a Ready Task back to Planning, or to
 * Backlog when it has no planning Thread.
 */
export function savePlan(id: string, plan: PlanSaving): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/plan`, plan, taskSchema);
}

/** Confirm: the Plan as it reads. */
export function confirmPlan(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/plan/confirm`, {}, taskSchema);
}

/** Save, as with the Plan. */
export function saveDefinitionOfDone(
  id: string,
  definitionOfDone: readonly string[],
): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/definition-of-done`, { definitionOfDone }, taskSchema);
}

/** Confirm: the Definition of Done as it reads. */
export function confirmDefinitionOfDone(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/definition-of-done/confirm`, {}, taskSchema);
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
  return sendToApiWithNoAnswer("POST", `/queue/${encodeURIComponent(taskId)}/move-up`, {});
}

/** Move to top: the first place in the queue, ahead of every other queued Task. */
export function moveToTopOfQueue(taskId: string): Promise<void> {
  return sendToApiWithNoAnswer("POST", `/queue/${encodeURIComponent(taskId)}/move-to-top`, {});
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

/** Move: the Task goes to another Project, back in Backlog with both parts Not confirmed. */
export function moveTask(id: string, projectId: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/move`, { projectId }, taskSchema);
}

export function dropTask(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/drop`, {}, taskSchema);
}

/** Archive: a Done or Dropped Task leaves the board, its state as it was. */
export function archiveTask(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/archive`, {}, taskSchema);
}

/** Restore: an archived Task returns to the board in the state it had. */
export function restoreTask(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/restore`, {}, taskSchema);
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

/**
 * Where a file Attachment's content is: images, Markdown, other text files as plain text and HTML
 * show inline, any other file downloads; a `download` link saves any of them
 * (`AttachmentDownloadLink`).
 */
export function attachmentContentUrl(id: string): string {
  return `/api/attachments/${encodeURIComponent(id)}/content`;
}

/**
 * Reads no more of the file than the window shows. A cut text ends at its last whole line, unless
 * that line is all there is, as in a minified file.
 */
async function readShownText(id: string, signal?: AbortSignal): Promise<ShownText> {
  const response = await fetch(attachmentContentUrl(id), { signal });
  if (!response.ok || response.body === null) {
    throw new Error(`The file can't be read: ${response.statusText}.`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { text: text + decoder.decode(), cut: false };
      const room = SHOWN_TEXT_LIMIT - bytesRead;
      if (value.byteLength > room) {
        text += decoder.decode(value.subarray(0, room), { stream: true });
        const lastLineEnd = text.lastIndexOf("\n");
        return { text: lastLineEnd > 0 ? text.slice(0, lastLineEnd) : text, cut: true };
      }
      text += decoder.decode(value, { stream: true });
      bytesRead += value.byteLength;
    }
  } finally {
    await reader.cancel();
  }
}

/**
 * The Task's conversation tabs (`threadQueries.conversationOnTask`, kept by api/conversations.ts,
 * which reads this module): written out here, as importing it back would be a cycle.
 */
function taskConversationKeys(event: WebEvent): QueryKey[] {
  return "taskId" in event && typeof event.taskId === "string"
    ? [["threads", "task", event.taskId, "conversation"]]
    : [];
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
  "initiative.pipeline-chosen": () => [INITIATIVES],
  "initiative.short-name-written": () => [INITIATIVES],
  "initiative.branch-made": () => [INITIATIVES],
  "initiative.archived": () => [INITIATIVES],
  "initiative.restored": () => [INITIATIVES],
  "initiative.planning-started": () => [INITIATIVES],
  "task.created": () => [TASKS, INITIATIVES, RUN_ENVIRONMENTS],
  // A move to Planning in its Initiative's planning Thread changes the Planner's tab too.
  "task.state-changed": (event) => [
    TASKS,
    INITIATIVES,
    RUN_ENVIRONMENTS,
    ...taskConversationKeys(event),
  ],
  "task.started": () => [TASKS],
  "task.paused": () => [TASKS],
  "task.stopped": () => [TASKS],
  "task.resumed": () => [TASKS],
  "task.queued": () => [TASKS],
  "task.left-queue": () => [TASKS],
  "task.queue-reasons-changed": () => [TASKS],
  "task.moved-up-in-queue": () => [TASKS],
  "task.archived": () => [TASKS],
  "task.restored": () => [TASKS],
  "task.priority-changed": () => [TASKS],
  "task.title-changed": () => [TASKS],
  "task.description-changed": () => [TASKS],
  "task.tags-changed": () => [TASKS],
  "task.marked-planned": () => [TASKS],
  "task.reordered": () => [TASKS],
  "task.dependency-added": () => [TASKS],
  "task.dependency-removed": () => [TASKS],
  // An Initiative's Projects are its Tasks'.
  "task.moved-to-project": () => [TASKS, INITIATIVES],
  "task.plan-proposed": () => [TASKS],
  "task.plan-saved": () => [TASKS],
  "task.plan-confirmed": () => [TASKS],
  "task.definition-of-done-proposed": () => [TASKS],
  "task.definition-of-done-saved": () => [TASKS],
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
  "archive-period.changed": () => [ARCHIVE_PERIOD],
  // Each Task's start check gives its Usage estimate in the ticked measures.
  "usage-settings.changed": () => [USAGE_SETTINGS, TASKS],
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
