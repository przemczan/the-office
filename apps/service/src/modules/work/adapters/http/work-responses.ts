import type {
  ArchivedInitiativesPage as ArchivedInitiativesPageResponse,
  Attachment as AttachmentResponse,
  AttachmentOwner as AttachmentOwnerResponse,
  Author as AuthorResponse,
  EngineUsageEstimate as EngineUsageEstimateResponse,
  History as HistoryResponse,
  Idea as IdeaResponse,
  Initiative as InitiativeResponse,
  PullRequestEnd as PullRequestEndResponse,
  QueuedTask as QueuedTaskResponse,
  SavedView as SavedViewResponse,
  SearchResults as SearchResultsResponse,
  Task as TaskResponse,
  TaskSummary as TaskSummaryResponse,
  UsageEstimate as UsageEstimateResponse,
  UsageSettings as UsageSettingsResponse,
} from "@the-office/contracts";
import type { EngineId } from "../../../engine/index.js";
import type { SearchResults } from "../../application/search-service.js";
import type { Attachment, AttachmentOwner } from "../../domain/attachment.js";
import type { Author } from "../../domain/author.js";
import type { Idea } from "../../domain/idea.js";
import {
  initiativeProjectIds,
  latestPlanningThread,
  pipelineIn,
  type Initiative,
} from "../../domain/initiative.js";
import {
  ARCHIVE_PAGE_SIZE,
  type ArchivePage,
  type ArchiveSearch,
} from "../../domain/initiative-archive.js";
import type { QueuedTask } from "../../domain/queue.js";
import type { HistoryEntry } from "../../domain/record-edits.js";
import { stateChangeCauseWords } from "../../domain/state-change.js";
import type { SavedView } from "../../domain/saved-view.js";
import { initiativeBranchOf } from "../../domain/short-name.js";
import type { Task, TaskSummary } from "../../domain/task.js";
import { isArchived } from "../../domain/task-archive.js";
import { commitMessageOf } from "../../domain/task-commit-message.js";
import type { PullRequestEnd } from "../../domain/task-pull-request.js";
import type { EngineUsage, UsageEstimate, UsageMeasure } from "../../domain/usage-estimate.js";
import type { UsageSettings } from "../../domain/usage-settings.js";

export function toIdeaResponse(idea: Idea): IdeaResponse {
  return {
    id: idea.id,
    title: idea.title,
    notes: idea.notes,
    projectId: idea.projectId ?? null,
    state: idea.state,
    taskId: idea.taskId ?? null,
    initiativeId: idea.initiativeId ?? null,
    foundWhileWorkingOn: idea.foundWhileWorkingOn ?? null,
    capturedBy: toAuthorResponse(idea.capturedBy),
    capturedAt: idea.capturedAt.toISOString(),
    droppedAt: idea.droppedAt?.toISOString() ?? null,
  };
}

/** With the Projects of its Tasks, `tasks` being the Initiative's. */
export function toInitiativeResponse(
  initiative: Initiative,
  tasks: readonly Task[],
): InitiativeResponse {
  return {
    id: initiative.id,
    name: initiative.name,
    outcome: initiative.outcome,
    state: initiative.state,
    originIdeaId: initiative.originIdeaId ?? null,
    projectIds: initiativeProjectIds(tasks),
    createdBy: toAuthorResponse(initiative.createdBy),
    createdAt: initiative.createdAt.toISOString(),
    endedAt: initiative.endedAt?.toISOString() ?? null,
    archivedAt: initiative.archivedAt?.toISOString() ?? null,
    pausedAt: initiative.pausedAt?.toISOString() ?? null,
    planningThreadId: latestPlanningThread(initiative)?.threadId ?? null,
    planningAutoMode: latestPlanningThread(initiative)?.autoMode ?? false,
    pipelines: initiativeProjectIds(tasks).map((projectId) => ({
      projectId,
      pipelineId: pipelineIn(initiative, projectId) ?? null,
    })),
    shortName: initiative.shortName ?? null,
    branches: initiativeBranchesOf(initiative),
    engineOverride: initiative.engineOverride,
  };
}

/** Each Project's Initiative's branch, named by the Short name it was made under. */
function initiativeBranchesOf(initiative: Initiative): InitiativeResponse["branches"] {
  const { shortName } = initiative;
  if (shortName === undefined) return [];
  return initiative.branches.map(({ projectId, madeAt }) => ({
    projectId,
    branch: initiativeBranchOf(shortName),
    madeAt: madeAt.toISOString(),
  }));
}

/** A page of the Archive, each Initiative with its final count from its Tasks. */
export function toArchivedInitiativesPageResponse(
  { initiatives, counts }: ArchivePage,
  { state, page }: Pick<ArchiveSearch, "state" | "page">,
): ArchivedInitiativesPageResponse {
  return {
    initiatives: initiatives.map(({ initiative, tasks }) => {
      const counted = tasks.filter((task) => task.state !== "dropped");
      return {
        ...toInitiativeResponse(initiative, tasks),
        tasksDone: counted.filter((task) => task.state === "done").length,
        tasksCounted: counted.length,
      };
    }),
    page,
    pageSize: ARCHIVE_PAGE_SIZE,
    total: state === "all" ? counts.done + counts.dropped : counts[state],
    counts: { ...counts },
  };
}

/**
 * With its Initiative's engine override, which applies while it has none (`TaskResponses` reads
 * it): null for none or no Initiative.
 */
export function toTaskResponse(
  task: Task,
  initiativeEngineOverride: EngineId | null,
): TaskResponse {
  return {
    ...toTaskSummaryResponse(task, initiativeEngineOverride),
    description: task.description,
    plan: task.plan,
    definitionOfDone: [...task.definitionOfDone],
    commitMessage: commitMessageOf(task),
    commitMessageWritten: task.commitMessage !== "",
    proposedPipeline: task.proposedPipeline ? { ...task.proposedPipeline } : null,
  };
}

/** What the board and the lists read of a Task, without its long texts, as `toTaskResponse`. */
export function toTaskSummaryResponse(
  task: TaskSummary,
  initiativeEngineOverride: EngineId | null,
): TaskSummaryResponse {
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    state: task.state,
    pausedBy: task.pausedBy ?? null,
    resumesAt: task.resumesAt?.toISOString() ?? null,
    engineStandIns: task.engineStandIns.map((standIn) => ({ ...standIn })),
    priority: task.priority,
    tags: [...task.tags],
    planConfirmed: task.planConfirmed,
    filesToChange: [...task.filesToChange],
    estimatedTokens: task.estimatedTokens ?? null,
    definitionOfDoneConfirmed: task.definitionOfDoneConfirmed,
    commitMessagePublishedAt: task.commitMessagePublishedAt?.toISOString() ?? null,
    pipelineId: task.pipelineId ?? null,
    autoMode: task.autoMode,
    initiativePlanningThreadId: task.initiativePlanningThreadId ?? null,
    markedPlanned: task.markedPlanned,
    hasPlanningThread: task.hasPlanningThread,
    blockedBy: [...task.blockedBy],
    originIdeaId: task.originIdeaId ?? null,
    initiativeId: task.initiativeId ?? null,
    madeFor: task.madeFor ?? null,
    resolvesTaskId: task.resolvesTaskId ?? null,
    projectMoves: task.projectMoves.map((move) => ({
      from: move.from,
      to: move.to,
      at: move.at.toISOString(),
      by: toAuthorResponse(move.by),
    })),
    createdBy: task.createdByTheOffice ? { kind: "office" } : toAuthorResponse(task.createdBy),
    createdAt: task.createdAt.toISOString(),
    archivedAt: task.archivedAt?.toISOString() ?? null,
    endedAt: task.endedAt?.toISOString() ?? null,
    pullRequestEnd: task.pullRequestEnd ? toPullRequestEndResponse(task.pullRequestEnd) : null,
    kind: task.kind,
    causedBy: task.causedBy ?? null,
    foundInVersion: task.foundInVersion ?? null,
    foundWhileWorkingOn: task.foundWhileWorkingOn ?? null,
    dropReason: task.dropReason ? { ...task.dropReason } : null,
    engineOverride: task.engineOverride,
    initiativeEngineOverride,
    peopleEngineSettings: task.peopleEngineSettings.map(({ roleKey, engineSettings }) => ({
      roleKey,
      engineSettings: { ...engineSettings },
    })),
  };
}

function toPullRequestEndResponse(end: PullRequestEnd): PullRequestEndResponse {
  return {
    outcome: end.outcome,
    number: end.number,
    url: end.url,
    at: end.at.toISOString(),
    method: end.method ?? null,
    by:
      end.by.kind === "code-host"
        ? { kind: "code-host", name: end.by.name }
        : toAuthorResponse(end.by),
  };
}

export function toAttachmentResponse(attachment: Attachment): AttachmentResponse {
  const fields = {
    id: attachment.id,
    owner: toOwnerResponse(attachment.owner),
    name: attachment.name,
    addedBy: toAuthorResponse(attachment.addedBy),
    addedAt: attachment.addedAt.toISOString(),
  };
  return attachment.kind === "link"
    ? { kind: "link", ...fields, url: attachment.url }
    : {
        kind: attachment.kind,
        ...fields,
        mediaType: attachment.mediaType,
        size: attachment.size,
        text: attachment.text,
      };
}

export function toSearchResultsResponse(results: SearchResults): SearchResultsResponse {
  return {
    tasks: results.tasks.map(({ record, projectIds }) => ({
      id: record.id,
      title: record.title,
      state: record.state,
      archived: isArchived(record),
      projectIds: [...projectIds],
    })),
    ideas: results.ideas.map(({ record, projectIds }) => ({
      id: record.id,
      title: record.title,
      state: record.state,
      projectIds: [...projectIds],
    })),
    initiatives: results.initiatives.map(({ record, projectIds }) => ({
      id: record.id,
      name: record.name,
      state: record.state,
      projectIds: [...projectIds],
    })),
    attachments: results.documents.map(({ record, projectIds }) => ({
      id: record.id,
      name: record.name,
      owner: toOwnerResponse(record.owner),
      projectIds: [...projectIds],
    })),
    inOtherProjects: {
      tasks: results.inOtherProjects.tasks,
      ideas: results.inOtherProjects.ideas,
      initiatives: results.inOtherProjects.initiatives,
      attachments: results.inOtherProjects.documents,
    },
  };
}

export function toOwnerResponse(owner: AttachmentOwner): AttachmentOwnerResponse {
  return { ...owner };
}

function toAuthorResponse(author: Author): AuthorResponse {
  if (author.kind === "user") {
    return {
      kind: "user",
      user: author.user && { userId: author.user.userId, name: author.user.name },
      ...(author.proposedBy !== undefined && { proposedBy: author.proposedBy }),
    };
  }
  const { roleKey, askedBy, allowedBy } = author;
  return {
    kind: "person",
    roleKey,
    ...(askedBy && { askedBy: { userId: askedBy.userId, name: askedBy.name } }),
    ...(allowedBy && { allowedBy: { userId: allowedBy.userId, name: allowedBy.name } }),
  };
}

export function toSavedViewResponse(savedView: SavedView): SavedViewResponse {
  return {
    id: savedView.id,
    name: savedView.name,
    filters: savedView.filters,
    savedAt: savedView.savedAt.toISOString(),
  };
}

/** The queue, given first place first, each Task with its place counted from 1. */
export function toQueueResponse(queue: readonly QueuedTask[]): QueuedTaskResponse[] {
  return queue.map(({ taskId, queuedAt, reasons, shortReasons, behind }, index) => ({
    taskId,
    place: index + 1,
    queuedAt: queuedAt.toISOString(),
    reasons: [...reasons],
    shortReasons: [...shortReasons],
    behind: [...behind],
  }));
}

/** The estimate in its ticked measures alone; a ticked one with no estimate is null. */
export function toUsageEstimateResponse({
  basis,
  engines,
  measures,
}: UsageEstimate): UsageEstimateResponse {
  return { basis: { ...basis }, engines: engines.map((each) => engineUsageOf(each, measures)) };
}

function engineUsageOf(
  { engineId, tokens, windows, cost }: EngineUsage,
  measures: readonly UsageMeasure[],
): EngineUsageEstimateResponse {
  const ticked = new Set(measures);
  return {
    engineId,
    ...(ticked.has("tokens") && { tokens }),
    ...(windows && ticked.has("fiveHourWindow") && { fiveHourWindow: windows.fiveHour ?? null }),
    ...(windows && ticked.has("sevenDayWindow") && { sevenDayWindow: windows.sevenDay ?? null }),
    ...(ticked.has("cost") && { cost: cost ?? null }),
  };
}

/** The measures and every engine id's caps; a cap that is off is null. */
export function toUsageSettingsResponse({ measures, caps }: UsageSettings): UsageSettingsResponse {
  return {
    measures: [...measures],
    caps: caps.map(({ engineId, windows, dailyTokens, dailyDollars }) => ({
      engineId,
      ...(windows && {
        windows: { fiveHour: windows.fiveHour ?? null, sevenDay: windows.sevenDay ?? null },
      }),
      dailyTokens: dailyTokens ?? null,
      dailyDollars: dailyDollars ?? null,
    })),
  };
}

/** A record's History, oldest first, each entry's maker as the record words them after "by". */
export function toHistoryResponse(entries: readonly HistoryEntry[]): HistoryResponse {
  return entries.map((entry) =>
    entry.kind === "edit"
      ? {
          kind: "edit",
          at: entry.at.toISOString(),
          field: entry.field,
          by: stateChangeCauseWords(entry.by),
        }
      : {
          kind: "state-change",
          at: entry.at.toISOString(),
          from: entry.from ?? null,
          to: entry.to,
          by: stateChangeCauseWords(entry.by),
        },
  );
}
