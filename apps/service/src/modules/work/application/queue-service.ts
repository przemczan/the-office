import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { OfficeUpdateCancelled } from "../../office-updates/index.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule, type Wait } from "../../../platform/schedule/schedule.js";
import { UsageWindowReset, UsageWindowsRead, UsageWindowUsedUp } from "../../engine/index.js";
import { RoleCardChanged } from "../../people/index.js";
import { ProjectLimitChanged } from "../../projects/index.js";
import { AllClearGiven } from "../domain/fire-alarm-events.js";
import { InitiativeResumed } from "../domain/initiative-events.js";
import { OfficeWideLimitChanged, UsageSettingsChanged } from "../domain/office-limit-events.js";
import { nextCapRelease } from "../domain/cap-waits.js";
import {
  moveToTopOfQueue,
  moveUpInQueue,
  queueOrder,
  releaseQueue,
  type QueuedTask,
} from "../domain/queue.js";
import {
  TaskLeftQueue,
  TaskMovedUpInQueue,
  TaskQueued,
  TaskQueueReasonsChanged,
} from "../domain/queue-events.js";
import type { StartConditions } from "../domain/task-start.js";
import {
  TaskDependencyAdded,
  TaskDependencyRemoved,
  TaskStateChanged,
} from "../domain/task-events.js";
import { TaskRefused } from "../domain/task-refused.js";
import { QueueRepository } from "../ports/queue-repository.js";
import { TaskRepository } from "../ports/task-repository.js";
import { StartConditionsReader } from "./start-conditions.js";
import { StartsSinceReading } from "./starts-since-reading.js";

/**
 * The one Office-wide queue for Start (spec §2.1, "A queue for Start"): its Tasks start by
 * themselves, first place first among those that can, whenever a blocker may have ended, a desk, a
 * Project or a person may have freed up or a cap may allow it; the user takes one out or moves it
 * up. The queue is kept, so it releases on after a restart.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  /** The next release for the caps holding a waiting Task. */
  private capRelease: Wait | undefined;

  constructor(
    private readonly queue: QueueRepository,
    private readonly tasks: TaskRepository,
    private readonly conditions: StartConditionsReader,
    private readonly startsSinceReading: StartsSinceReading,
    private readonly events: EventBus,
    private readonly schedule: Schedule,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStateChanged, async ({ taskId, from, to }) => {
      if (from === "ready") await this.leaveReady(taskId);
      // From any state: a blocker may end before it ever started.
      if (to === "done" || to === "dropped") await this.release();
    });
    // A queued Task may be free of its last blocker.
    this.events.subscribe(TaskDependencyRemoved, () => this.release());
    // Or held by one more, which its reasons name.
    this.events.subscribe(TaskDependencyAdded, () => this.release());
    this.events.subscribe(OfficeWideLimitChanged, () => this.release());
    // A Project's limit may have been raised.
    this.events.subscribe(ProjectLimitChanged, () => this.release());
    // A cap may have been raised, or its measure unticked.
    this.events.subscribe(UsageSettingsChanged, () => this.release());
    // A person's Task limit may have been raised.
    this.events.subscribe(RoleCardChanged, () => this.release());
    // What Start queued while the fire alarm was on waits no longer.
    this.events.subscribe(AllClearGiven, () => this.release());
    // Nor what it queued while the Task's Initiative was paused.
    this.events.subscribe(InitiativeResumed, () => this.release());
    // Nor what it queued while an Office update was scheduled.
    this.events.subscribe(OfficeUpdateCancelled, () => this.release());
    // The reading shows what the Tasks started before it use of its engine, so their estimates
    // there count no more.
    this.events.subscribe(UsageWindowsRead, ({ engineId, readAt }) => {
      this.startsSinceReading.forgetUntil(engineId, readAt);
      return this.release();
    });
    // A used-up usage window holds the queued Tasks on its engine, which their reasons name, until
    // its reset; the release for that reset is set with the caps' (setCapRelease).
    this.events.subscribe(UsageWindowUsedUp, () => this.release());
    this.events.subscribe(UsageWindowReset, () => this.release());
    // A Task a cap holds sets the release for when the cap resets.
    this.events.subscribe(TaskQueued, () => this.release());
  }

  onModuleDestroy(): void {
    this.capRelease?.cancel();
  }

  /** The queue, first place first. */
  async list(): Promise<QueuedTask[]> {
    return queueOrder(await this.queue.list());
  }

  /**
   * The one release: starts every queued Task that can start now, first place first, and takes out
   * those whose turn met a reason that refuses Start. While the fire alarm is on, each waits.
   */
  async release(): Promise<void> {
    const conditions = await this.conditionsOfQueued();
    const { started, refused, reasonsChanged, capResets } = await this.queue.release(
      (queue, held) => releaseQueue(queue, held, (taskId) => conditions.get(taskId)),
    );
    const startedAt = this.schedule.now();
    for (const { task } of started) {
      const estimate = conditions.get(task.id)?.usage.estimate;
      if (estimate) this.startsSinceReading.record(startedAt, estimate);
    }
    this.setCapRelease(capResets, this.weighedAt(conditions));
    for (const { task, event } of started) {
      await this.events.publish(new TaskLeftQueue(task.id, "started"));
      await this.events.publish(event);
    }
    for (const { taskId, refusals } of refused) {
      this.logger.log(`Task ${taskId} left the queue: ${refusals.join(" ")}`);
      await this.events.publish(new TaskLeftQueue(taskId, "refused", refusals));
    }
    for (const taskId of reasonsChanged) {
      await this.events.publish(new TaskQueueReasonsChanged(taskId));
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

  /** Move to top: to the first place, ahead of every other queued Task. */
  async moveToTop(taskId: string): Promise<void> {
    await this.queue.reorder((queue) => moveToTopOfQueue(queue, taskId));
    await this.events.publish(new TaskMovedUpInQueue(taskId));
  }

  private async leaveReady(taskId: string): Promise<void> {
    if (await this.queue.takeOut(taskId)) {
      await this.events.publish(new TaskLeftQueue(taskId, "left-ready"));
    }
  }

  /**
   * An hour before, and at, the next reset that frees a Task a cap or a used-up usage window holds. The next release counts
   * from when the caps were weighed: a moment that passed since then releases at once, rather than
   * holding the Task until the next one.
   */
  private setCapRelease(capResets: readonly Date[], weighed: Date): void {
    this.capRelease?.cancel();
    const releaseAt = nextCapRelease(capResets, weighed);
    this.capRelease =
      releaseAt &&
      this.schedule.once("The release for a cap's reset", releaseAt, () => this.release());
  }

  /** The earliest moment the queued Tasks' caps were weighed at; now when none was. */
  private weighedAt(conditions: ReadonlyMap<string, StartConditions>): Date {
    const moments = [...conditions.values()].map(({ usage }) => usage.now.getTime());
    return moments.length === 0 ? this.schedule.now() : new Date(Math.min(...moments));
  }

  /** Read before the hold, as Start reads them: they live in other modules. */
  private async conditionsOfQueued(): Promise<Map<string, StartConditions>> {
    const queued = await Promise.all(
      (await this.queue.list()).map(({ taskId }) => this.tasks.find(taskId)),
    );
    return this.conditions.ofEach(queued.filter((task) => task !== undefined));
  }
}
