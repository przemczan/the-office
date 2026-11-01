import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { UsageWindowsRead } from "../../engine/index.js";
import { RoleCardChanged } from "../../people/index.js";
import { AllClearGiven } from "../domain/fire-alarm-events.js";
import { OfficeWideLimitChanged, UsageSettingsChanged } from "../domain/office-limit-events.js";
import { nextCapRelease } from "../domain/cap-waits.js";
import { moveUpInQueue, queueOrder, releaseQueue, type QueuedTask } from "../domain/queue.js";
import { TaskLeftQueue, TaskMovedUpInQueue, TaskQueued } from "../domain/queue-events.js";
import type { StartConditions } from "../domain/task-start.js";
import { TaskStateChanged } from "../domain/task-events.js";
import { TaskRefused } from "../domain/task-refused.js";
import { STARTED_STATES } from "../domain/task-states.js";
import { QueueRepository } from "../ports/queue-repository.js";
import { TaskRepository } from "../ports/task-repository.js";
import { StartConditionsReader } from "./start-conditions.js";
import { StartsSinceReading } from "./starts-since-reading.js";

/** The longest delay `setTimeout` keeps, about 24.8 days. */
const LONGEST_TIMER = 2 ** 31 - 1;

/**
 * The one Office-wide queue for Start (spec §2.1, "A queue for Start"): its Tasks start by
 * themselves, first place first among those that can, whenever a desk or a person may have freed
 * up or a cap may allow it; the user takes one out or moves it up. The queue is kept, so it
 * releases on after a restart.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  /** The next release for the caps holding a waiting Task. */
  private capTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly queue: QueueRepository,
    private readonly tasks: TaskRepository,
    private readonly conditions: StartConditionsReader,
    private readonly startsSinceReading: StartsSinceReading,
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
    // A cap may have been raised, or its measure unticked.
    this.events.subscribe(UsageSettingsChanged, () => this.release());
    // A person's Task limit may have been raised.
    this.events.subscribe(RoleCardChanged, () => this.release());
    // What Start queued while the fire alarm was on waits no longer.
    this.events.subscribe(AllClearGiven, () => this.release());
    // The reading shows what the Tasks started before it use, so their estimates count no more.
    this.events.subscribe(UsageWindowsRead, ({ readAt }) => {
      this.startsSinceReading.forgetUntil(readAt);
      return this.release();
    });
    // A Task a cap holds sets the timer for when the cap resets.
    this.events.subscribe(TaskQueued, () => this.release());
  }

  onModuleDestroy(): void {
    clearTimeout(this.capTimer);
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
    const { started, refused, capResets } = await this.queue.release((queue, held) =>
      releaseQueue(queue, held, (taskId) => conditions.get(taskId)),
    );
    const startedAt = new Date();
    for (const { task } of started) {
      const estimate = conditions.get(task.id)?.usage.estimate;
      if (estimate) this.startsSinceReading.record(startedAt, estimate);
    }
    this.setCapTimer(capResets);
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

  /**
   * An hour before, and at, the next reset that frees a Task a cap holds. A timer longer than Node
   * keeps releases at its longest and is set again then.
   */
  private setCapTimer(capResets: readonly Date[]): void {
    clearTimeout(this.capTimer);
    const releaseAt = nextCapRelease(capResets, new Date());
    if (!releaseAt) return;
    const delay = Math.min(releaseAt.getTime() - Date.now(), LONGEST_TIMER);
    this.capTimer = setTimeout(() => {
      this.release().catch((error: unknown) => {
        this.logger.error(`The release for a cap's reset failed: ${String(error)}`);
      });
    }, delay);
    this.capTimer.unref();
  }

  /** Read before the hold, as Start reads them: they live in other modules. */
  private async conditionsOfQueued(): Promise<Map<string, StartConditions>> {
    const queued = await Promise.all(
      (await this.queue.list()).map(({ taskId }) => this.tasks.find(taskId)),
    );
    return this.conditions.ofEach(queued.filter((task) => task !== undefined));
  }
}
