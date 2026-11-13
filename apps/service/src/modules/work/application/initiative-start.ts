import type { Author } from "../domain/author.js";
import { Injectable } from "@nestjs/common";
import { readyTasksToStart } from "../domain/initiative-start.js";
import { InitiativeNotFound } from "../domain/initiative-not-found.js";
import { queueOrder } from "../domain/queue.js";
import type { Task } from "../domain/task.js";
import { TaskRefused } from "../domain/task-refused.js";
import { STARTED_STATES } from "../domain/task-states.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { QueueRepository } from "../ports/queue-repository.js";
import { TaskRepository } from "../ports/task-repository.js";
import { StartService } from "./start-service.js";

/** A Task Start Ready Tasks queued: its place in the queue after the run, from 1, and its waits. */
export interface QueuedInRun {
  readonly task: Task;
  readonly place: number;
  readonly reasons: readonly string[];
}

/** A Task Start refused in the run, with every reason. */
export interface RefusedInRun {
  readonly task: Task;
  readonly reasons: readonly string[];
}

/** What Start Ready Tasks did to each of the Initiative's Ready Tasks. */
export interface ReadyTasksStarted {
  readonly started: readonly Task[];
  readonly queued: readonly QueuedInRun[];
  readonly refused: readonly RefusedInRun[];
}

/**
 * Start Ready Tasks (spec §2.1): the normal Start on each of an active Initiative's Ready Tasks, in
 * `readyTasksToStart`'s order, an Overlap answered with "queue behind". Each Start holds Starts on
 * its own, so a Task started earlier in the run holds its desk and is overlapped by the next.
 * Nothing new is kept: each Start publishes its own events.
 */
@Injectable()
export class InitiativeStart {
  constructor(
    private readonly initiatives: InitiativeRepository,
    private readonly tasks: TaskRepository,
    private readonly queue: QueueRepository,
    private readonly starting: StartService,
  ) {}

  /**
   * Starts or queues each Ready Task; one refused is answered with its reasons and the rest go on.
   * Refused with the reason (InitiativeRefused) when the Initiative isn't active or has no Ready Task.
   */
  async startReadyTasks(initiativeId: string, by: Author): Promise<ReadyTasksStarted> {
    const initiative = await this.initiatives.find(initiativeId);
    if (!initiative) throw new InitiativeNotFound(initiativeId);
    const toStart = readyTasksToStart(initiative, await this.tasks.list());
    const refused: RefusedInRun[] = [];
    for (const task of toStart) {
      try {
        await this.starting.start(task.id, "queue-behind", by);
      } catch (error) {
        if (!(error instanceof TaskRefused)) throw error;
        refused.push({ task, reasons: error.reasons });
      }
    }
    return this.outcome(toStart, refused);
  }

  /**
   * Where each Task stands after the run, read again, as the queue may have released one already:
   * queued with its place and waits while the queue holds it, else started once it has.
   */
  private async outcome(
    toStart: readonly Task[],
    refused: readonly RefusedInRun[],
  ): Promise<ReadyTasksStarted> {
    const [queue, tasks] = await Promise.all([this.queue.list(), this.tasks.list()]);
    const ordered = queueOrder(queue);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const refusedIds = new Set(refused.map(({ task }) => task.id));
    const started: Task[] = [];
    const queued: QueuedInRun[] = [];
    const leftQueue: RefusedInRun[] = [];
    for (const { id } of toStart.filter((task) => !refusedIds.has(task.id))) {
      const task = byId.get(id);
      if (!task) continue;
      const inQueue = ordered.find(({ taskId }) => taskId === id);
      if (inQueue) {
        queued.push({ task, place: ordered.indexOf(inQueue) + 1, reasons: inQueue.reasons });
      } else if (STARTED_STATES.includes(task.state)) {
        started.push(task);
      } else {
        leftQueue.push({ task, reasons: ["It left the queue before it could start."] });
      }
    }
    return { started, queued, refused: [...refused, ...leftQueue] };
  }
}
