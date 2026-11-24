import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { IssueWriteBack, type IssueDropReason } from "../../../projects/index.js";
import type { DropReason } from "../../domain/drop-reason.js";
import { TaskReopened, TaskStarted, TaskStateChanged } from "../../domain/task-events.js";
import { TaskRepository } from "../../ports/task-repository.js";

/**
 * Tells Projects that a Task started, was Done or was Dropped, with its drop reason (a Duplicate's
 * with the other Task's title), or was reopened, so Projects writes back on the issue it was imported from, as the
 * Project's switches say (docs/design/issues-as-tasks.html). Work knows nothing of issues:
 * Projects passes over a Task with no issue link.
 */
@Injectable()
export class IssueWriteBackForwarding implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly tasks: TaskRepository,
    private readonly writeBack: IssueWriteBack,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStarted, async ({ taskId }) => {
      const task = await this.tasks.find(taskId);
      if (task) await this.writeBack.taskStarted(taskId, task.title);
    });
    this.events.subscribe(TaskStateChanged, async ({ taskId, to }) => {
      if (to === "done") await this.writeBack.taskDone(taskId);
      if (to === "dropped") {
        const task = await this.tasks.find(taskId);
        await this.writeBack.taskDropped(taskId, await this.issueDropReason(task?.dropReason));
      }
    });
    this.events.subscribe(TaskReopened, ({ taskId }) => this.writeBack.taskReopened(taskId));
  }

  private async issueDropReason(
    reason: DropReason | null | undefined,
  ): Promise<IssueDropReason | null> {
    if (!reason) return null;
    if (reason.kind !== "duplicate") return reason;
    const other = await this.tasks.find(reason.taskId);
    return { kind: "duplicate", taskId: reason.taskId, title: other?.title ?? reason.taskId };
  }
}
