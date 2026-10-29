import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { startOrQueue, type Starting } from "../domain/queue.js";
import type { Task } from "../domain/task.js";
import { startReasons, type StartReasons } from "../domain/task-start.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import { QueueRepository } from "../ports/queue-repository.js";
import { TaskRepository } from "../ports/task-repository.js";
import { StartConditionsReader } from "./start-conditions.js";

/**
 * Start, the user's call on a Ready Task (spec §2.1, §9): refused with the reasons, queued when
 * only a limit stands in the way, or the Task moves to In progress and TaskStarted tells Pipelines
 * to make its own Stages and run them.
 */
@Injectable()
export class StartService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly queue: QueueRepository,
    private readonly conditions: StartConditionsReader,
    private readonly events: EventBus,
  ) {}

  async start(id: string): Promise<Starting> {
    const conditions = await this.conditions.of(await this.read(id));
    const starting = await this.queue.start(id, (task, held, queue) =>
      startOrQueue(task, conditions, held, queue, new Date()),
    );
    const event = starting.kind === "started" ? starting.change.event : starting.event;
    if (event) await this.events.publish(event);
    return starting;
  }

  /** Why the Task can't start now, for the Task page to show beside Start; empty when it can. */
  async startReasons(id: string): Promise<StartReasons> {
    const task = await this.read(id);
    const tasks = await this.tasks.list();
    const blockers = tasks.filter(({ id: other }) => task.blockedBy.includes(other));
    return startReasons(task, await this.conditions.of(task), { startedTasks: tasks, blockers });
  }

  private async read(id: string): Promise<Task> {
    const task = await this.tasks.find(id);
    if (!task) throw new TaskNotFound(id);
    return task;
  }
}
