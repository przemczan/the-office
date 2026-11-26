import {
  queryOptions,
  useQueries,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  ADD_DEPENDENCY_ACTION,
  ADD_TO_INITIATIVE_ACTION,
  ARCHIVE_INITIATIVE_ACTION,
  ARCHIVE_TASK_ACTION,
  CHANGE_TASK_DEFINITION_OF_DONE_ACTION,
  CHANGE_TASK_DESCRIPTION_ACTION,
  CHANGE_TASK_KIND_ACTION,
  CHANGE_TASK_PLAN_ACTION,
  CHANGE_TASK_PRIORITY_ACTION,
  CHANGE_TASK_TITLE_ACTION,
  DROP_IDEA_ACTION,
  DROP_INITIATIVE_ACTION,
  DROP_TASK_ACTION,
  EDIT_IDEA_ACTION,
  REMOVE_DEPENDENCY_ACTION,
  RESTORE_IDEA_ACTION,
  RESTORE_INITIATIVE_ACTION,
  RESTORE_TASK_ACTION,
  TAKE_OUT_OF_INITIATIVE_ACTION,
  WRITE_INITIATIVE_OUTCOME_ACTION,
  historySchema,
  type History,
  archivedInitiativesPageSchema,
  autoModeSettingSchema,
  attachmentListSchema,
  attachmentSchema,
  conflictResolutionAnswerSchema,
  ideaListSchema,
  ideaSchema,
  initiativeListSchema,
  initiativeSchema,
  initiativePauseAnswerSchema,
  fireAlarmSchema,
  personTaskPageSchema,
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
  taskEngineCascadeSchema,
  taskSchema,
  taskUsageEstimateListSchema,
  taskWaysBackSchema,
  usageSettingsSchema,
  type ArchiveStateFilter,
  type Attachment,
  type AttachmentOwner,
  type Idea,
  type Initiative,
  type InitiativePauseAnswer,
  type InitiativePipelinesChange,
  type IdeaEdit,
  type IdeaShaping,
  type DropReason,
  type EngineId,
  type TaskKind,
  type MarkReadyRequest,
  type NewIdea,
  type NewInitiativeTask,
  type NewLink,
  type NewSavedView,
  type NewTask,
  type OfficeWideLimit,
  type ArchivePeriod,
  type OutcomeChange,
  type StartRequest,
  type PlanChange,
  type Priority,
  type ProjectFilter,
  type Readiness,
  type ReadyTasksStarted,
  type SavedView,
  type QueuedTask,
  type StartAnswer,
  type ConflictResolutionAnswer,
  type StartCheck,
  type AllClear,
  type FireAlarm,
  type FireAlarmWay,
  type SoundFireAlarm,
  type Task,
  type TaskMoveCheck,
  type TaskReopen,
  type TaskRestart,
  type TaskWaysBack,
  type TaskSummary,
  type TaskPersonEngineSettings,
  type TaskPlacement,
  type TaskUsageEstimateList,
  type UsageSettings,
  type WebEvent,
  type WorkFilter,
  type WorkWebEvent,
  workWebEventSchema,
} from "@the-office/contracts";
import {
  callOfficeAction,
  deleteFromApi,
  getFromApi,
  sendFileToApi,
  sendToApi,
  sendToApiWithNoAnswer,
  SignedOut,
} from "./api-client.ts";
import { attachmentCopiesOf } from "./attachment-copies.ts";
import { pagedQueryOptions } from "./pages.ts";
import type { EventCacheUpdates, EventInvalidations } from "./event-stream-provider.tsx";
import { ENGINE_CASCADE, taskEngineCascadeKey } from "./people.ts";
import { RUN_ENVIRONMENTS, TEST_TARGETS_SET_UPS } from "./projects.ts";

const IDEAS = ["ideas"] as const;
const INITIATIVES = ["initiatives"] as const;
export const TASKS = ["tasks"] as const;
/** The Tasks of people's Work tabs: under the Tasks' key, and read again as Threads start or rename. */
export const PERSON_TASKS = [...TASKS, "person"] as const;
const ATTACHMENTS = ["attachments"] as const;
const OFFICE_WIDE_LIMIT = ["settings", "office-wide-limit"] as const;
const ARCHIVE_PERIOD = ["settings", "archive-period"] as const;
const USAGE_SETTINGS = ["settings", "usage"] as const;
const AUTO_MODE = ["settings", "auto-mode"] as const;
const SAVED_VIEWS = ["saved-views"] as const;
const SEARCH = ["search"] as const;
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
  /** Its History, oldest first; under the Ideas' key, so their events refresh it. */
  history: (id: string) =>
    queryOptions({
      queryKey: [...IDEAS, id, "history"],
      queryFn: ({ signal }): Promise<History> =>
        getFromApi(`${ideaPath(id)}/history`, historySchema, signal),
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
  /** Its History, oldest first; under the Initiatives' key, so their events refresh it. */
  history: (id: string) =>
    queryOptions({
      queryKey: [...INITIATIVES, id, "history"],
      queryFn: ({ signal }): Promise<History> =>
        getFromApi(`${initiativePath(id)}/history`, historySchema, signal),
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

/**
 * Sounds the one Office-wide fire alarm in `way` (spec §2.8), or makes it stricter while it is on;
 * Now carries it from then on.
 */
export function soundTheAlarm(way: FireAlarmWay): Promise<FireAlarm> {
  const body: SoundFireAlarm = { way };
  return sendToApi("POST", "/fire-alarm/sound", body, fireAlarmSchema);
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
    queryKey: [...SEARCH, query, filter],
    queryFn: ({ signal }) => {
      const projects =
        filter === "all" ? [] : filter.map((id): [string, string] => ["project", id]);
      const params = new URLSearchParams([["query", query], ...projects]);
      return getFromApi(`/search?${params}`, searchResultsSchema, signal);
    },
  });

export const taskQueries = {
  /**
   * The Tasks on the board, never an archived one, in the board's order: by priority, then by
   * manual order. Each a Task's summary, without its long texts, which only `one` reads.
   */
  list: () =>
    queryOptions({
      queryKey: TASKS,
      queryFn: ({ signal }) => getFromApi("/tasks", taskListSchema, signal),
    }),
  /**
   * The archived Tasks, the last archived first, as summaries; under the Tasks' key, so whatever
   * refreshes the board's Tasks refreshes them too.
   */
  archived: () =>
    queryOptions({
      queryKey: [...TASKS, "archived"],
      queryFn: ({ signal }) => getFromApi("/tasks?archived=true", taskListSchema, signal),
    }),
  /**
   * The Tasks the board's search matches, by the service's full-text search; under the Tasks' key.
   */
  matching: (query: string) =>
    queryOptions({
      queryKey: [...TASKS, "matching", query],
      queryFn: ({ signal }) =>
        getFromApi(`/tasks?query=${encodeURIComponent(query)}`, taskListSchema, signal),
    }),
  /**
   * The person's Tasks on their Work tab, in the Work filter and the Project filter's Projects, a
   * page at a time, filtered and counted by the service.
   */
  ofPerson: (roleKey: string, filter: WorkFilter, projects: ProjectFilter) => {
    const search = new URLSearchParams({ filter });
    if (projects !== "all") for (const id of projects) search.append("project", id);
    return pagedQueryOptions(
      [...PERSON_TASKS, roleKey, { filter, projects }],
      `/roles/${encodeURIComponent(roleKey)}/tasks?${search.toString()}`,
      personTaskPageSchema,
    );
  },
  one: (id: string) =>
    queryOptions({
      queryKey: [...TASKS, id],
      queryFn: ({ signal }) => getFromApi(taskPath(id), taskSchema, signal),
    }),
  /** Its History, oldest first; under the Task's key, so any Task event refreshes it. */
  history: (id: string) =>
    queryOptions({
      queryKey: [...TASKS, id, "history"],
      queryFn: ({ signal }): Promise<History> =>
        getFromApi(`${taskPath(id)}/history`, historySchema, signal),
    }),
  /** What the Planner and each Role the Task's Stages name run on for it, and the level it comes from. */
  engineCascade: (id: string) =>
    queryOptions({
      queryKey: taskEngineCascadeKey(id),
      queryFn: ({ signal }) =>
        getFromApi(`${taskPath(id)}/engine-cascade`, taskEngineCascadeSchema, signal),
    }),
  /**
   * The queue for Start, first place first; under the Tasks' key, so any Task event refreshes it.
   */
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
  /**
   * Why the Task can't move to another Project now; under the Task's key, so any Task event
   * refreshes it.
   */
  moveCheck: (id: string) =>
    queryOptions({
      queryKey: [...TASKS, id, "move"],
      queryFn: ({ signal }): Promise<TaskMoveCheck> =>
        getFromApi(`${taskPath(id)}/move`, taskMoveCheckSchema, signal),
    }),
  /**
   * Restart from…, Start over and Reopen…, each offered or why not; under the Task's key, so any
   * Task event refreshes it.
   */
  waysBack: (id: string) =>
    queryOptions({
      queryKey: [...TASKS, id, "ways-back"],
      queryFn: ({ signal }): Promise<TaskWaysBack> =>
        getFromApi(`${taskPath(id)}/ways-back`, taskWaysBackSchema, signal),
    }),
  /** The "Before Ready" checklist; under the Task's key, and a Decision's events refresh it too. */
  readiness: (id: string) =>
    queryOptions({
      queryKey: [...TASKS, id, "readiness"],
      queryFn: ({ signal }): Promise<Readiness> =>
        getFromApi(`${taskPath(id)}/readiness`, readinessSchema, signal),
    }),
};

/** Every Task, on the board or archived, as `useEveryTask` reads them. */
export interface EveryTask {
  /** The board's Tasks, in its order, then the archived ones; none until both are read. */
  readonly data: readonly TaskSummary[] | undefined;
  readonly error: Error | null;
  readonly isPending: boolean;
}

/**
 * Every Task, the board's and the archived ones, for whatever looks a Task up by its id or names
 * it (a dependency, a Duplicate of, an Initiative's progress, a mention), which may be archived.
 * The board itself reads only `taskQueries.list()`.
 */
export function useEveryTask({ enabled = true }: { readonly enabled?: boolean } = {}): EveryTask {
  return useQueries({
    queries: [
      { ...taskQueries.list(), enabled },
      { ...taskQueries.archived(), enabled },
    ],
    combine: everyTaskOf,
  });
}

function everyTaskOf([board, archived]: [
  UseQueryResult<TaskSummary[]>,
  UseQueryResult<TaskSummary[]>,
]): EveryTask {
  return {
    data: board.data && archived.data ? [...board.data, ...archived.data] : undefined,
    error: board.error ?? archived.error,
    isPending: board.isPending || archived.isPending,
  };
}

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
  /**
   * A text file Attachment's text, up to `SHOWN_TEXT_LIMIT`; read again only when an Agent replaces
   * it, as its Attachments' events make every key under ["attachments"] stale.
   */
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

/** Its title, notes and Project, until it is shaped. */
export function editIdea(id: string, edit: IdeaEdit): Promise<Idea> {
  return callOfficeAction(EDIT_IDEA_ACTION, { ideaId: id, ...edit });
}

/** The Task the Idea became, in Backlog in the Project. */
export function shapeIdea(id: string, shaping: IdeaShaping): Promise<Task> {
  return sendToApi("POST", `${ideaPath(id)}/shape`, shaping, taskSchema);
}

/**
 * Plan as a Task with whoever holds Plans: the Task the Idea became, in Planning with its Thread.
 */
export function planIdea(id: string, projectId: string): Promise<Task> {
  return sendToApi("POST", `${ideaPath(id)}/plan`, { projectId }, taskSchema);
}

/**
 * The Initiative the Idea became, being shaped; with whoever shapes Initiatives in its Thread while
 * someone does.
 */
export function shapeIntoInitiative(id: string): Promise<Initiative> {
  return sendToApi("POST", `${ideaPath(id)}/initiative`, {}, initiativeSchema);
}

/** A new shaping Thread with whoever shapes Initiatives, who starts on it at once. */
export function startShapingThread(id: string): Promise<Initiative> {
  return sendToApi("POST", `${initiativePath(id)}/shaping`, {}, initiativeSchema);
}

/**
 * Plan the Initiative: a new planning Thread with whoever holds Plans, who plans its Backlog Tasks
 * at once, in auto mode or not. The choice becomes the remembered default.
 */
export function planInitiative(id: string, autoMode: boolean): Promise<Initiative> {
  return sendToApi("POST", `${initiativePath(id)}/planning`, { autoMode }, initiativeSchema);
}

/**
 * Plan with…: a new planning Thread with whoever holds Plans, who waits for the user's first
 * message on how to plan the Initiative, with auto mode off and the remembered default unchanged.
 */
export function planInitiativeWith(id: string): Promise<Initiative> {
  return sendToApi("POST", `${initiativePath(id)}/plan-with`, {}, initiativeSchema);
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

/**
 * "Back to Shaping": the active Initiative is shaping again, its Tasks in Backlog, Planning or
 * Ready move to Shaping and its branches are removed.
 */
export function initiativeBackToShaping(id: string): Promise<Initiative> {
  return sendToApi("POST", `${initiativePath(id)}/back-to-shaping`, {}, initiativeSchema);
}

/**
 * Pause the Initiative: its Tasks In progress or Waiting on you are paused, and none of its Tasks
 * starts until it is resumed; the Tasks it paused.
 */
export function pauseInitiative(id: string): Promise<InitiativePauseAnswer> {
  return sendToApi("POST", `${initiativePath(id)}/pause`, {}, initiativePauseAnswerSchema);
}

/** Resume the Initiative: the Tasks its Pause paused go on; the Tasks it resumed. */
export function resumeInitiative(id: string): Promise<InitiativePauseAnswer> {
  return sendToApi("POST", `${initiativePath(id)}/resume`, {}, initiativePauseAnswerSchema);
}

/** Its Tasks stay as they are. */
export function dropInitiative(id: string): Promise<Initiative> {
  return callOfficeAction(DROP_INITIATIVE_ACTION, { initiativeId: id });
}

/** Archive: a Done or Dropped Initiative leaves the board, its state kept. */
export function archiveInitiative(id: string): Promise<Initiative> {
  return callOfficeAction(ARCHIVE_INITIATIVE_ACTION, { initiativeId: id });
}

/** Restore: an archived Initiative returns to the board in the state it had. */
export function restoreInitiative(id: string): Promise<Initiative> {
  return callOfficeAction(RESTORE_INITIATIVE_ACTION, { initiativeId: id });
}

/** The user's outcome, while the Initiative is being shaped. */
export function writeInitiativeOutcome(id: string, change: OutcomeChange): Promise<Initiative> {
  return callOfficeAction(WRITE_INITIATIVE_OUTCOME_ACTION, { initiativeId: id, ...change });
}

/**
 * The Initiative's Pipelines block saved as a whole while it is being shaped: each Project's
 * Pipeline, an office-wide one, one of that Project's own or None (null), and the Short name its
 * branch is named by.
 */
export function setInitiativePipelines(
  id: string,
  change: InitiativePipelinesChange,
): Promise<Initiative> {
  return sendToApi("PUT", `${initiativePath(id)}/pipelines`, change, initiativeSchema);
}

/**
 * "Add a Task": in Shaping or Backlog in its Project, as the Initiative stands, waiting for the
 * Tasks it names.
 */
export function addTaskToInitiative(id: string, newTask: NewInitiativeTask): Promise<Task> {
  return sendToApi("POST", `${initiativePath(id)}/tasks`, newTask, taskSchema);
}

export function dropIdea(id: string): Promise<Idea> {
  return callOfficeAction(DROP_IDEA_ACTION, { ideaId: id });
}

export function restoreIdea(id: string): Promise<Idea> {
  return callOfficeAction(RESTORE_IDEA_ACTION, { ideaId: id });
}

export function createTask(newTask: NewTask): Promise<Task> {
  return sendToApi("POST", "/tasks", newTask, taskSchema);
}

export function changePriority(id: string, priority: Priority): Promise<Task> {
  return callOfficeAction(CHANGE_TASK_PRIORITY_ACTION, { taskId: id, priority });
}

/** The Task's Kind, until it is Done or Dropped. */
export function changeKind(id: string, kind: TaskKind): Promise<Task> {
  return callOfficeAction(CHANGE_TASK_KIND_ACTION, { taskId: id, kind });
}

/** The Task whose work caused this Bug; null for none. */
export function changeCausedBy(id: string, causedBy: string | null): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/caused-by`, { causedBy }, taskSchema);
}

/** The version the Bug was found in, free text; null for none. */
export function changeFoundInVersion(id: string, foundInVersion: string | null): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/found-in-version`, { foundInVersion }, taskSchema);
}

/** Sets the Task's Tags as given; the service keeps each lower-case, once. */
export function changeTags(id: string, tags: readonly string[]): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/tags`, { tags }, taskSchema);
}

/** Moves a Task between two others in its column; it takes the priority that keeps it there. */
export function placeTask(id: string, placement: TaskPlacement): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/place`, placement, taskSchema);
}

/** The Task's title, in any state but Done and Dropped. */
export function changeTitle(id: string, title: string): Promise<Task> {
  return callOfficeAction(CHANGE_TASK_TITLE_ACTION, { taskId: id, title });
}

/** The user's Description, until the Task starts; empty leaves none. */
export function changeDescription(id: string, description: string): Promise<Task> {
  return callOfficeAction(CHANGE_TASK_DESCRIPTION_ACTION, { taskId: id, description });
}

/** The Task's commit message, until Publish lands it; empty takes the default again. */
export function changeCommitMessage(id: string, message: string): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/commit-message`, { message }, taskSchema);
}

/**
 * The Task's engine override, an engine only, until Done or Dropped; null turns it off. With
 * `people`, its setting for each person (empty clears them); left out, the saved ones stay.
 */
export function changeTaskEngine(
  id: string,
  engineId: EngineId | null,
  people?: readonly TaskPersonEngineSettings[],
): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/engine`, { engineId, people }, taskSchema);
}

/** The Initiative's engine override, an engine only, until Done or Dropped; null turns it off. */
export function changeInitiativeEngine(id: string, engineId: EngineId | null): Promise<Initiative> {
  return sendToApi("PUT", `${initiativePath(id)}/engine`, { engineId }, initiativeSchema);
}

/** Plan with whoever holds Plans: the Task moves to Planning, and its planning Thread opens. */
export function planTask(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/planning`, {}, taskSchema);
}

/**
 * Make a plan: the Task moves to Planning, in auto mode or not, and whoever holds Plans starts at
 * once from its record. The choice becomes the remembered default.
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
  return callOfficeAction(CHANGE_TASK_PLAN_ACTION, { taskId: id, ...plan });
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
  return callOfficeAction(CHANGE_TASK_DEFINITION_OF_DONE_ACTION, {
    taskId: id,
    definitionOfDone: [...definitionOfDone],
  });
}

/** Confirm: the Definition of Done as it reads. */
export function confirmDefinitionOfDone(id: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/definition-of-done/confirm`, {}, taskSchema);
}

/**
 * Sets the Task's Pipeline: the proposed one to confirm it, or another; either ends the proposal.
 */
export function setPipeline(id: string, pipelineId: string): Promise<Task> {
  return sendToApi("PUT", `${taskPath(id)}/pipeline`, { pipelineId }, taskSchema);
}

/** The Task waits for `blockerId` to be Done before it can start; refused with every reason. */
export function addDependency(id: string, blockerId: string): Promise<Task> {
  return callOfficeAction(ADD_DEPENDENCY_ACTION, { taskId: id, blockerId });
}

export function removeDependency(id: string, blockerId: string): Promise<Task> {
  return callOfficeAction(REMOVE_DEPENDENCY_ACTION, { taskId: id, blockerId });
}

/** The Task joins the Initiative; refused with every reason. */
export function addToInitiative(initiativeId: string, taskId: string): Promise<Task> {
  return callOfficeAction(ADD_TO_INITIATIVE_ACTION, { initiativeId, taskId });
}

/** The Task leaves the Initiative; refused with every reason. */
export function takeOutOfInitiative(initiativeId: string, taskId: string): Promise<Task> {
  return callOfficeAction(TAKE_OUT_OF_INITIATIVE_ACTION, { initiativeId, taskId });
}

/**
 * Refused with the reasons until the Plan and the Definition of Done are confirmed, unless the
 * request confirms them as they stand; a Pipeline and no open Decision are needed either way.
 */
export function markReady(id: string, request: MarkReadyRequest = {}): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/ready`, request, taskSchema);
}

/**
 * Start: Ready → In progress, or into the queue when only a limit holds it or `onOverlap` queues
 * it behind the Tasks it overlaps; refused with the reasons when anything else does, or an Overlap
 * stands unanswered. `onUsageCaps` starts it anyway past its usage caps, never queueing it.
 */
export function startTask(id: string, request: StartRequest = {}): Promise<StartAnswer> {
  return sendToApi("POST", `${taskPath(id)}/start`, request, startAnswerSchema);
}

/**
 * Resolve conflicts on the pull request the Task opened: the Conflict resolution Task made and
 * started, queued, or left Ready with Start's reasons; or the one already open. Refused with the
 * reasons when no Task can be made.
 */
export function resolveConflicts(taskId: string): Promise<ConflictResolutionAnswer> {
  return sendToApi(
    "POST",
    `${taskPath(taskId)}/resolve-conflicts`,
    {},
    conflictResolutionAnswerSchema,
  );
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

/**
 * Restart from…: the held run of a Task the user paused or stopped ends, its uncommitted edits
 * discarded, and the Task goes on from the Stage picked, briefed with the feedback.
 */
export function restartTask(id: string, restart: TaskRestart): Promise<void> {
  return sendToApiWithNoAnswer("POST", `${taskPath(id)}/restart`, restart);
}

/** Start over: the paused Task goes to Ready, its branch reset to the base with `resetBranch`. */
export function startTaskOver(id: string, resetBranch: boolean): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/start-over`, { resetBranch }, taskSchema);
}

/** Reopen…: a Dropped Task goes back to Backlog or Ready, started over when it had started. */
export function reopenTask(id: string, reopen: TaskReopen): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/reopen`, reopen, taskSchema);
}

/** Move: the Task goes to another Project, back in Backlog with both parts Not confirmed. */
export function moveTask(id: string, projectId: string): Promise<Task> {
  return sendToApi("POST", `${taskPath(id)}/move`, { projectId }, taskSchema);
}

export function dropTask(id: string, reason?: DropReason): Promise<Task> {
  return callOfficeAction(DROP_TASK_ACTION, reason ? { taskId: id, reason } : { taskId: id });
}

/** Archive: a Done or Dropped Task leaves the board, its state as it was. */
export function archiveTask(id: string): Promise<Task> {
  return callOfficeAction(ARCHIVE_TASK_ACTION, { taskId: id });
}

/** Restore: an archived Task returns to the board in the state it had. */
export function restoreTask(id: string): Promise<Task> {
  return callOfficeAction(RESTORE_TASK_ACTION, { taskId: id });
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
 * (`AttachmentDownloadLink`). A replaced file's address names its copy (`AttachmentCopies`), so an
 * open image or preview loads the new one.
 */
export function attachmentContentUrl(id: string, copy = 0): string {
  const url = `/api/attachments/${encodeURIComponent(id)}/content`;
  return copy === 0 ? url : `${url}?copy=${copy}`;
}

/**
 * Reads no more of the file than the window shows. A cut text ends at its last whole line, unless
 * that line is all there is, as in a minified file.
 */
async function readShownText(id: string, signal?: AbortSignal): Promise<ShownText> {
  // Asked of the service every time: an Agent's new copy keeps the address.
  const response = await fetch(attachmentContentUrl(id), { signal, cache: "no-cache" });
  if (response.status === 401) throw new SignedOut();
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
 * events names what it changed; an Initiative spans its Tasks' Projects and is done with them. An
 * Attachment's events change what the top bar's search finds too, as it finds documents.
 */
export const workEventInvalidations: Readonly<
  Record<Exclude<WorkWebEvent["type"], ReplacingEventType>, EventInvalidations[string]>
> = {
  "idea.captured": () => [IDEAS],
  "idea.edited": () => [IDEAS],
  "idea.shaped": () => [IDEAS, TASKS],
  "idea.shaped-into-initiative": () => [IDEAS, INITIATIVES],
  "idea.dropped": () => [IDEAS],
  "idea.restored": () => [IDEAS],
  "initiative.created": () => [INITIATIVES],
  "initiative.state-changed": () => [INITIATIVES],
  "initiative.outcome-written": () => [INITIATIVES],
  "initiative.pipeline-chosen": () => [INITIATIVES],
  "initiative.pipelines-set": () => [INITIATIVES],
  // Its Tasks with no override of their own take it, and so does what their Roles run on.
  "initiative.engine-override-set": () => [INITIATIVES, TASKS, ENGINE_CASCADE],
  "initiative.short-name-written": () => [INITIATIVES],
  "initiative.branch-made": () => [INITIATIVES],
  "initiative.branch-deleted": () => [INITIATIVES],
  "task.branch-deleted": () => [TASKS],
  "initiative.archived": () => [INITIATIVES],
  "initiative.restored": () => [INITIATIVES],
  // A Task's Start check and its place in the queue wait on the Initiative's Pause.
  "initiative.paused": () => [INITIATIVES, TASKS],
  "initiative.resumed": () => [INITIATIVES, TASKS],
  "initiative.planning-started": () => [INITIATIVES],
  "task.created": () => [TASKS, INITIATIVES, RUN_ENVIRONMENTS, TEST_TARGETS_SET_UPS],
  // A move to Planning in its Initiative's planning Thread changes the planning tab too.
  "task.state-changed": (event) => [
    TASKS,
    INITIATIVES,
    RUN_ENVIRONMENTS,
    TEST_TARGETS_SET_UPS,
    ...taskConversationKeys(event),
  ],
  "task.started": () => [TASKS],
  "task.paused": () => [TASKS],
  "task.stopped": () => [TASKS],
  "task.resumed": () => [TASKS],
  "task.went-on-on-stand-in": () => [TASKS],
  "task.queued": () => [TASKS],
  "task.left-queue": () => [TASKS],
  "task.queue-reasons-changed": () => [TASKS],
  "task.moved-up-in-queue": () => [TASKS],
  "task.archived": () => [TASKS],
  "task.restored": () => [TASKS],
  "task.priority-changed": () => [TASKS],
  "task.title-changed": () => [TASKS],
  "task.kind-changed": () => [TASKS],
  "task.bug-details-changed": () => [TASKS],
  "task.description-changed": () => [TASKS],
  "task.commit-message-changed": () => [TASKS],
  "task.pull-request-end-changed": () => [TASKS],
  "task.tags-changed": () => [TASKS],
  "task.marked-planned": () => [TASKS],
  "task.reordered": () => [TASKS],
  "task.dependency-added": () => [TASKS],
  "task.dependency-removed": () => [TASKS],
  // An Initiative's Tasks and Projects are its Tasks'.
  // An Initiative's engine override applies to its Tasks, so what their Roles run on changes too.
  "task.added-to-initiative": () => [TASKS, INITIATIVES, ENGINE_CASCADE],
  "task.taken-out-of-initiative": () => [TASKS, INITIATIVES, ENGINE_CASCADE],
  // An Initiative's Projects are its Tasks', and a Project's levels apply to them.
  "task.moved-to-project": () => [TASKS, INITIATIVES, ENGINE_CASCADE],
  "task.plan-proposed": () => [TASKS],
  "task.plan-saved": () => [TASKS],
  "task.engine-override-set": (event) => [
    TASKS,
    "taskId" in event && typeof event.taskId === "string"
      ? taskEngineCascadeKey(event.taskId)
      : ENGINE_CASCADE,
  ],
  "task.plan-confirmed": () => [TASKS],
  "task.definition-of-done-proposed": () => [TASKS],
  "task.definition-of-done-saved": () => [TASKS],
  "task.definition-of-done-confirmed": () => [TASKS],
  "task.pipeline-proposed": () => [TASKS],
  // Its Pipeline names the Roles that run on it.
  "task.pipeline-confirmed": () => [TASKS, ENGINE_CASCADE],
  "attachment.added": () => [ATTACHMENTS, SEARCH],
  "attachment.moved": () => [ATTACHMENTS, SEARCH],
  "attachment.removed": () => [ATTACHMENTS, SEARCH],
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

/** The Work events that change more than queries, which `workEventCacheUpdates` applies. */
type ReplacingEventType = "attachment.replaced";

/**
 * A replaced Attachment keeps its id and address, so the page moves to its new copy
 * (`AttachmentCopies`) besides reading the Attachments, their text and the search again.
 */
export const workEventCacheUpdates: Readonly<
  Record<ReplacingEventType, EventCacheUpdates[string]>
> = {
  "attachment.replaced": (event, queryClient) => {
    const replaced = workWebEventSchema.parse(event);
    if (replaced.type !== "attachment.replaced") return;
    attachmentCopiesOf(queryClient).replaced(replaced.attachmentId);
    void queryClient.invalidateQueries({ queryKey: ATTACHMENTS });
    void queryClient.invalidateQueries({ queryKey: SEARCH });
  },
};

function ownerId(owner: AttachmentOwner): string {
  switch (owner.kind) {
    case "idea":
      return owner.ideaId;
    case "initiative":
      return owner.initiativeId;
    case "task":
      return owner.taskId;
    case "thread":
      return owner.threadId;
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
    case "thread":
      return `/threads/${encodeURIComponent(owner.threadId)}`;
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
