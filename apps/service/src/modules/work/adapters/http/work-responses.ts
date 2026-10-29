import type {
  Attachment as AttachmentResponse,
  AttachmentOwner as AttachmentOwnerResponse,
  Author as AuthorResponse,
  Idea as IdeaResponse,
  Initiative as InitiativeResponse,
  QueuedTask as QueuedTaskResponse,
  SavedView as SavedViewResponse,
  SearchResults as SearchResultsResponse,
  Task as TaskResponse,
} from "@the-office/contracts";
import type { SearchResults } from "../../application/search-service.js";
import type { Attachment, AttachmentOwner } from "../../domain/attachment.js";
import type { Author } from "../../domain/author.js";
import type { Idea } from "../../domain/idea.js";
import type { Initiative } from "../../domain/initiative.js";
import { initiativeProjectIds } from "../../domain/initiative-changes.js";
import type { QueuedTask } from "../../domain/queue.js";
import type { SavedView } from "../../domain/saved-view.js";
import type { Task } from "../../domain/task.js";

export function toIdeaResponse(idea: Idea): IdeaResponse {
  return {
    id: idea.id,
    title: idea.title,
    notes: idea.notes,
    projectId: idea.projectId ?? null,
    state: idea.state,
    taskId: idea.taskId ?? null,
    initiativeId: idea.initiativeId ?? null,
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
    originIdeaId: initiative.originIdeaId,
    projectIds: initiativeProjectIds(tasks),
    createdBy: toAuthorResponse(initiative.createdBy),
    createdAt: initiative.createdAt.toISOString(),
  };
}

export function toTaskResponse(task: Task): TaskResponse {
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    state: task.state,
    priority: task.priority,
    tags: [...task.tags],
    plan: task.plan,
    planConfirmed: task.planConfirmed,
    definitionOfDone: [...task.definitionOfDone],
    definitionOfDoneConfirmed: task.definitionOfDoneConfirmed,
    pipelineId: task.pipelineId,
    proposedPipeline: task.proposedPipeline ? { ...task.proposedPipeline } : null,
    blockedBy: [...task.blockedBy],
    originIdeaId: task.originIdeaId ?? null,
    initiativeId: task.initiativeId ?? null,
    createdBy: toAuthorResponse(task.createdBy),
    createdAt: task.createdAt.toISOString(),
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
    : { kind: attachment.kind, ...fields, mediaType: attachment.mediaType, size: attachment.size };
}

export function toSearchResultsResponse(results: SearchResults): SearchResultsResponse {
  return {
    tasks: results.tasks.map(({ record, projectIds }) => ({
      id: record.id,
      title: record.title,
      state: record.state,
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
  return author.kind === "user" ? { kind: "user" } : { kind: "person", roleKey: author.roleKey };
}

export function toSavedViewResponse(savedView: SavedView): SavedViewResponse {
  const { tags, ...filters } = savedView.filters;
  return {
    id: savedView.id,
    name: savedView.name,
    filters: { ...filters, ...(tags && { tags: [...tags] }) },
    savedAt: savedView.savedAt.toISOString(),
  };
}

/** The queue, given first place first, each Task with its place counted from 1. */
export function toQueueResponse(queue: readonly QueuedTask[]): QueuedTaskResponse[] {
  return queue.map(({ taskId, queuedAt, reasons }, index) => ({
    taskId,
    place: index + 1,
    queuedAt: queuedAt.toISOString(),
    reasons: [...reasons],
  }));
}
