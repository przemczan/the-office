import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { WorkWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  AttachmentAdded,
  AttachmentMoved,
  AttachmentRemoved,
} from "../../domain/attachment-events.js";
import { IdeaCaptured, IdeaDropped, IdeaRestored, IdeaShaped } from "../../domain/idea-events.js";
import {
  TaskCreated,
  TaskPriorityChanged,
  TaskReordered,
  TaskStateChanged,
} from "../../domain/task-events.js";
import { toOwnerResponse } from "../http/work-responses.js";

type WebEventOf<Type extends WorkWebEvent["type"]> = Omit<
  Extract<WorkWebEvent, { type: Type }>,
  "occurredAt"
>;

/** Every Work event reaches the web, naming what changed, so an open page refetches it. */
@Injectable()
export class WorkWebEvents implements OnModuleInit {
  constructor(private readonly forwarding: WebEventForwarding) {}

  onModuleInit(): void {
    this.forwardIdeaEvents();
    this.forwardTaskEvents();
    this.forwardAttachmentEvents();
  }

  private forwardIdeaEvents(): void {
    this.forwarding.forward(IdeaCaptured, (event): WebEventOf<"idea.captured"> => ({
      type: "idea.captured",
      ideaId: event.idea.id,
    }));
    this.forwarding.forward(IdeaShaped, (event): WebEventOf<"idea.shaped"> => ({
      type: "idea.shaped",
      ideaId: event.ideaId,
      taskId: event.taskId,
    }));
    this.forwarding.forward(IdeaDropped, (event): WebEventOf<"idea.dropped"> => ({
      type: "idea.dropped",
      ideaId: event.ideaId,
    }));
    this.forwarding.forward(IdeaRestored, (event): WebEventOf<"idea.restored"> => ({
      type: "idea.restored",
      ideaId: event.ideaId,
    }));
  }

  private forwardTaskEvents(): void {
    this.forwarding.forward(TaskCreated, (event): WebEventOf<"task.created"> => ({
      type: "task.created",
      taskId: event.task.id,
    }));
    this.forwarding.forward(TaskStateChanged, (event): WebEventOf<"task.state-changed"> => ({
      type: "task.state-changed",
      taskId: event.taskId,
      from: event.from,
      to: event.to,
    }));
    this.forwarding.forward(TaskPriorityChanged, (event): WebEventOf<"task.priority-changed"> => ({
      type: "task.priority-changed",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskReordered, (event): WebEventOf<"task.reordered"> => ({
      type: "task.reordered",
      taskId: event.taskId,
    }));
  }

  private forwardAttachmentEvents(): void {
    this.forwarding.forward(AttachmentAdded, (event): WebEventOf<"attachment.added"> => ({
      type: "attachment.added",
      attachmentId: event.attachment.id,
      owner: toOwnerResponse(event.attachment.owner),
    }));
    this.forwarding.forward(AttachmentMoved, (event): WebEventOf<"attachment.moved"> => ({
      type: "attachment.moved",
      attachmentId: event.attachmentId,
      from: toOwnerResponse(event.from),
      to: toOwnerResponse(event.to),
    }));
    this.forwarding.forward(AttachmentRemoved, (event): WebEventOf<"attachment.removed"> => ({
      type: "attachment.removed",
      attachmentId: event.attachmentId,
      owner: toOwnerResponse(event.owner),
    }));
  }
}
