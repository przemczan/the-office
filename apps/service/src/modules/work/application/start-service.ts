import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { startOrQueue, type OverlapChoice, type Starting } from "../domain/queue.js";
import type { Task } from "../domain/task.js";
import { blockingTasks } from "../domain/task-dependencies.js";
import { overlapsOf, type Overlap } from "../domain/task-overlap.js";
import { startReasons, type StartReasons } from "../domain/task-start.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import type { UsageEstimate } from "../domain/usage-estimate.js";
import { FireAlarmRepository } from "../ports/fire-alarm-repository.js";
import { QueueRepository } from "../ports/queue-repository.js";
import { TaskRepository } from "../ports/task-repository.js";
import { StartConditionsReader } from "./start-conditions.js";
import { StartsSinceReading } from "./starts-since-reading.js";
import { UsageEstimates } from "./usage-estimates.js";

/**
 * Why the Task can't start now, the blockers still holding it back, the started Tasks it overlaps
 * and what it is expected to use, for the Task page's Start.
 */
export interface StartCheck extends StartReasons {
  readonly blockers: readonly Task[];
  readonly overlaps: readonly Overlap[];
  /** Undefined with no measure ticked. */
  readonly usageEstimate: UsageEstimate | undefined;
}

/**
 * Start, the user's call on a Ready Task (spec §2.1, §9): refused with the reasons, queued when
 * only a blocker, the fire alarm, a limit or the user's choice to queue behind an Overlap stands in
 * the way, or the Task moves to In progress and TaskStarted tells Pipelines to make its own Stages
 * and run them.
 */
@Injectable()
export class StartService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly queue: QueueRepository,
    private readonly conditions: StartConditionsReader,
    private readonly fireAlarm: FireAlarmRepository,
    private readonly usageEstimates: UsageEstimates,
    private readonly startsSinceReading: StartsSinceReading,
    private readonly events: EventBus,
    private readonly schedule: Schedule,
  ) {}

  async start(id: string, onOverlap: OverlapChoice): Promise<Starting> {
    const conditions = await this.conditions.of(await this.read(id));
    const starting = await this.queue.start(id, (task, held, queue) =>
      startOrQueue(task, conditions, held, queue, { now: this.schedule.now(), onOverlap }),
    );
    if (starting.kind === "started") {
      this.startsSinceReading.record(this.schedule.now(), conditions.usage.estimate);
    }
    const event = starting.kind === "started" ? starting.change.event : starting.event;
    if (event) await this.events.publish(event);
    return starting;
  }

  /** What Start would meet now, for the Task page to show beside Start; all empty when nothing. */
  async check(id: string): Promise<StartCheck> {
    const task = await this.read(id);
    const tasks = await this.tasks.list();
    const blockers = tasks.filter(({ id: other }) => task.blockedBy.includes(other));
    const reasons = startReasons(task, await this.conditions.of(task), {
      startedTasks: tasks,
      blockers,
      fireAlarmOn: (await this.fireAlarm.read()).on,
    });
    return {
      ...reasons,
      blockers: blockingTasks(blockers),
      overlaps: overlapsOf(task, tasks),
      usageEstimate: await this.usageEstimates.of(task, tasks),
    };
  }

  private async read(id: string): Promise<Task> {
    const task = await this.tasks.find(id);
    if (!task) throw new TaskNotFound(id);
    return task;
  }
}
