import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { WorkWebEvent } from "@the-office/contracts";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import {
  AttachmentAdded,
  AttachmentMoved,
  AttachmentRemoved,
} from "../../domain/attachment-events.js";
import {
  IdeaCaptured,
  IdeaDropped,
  IdeaRestored,
  IdeaShaped,
  IdeaShapedIntoInitiative,
} from "../../domain/idea-events.js";
import {
  InitiativeCreated,
  InitiativeOutcomeWritten,
  InitiativeStateChanged,
} from "../../domain/initiative-events.js";
import { OfficeWideLimitChanged } from "../../domain/office-limit-events.js";
import {
  TaskCreated,
  TaskDefinitionOfDoneConfirmed,
  TaskDependencyAdded,
  TaskDependencyRemoved,
  TaskDefinitionOfDoneProposed,
  TaskPaused,
  TaskPipelineConfirmed,
  TaskPipelineProposed,
  TaskPlanConfirmed,
  TaskPlanProposed,
  TaskPriorityChanged,
  TaskTagsChanged,
  TaskReordered,
  TaskResumed,
  TaskStarted,
  TaskStateChanged,
  TaskStopped,
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
    this.forwardInitiativeEvents();
    this.forwardTaskEvents();
    this.forwardPlanningEvents();
    this.forwardAttachmentEvents();
    this.forwarding.forward(
      OfficeWideLimitChanged,
      (): WebEventOf<"office-wide-limit.changed"> => ({ type: "office-wide-limit.changed" }),
    );
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
    this.forwarding.forward(
      IdeaShapedIntoInitiative,
      (event): WebEventOf<"idea.shaped-into-initiative"> => ({
        type: "idea.shaped-into-initiative",
        ideaId: event.ideaId,
        initiativeId: event.initiativeId,
      }),
    );
    this.forwarding.forward(IdeaDropped, (event): WebEventOf<"idea.dropped"> => ({
      type: "idea.dropped",
      ideaId: event.ideaId,
    }));
    this.forwarding.forward(IdeaRestored, (event): WebEventOf<"idea.restored"> => ({
      type: "idea.restored",
      ideaId: event.ideaId,
    }));
  }

  private forwardInitiativeEvents(): void {
    this.forwarding.forward(InitiativeCreated, (event): WebEventOf<"initiative.created"> => ({
      type: "initiative.created",
      initiativeId: event.initiative.id,
    }));
    this.forwarding.forward(
      InitiativeStateChanged,
      (event): WebEventOf<"initiative.state-changed"> => ({
        type: "initiative.state-changed",
        initiativeId: event.initiativeId,
        from: event.from,
        to: event.to,
      }),
    );
    this.forwarding.forward(
      InitiativeOutcomeWritten,
      (event): WebEventOf<"initiative.outcome-written"> => ({
        type: "initiative.outcome-written",
        initiativeId: event.initiativeId,
      }),
    );
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
    this.forwarding.forward(TaskStarted, (event): WebEventOf<"task.started"> => ({
      type: "task.started",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskPaused, (event): WebEventOf<"task.paused"> => ({
      type: "task.paused",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskStopped, (event): WebEventOf<"task.stopped"> => ({
      type: "task.stopped",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskResumed, (event): WebEventOf<"task.resumed"> => ({
      type: "task.resumed",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskPriorityChanged, (event): WebEventOf<"task.priority-changed"> => ({
      type: "task.priority-changed",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskTagsChanged, (event): WebEventOf<"task.tags-changed"> => ({
      type: "task.tags-changed",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskReordered, (event): WebEventOf<"task.reordered"> => ({
      type: "task.reordered",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskDependencyAdded, (event): WebEventOf<"task.dependency-added"> => ({
      type: "task.dependency-added",
      taskId: event.taskId,
      blockerId: event.blockerId,
    }));
    this.forwarding.forward(
      TaskDependencyRemoved,
      (event): WebEventOf<"task.dependency-removed"> => ({
        type: "task.dependency-removed",
        taskId: event.taskId,
        blockerId: event.blockerId,
      }),
    );
  }

  private forwardPlanningEvents(): void {
    this.forwarding.forward(TaskPlanProposed, (event): WebEventOf<"task.plan-proposed"> => ({
      type: "task.plan-proposed",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskPlanConfirmed, (event): WebEventOf<"task.plan-confirmed"> => ({
      type: "task.plan-confirmed",
      taskId: event.taskId,
    }));
    this.forwarding.forward(
      TaskDefinitionOfDoneProposed,
      (event): WebEventOf<"task.definition-of-done-proposed"> => ({
        type: "task.definition-of-done-proposed",
        taskId: event.taskId,
      }),
    );
    this.forwarding.forward(
      TaskDefinitionOfDoneConfirmed,
      (event): WebEventOf<"task.definition-of-done-confirmed"> => ({
        type: "task.definition-of-done-confirmed",
        taskId: event.taskId,
      }),
    );
    this.forwarding.forward(
      TaskPipelineProposed,
      (event): WebEventOf<"task.pipeline-proposed"> => ({
        type: "task.pipeline-proposed",
        taskId: event.taskId,
        pipelineId: event.pipelineId,
      }),
    );
    this.forwarding.forward(
      TaskPipelineConfirmed,
      (event): WebEventOf<"task.pipeline-confirmed"> => ({
        type: "task.pipeline-confirmed",
        taskId: event.taskId,
        pipelineId: event.pipelineId,
      }),
    );
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
