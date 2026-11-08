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
import { AlarmSounded, AllClearGiven } from "../../domain/fire-alarm-events.js";
import { OfficeWideLimitChanged, UsageSettingsChanged } from "../../domain/office-limit-events.js";
import {
  TaskLeftQueue,
  TaskMovedUpInQueue,
  TaskQueued,
  TaskQueueReasonsChanged,
} from "../../domain/queue-events.js";
import { SavedViewRemoved, SavedViewSaved } from "../../domain/saved-view-events.js";
import {
  TaskCreated,
  TaskDefinitionOfDoneConfirmed,
  TaskDependencyAdded,
  TaskDependencyRemoved,
  TaskDefinitionOfDoneProposed,
  TaskDefinitionOfDoneSaved,
  TaskHeldAtAllClear,
  TaskPaused,
  TaskPipelineConfirmed,
  TaskPipelineProposed,
  TaskPlanConfirmed,
  TaskPlanProposed,
  TaskPlanSaved,
  TaskArchived,
  TaskPriorityChanged,
  TaskRestored,
  TaskDescriptionChanged,
  TaskTitleChanged,
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
    this.forwardQueueEvents();
    this.forwardPlanningEvents();
    this.forwardAttachmentEvents();
    this.forwardSavedViewEvents();
    this.forwarding.forward(
      OfficeWideLimitChanged,
      (): WebEventOf<"office-wide-limit.changed"> => ({ type: "office-wide-limit.changed" }),
    );
    this.forwarding.forward(UsageSettingsChanged, (): WebEventOf<"usage-settings.changed"> => ({
      type: "usage-settings.changed",
    }));
    this.forwarding.forward(AlarmSounded, (): WebEventOf<"fire-alarm.sounded"> => ({
      type: "fire-alarm.sounded",
    }));
    this.forwarding.forward(AllClearGiven, (): WebEventOf<"fire-alarm.all-clear"> => ({
      type: "fire-alarm.all-clear",
    }));
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
    // Held at the all clear: still Paused, now as the user's own Pause.
    this.forwarding.forward(TaskHeldAtAllClear, (event): WebEventOf<"task.paused"> => ({
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
    this.forwarding.forward(TaskArchived, (event): WebEventOf<"task.archived"> => ({
      type: "task.archived",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskRestored, (event): WebEventOf<"task.restored"> => ({
      type: "task.restored",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskPriorityChanged, (event): WebEventOf<"task.priority-changed"> => ({
      type: "task.priority-changed",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskTitleChanged, (event): WebEventOf<"task.title-changed"> => ({
      type: "task.title-changed",
      taskId: event.taskId,
    }));
    this.forwarding.forward(
      TaskDescriptionChanged,
      (event): WebEventOf<"task.description-changed"> => ({
        type: "task.description-changed",
        taskId: event.taskId,
      }),
    );
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

  private forwardQueueEvents(): void {
    this.forwarding.forward(TaskQueued, (event): WebEventOf<"task.queued"> => ({
      type: "task.queued",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskLeftQueue, (event): WebEventOf<"task.left-queue"> => ({
      type: "task.left-queue",
      taskId: event.taskId,
      why: event.why,
      refusals: [...event.refusals],
    }));
    this.forwarding.forward(
      TaskQueueReasonsChanged,
      (event): WebEventOf<"task.queue-reasons-changed"> => ({
        type: "task.queue-reasons-changed",
        taskId: event.taskId,
      }),
    );
    this.forwarding.forward(TaskMovedUpInQueue, (event): WebEventOf<"task.moved-up-in-queue"> => ({
      type: "task.moved-up-in-queue",
      taskId: event.taskId,
    }));
  }

  private forwardPlanningEvents(): void {
    this.forwarding.forward(TaskPlanProposed, (event): WebEventOf<"task.plan-proposed"> => ({
      type: "task.plan-proposed",
      taskId: event.taskId,
    }));
    this.forwarding.forward(TaskPlanSaved, (event): WebEventOf<"task.plan-saved"> => ({
      type: "task.plan-saved",
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
      TaskDefinitionOfDoneSaved,
      (event): WebEventOf<"task.definition-of-done-saved"> => ({
        type: "task.definition-of-done-saved",
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

  private forwardSavedViewEvents(): void {
    this.forwarding.forward(SavedViewSaved, (event): WebEventOf<"saved-view.saved"> => ({
      type: "saved-view.saved",
      savedViewId: event.savedView.id,
    }));
    this.forwarding.forward(SavedViewRemoved, (event): WebEventOf<"saved-view.removed"> => ({
      type: "saved-view.removed",
      savedViewId: event.savedViewId,
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
