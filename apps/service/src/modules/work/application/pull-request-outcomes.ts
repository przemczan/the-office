import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  PullRequestClosed,
  PullRequestMerged,
  PullRequestReopened,
  type PullRequestEndedBy as EndedOnProjects,
} from "../../projects/index.js";
import { byTheUser } from "../domain/author.js";
import type { Task } from "../domain/task.js";
import type { TaskChange } from "../domain/task-changes.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import {
  clearPullRequestEnd,
  recordPullRequestEnd,
  type PullRequestEndedBy,
} from "../domain/task-pull-request.js";
import { TaskRepository } from "../ports/task-repository.js";

/**
 * The Task records how its pull request ended (spec §2.3): Projects' merge or close, from Work ›
 * Pull requests or seen on the code host, marks the Task beside its state, and a pull request open
 * again clears the mark. A Task The Office doesn't know is left alone.
 */
@Injectable()
export class PullRequestOutcomes implements OnModuleInit {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(PullRequestMerged, ({ taskId, number, url, method, by, occurredAt }) =>
      this.change(taskId, (task) =>
        recordPullRequestEnd(task, {
          outcome: "merged",
          number,
          url,
          at: occurredAt,
          method,
          by: endedBy(by),
        }),
      ),
    );
    this.events.subscribe(PullRequestClosed, ({ taskId, number, url, by, occurredAt }) =>
      this.change(taskId, (task) =>
        recordPullRequestEnd(task, {
          outcome: "closed",
          number,
          url,
          at: occurredAt,
          method: undefined,
          by: endedBy(by),
        }),
      ),
    );
    this.events.subscribe(PullRequestReopened, ({ taskId, number, occurredAt }) =>
      this.change(taskId, (task) => clearPullRequestEnd(task, number, occurredAt)),
    );
  }

  private async change<Event extends DomainEvent>(
    taskId: string,
    change: (task: Task) => TaskChange<Event> | undefined,
  ): Promise<void> {
    try {
      const { event } = await this.tasks.update(taskId, change);
      if (event) await this.events.publish(event);
    } catch (error) {
      if (error instanceof TaskNotFound) return;
      throw error;
    }
  }
}

function endedBy(by: EndedOnProjects): PullRequestEndedBy {
  return by.kind === "code-host"
    ? { kind: "code-host", name: by.name }
    : byTheUser({ userId: by.userId, name: by.name });
}
