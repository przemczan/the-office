import type {
  Attachment as AttachmentResponse,
  AttachmentOwner as AttachmentOwnerResponse,
  Author as AuthorResponse,
  Idea as IdeaResponse,
  Task as TaskResponse,
} from "@the-office/contracts";
import type { Attachment, AttachmentOwner } from "../../domain/attachment.js";
import type { Author } from "../../domain/author.js";
import type { Idea } from "../../domain/idea.js";
import type { Task } from "../../domain/task.js";

export function toIdeaResponse(idea: Idea): IdeaResponse {
  return {
    id: idea.id,
    title: idea.title,
    notes: idea.notes,
    projectId: idea.projectId ?? null,
    state: idea.state,
    taskId: idea.taskId ?? null,
    capturedBy: toAuthorResponse(idea.capturedBy),
    capturedAt: idea.capturedAt.toISOString(),
    droppedAt: idea.droppedAt?.toISOString() ?? null,
  };
}

export function toTaskResponse(task: Task): TaskResponse {
  return {
    id: task.id,
    title: task.title,
    projectId: task.projectId,
    state: task.state,
    priority: task.priority,
    plan: task.plan,
    planConfirmed: task.planConfirmed,
    definitionOfDone: [...task.definitionOfDone],
    definitionOfDoneConfirmed: task.definitionOfDoneConfirmed,
    pipelineId: task.pipelineId,
    proposedPipeline: task.proposedPipeline ? { ...task.proposedPipeline } : null,
    blockedBy: [...task.blockedBy],
    originIdeaId: task.originIdeaId ?? null,
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

export function toOwnerResponse(owner: AttachmentOwner): AttachmentOwnerResponse {
  return owner.kind === "idea"
    ? { kind: "idea", ideaId: owner.ideaId }
    : { kind: "task", taskId: owner.taskId };
}

function toAuthorResponse(author: Author): AuthorResponse {
  return author.kind === "user" ? { kind: "user" } : { kind: "person", roleKey: author.roleKey };
}
