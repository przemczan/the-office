import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoleCardChanged } from "../../people/index.js";
import { OfficeWideLimitChanged } from "../domain/office-limit-events.js";
import { moveUpInQueue, queueOrder, releaseQueue, type QueuedTask } from "../domain/queue.js";
import { TaskLeftQueue, TaskMovedUpInQueue } from "../domain/queue-events.js";
import type { StartConditions } from "../domain/task-start.js";
import { TaskStateChanged } from "../domain/task-events.js";
import { TaskRefused } from "../domain/task-refused.js";
import { STARTED_STATES } from "../domain/task-states.js";
import { QueueRepository } from "../ports/queue-repository.js";
import { TaskRepository } from "../ports/task-repository.js";
import { StartConditionsReader } from "./start-conditions.js";

/**
 * The one Office-wide queue for Start (spec §2.1, "A queue for Start"): its Tasks start by
 * themselves, first place first among those that can, whenever a desk or a person may have freed
 * up; the user takes one out or moves it up. The queue is kept, so it releases on after a restart.
 */
@Injectable()
export class QueueService implements OnModuleInit {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private readonly queue: QueueRepository,
    private readonly tasks: TaskRepository,
    private readonly conditions: StartConditionsReader,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStateChanged, async ({ taskId, from, to }) => {
      if (from === "ready") await this.leaveReady(taskId);
      if (STARTED_STATES.includes(from) && (to === "done" || to === "dropped")) {
        await this.release();
      }
    });
    this.events.subscribe(OfficeWideLimitChanged, () => this.release());
    // A person's Task limit may have been raised.
    this.events.subscribe(RoleCardChanged, () => this.release());
  }

  /** The queue, first place first. */
  async list(): Promise<QueuedTask[]> {
    return queueOrder(await this.queue.list());
  }

  /**
   * The one release: starts every queued Task that can start now, first place first, and takes out
   * those whose turn met a reason that refuses Start. Task 27's fire alarm holds the queue here.
   */
  async release(): Promise<void> {
    const conditions = await this.conditionsOfQueued();
    const { started, refused } = await this.queue.release((queue, tasks) =>
      releaseQueue(queue, tasks, (taskId) => conditions.get(taskId)),
    );
    for (const { task, event } of started) {
      await this.events.publish(new TaskLeftQueue(task.id, "started"));
      await this.events.publish(event);
    }
    for (const { taskId, refusals } of refused) {
      this.logger.log(`Task ${taskId} left the queue: ${refusals.join(" ")}`);
      await this.events.publish(new TaskLeftQueue(taskId, "refused", refusals));
    }
  }

  /** Take out of the queue: the Task stays Ready. Refuses one that isn't queued. */
  async takeOut(taskId: string): Promise<void> {
    if (!(await this.queue.takeOut(taskId)))
      throw new TaskRefused(["The Task isn't in the queue."]);
    await this.events.publish(new TaskLeftQueue(taskId, "taken-out"));
  }

  /** Move up: one place, past the Task ahead of it. */
  async moveUp(taskId: string): Promise<void> {
    await this.queue.reorder((queue) => moveUpInQueue(queue, taskId));
    await this.events.publish(new TaskMovedUpInQueue(taskId));
  }

  private async leaveReady(taskId: string): Promise<void> {
    if (await this.queue.takeOut(taskId)) {
      await this.events.publish(new TaskLeftQueue(taskId, "left-ready"));
    }
  }

  /** Read before the hold, as Start reads them: they live in other modules. */
  private async conditionsOfQueued(): Promise<Map<string, StartConditions>> {
    const conditions = new Map<string, StartConditions>();
    for (const { taskId } of await this.queue.list()) {
      const task = await this.tasks.find(taskId);
      if (task) conditions.set(taskId, await this.conditions.of(task));
    }
    return conditions;
  }
}
