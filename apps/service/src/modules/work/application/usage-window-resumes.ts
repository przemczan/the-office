import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { UsageWindowsRead } from "../../engine/index.js";
import { Schedule, type Wait } from "../../../platform/schedule/schedule.js";
import { TaskPaused } from "../domain/task-events.js";
import { TaskRepository } from "../ports/task-repository.js";
import { TaskService } from "./task-service.js";

/**
 * Resumes each Task the usage window paused at the window's reset (spec §2.1, "A pause by the usage
 * window"), on The Office's clock, which the queue's release for a reset uses too. The waits are in
 * memory; `start` sets them again from each Task's kept resume time as The Office starts, resuming
 * at once a Task whose reset passed while it was down. A reading Engine judges free (`free`)
 * resumes the Tasks its engine's window paused before it was taken, before their reset, and the
 * first reading as The Office starts does so for those its window paused before a restart.
 */
@Injectable()
export class UsageWindowResumes implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageWindowResumes.name);
  private readonly waits = new Map<string, Wait>();

  constructor(
    private readonly tasks: TaskService,
    private readonly repository: TaskRepository,
    private readonly events: EventBus,
    private readonly schedule: Schedule,
  ) {}

  onModuleInit(): void {
    // A pause by the usage window, a refusal again moving its reset on, or Resume the Initiative
    // handing a Task back to the usage window before its reset.
    this.events.subscribe(TaskPaused, async ({ taskId, by }) => {
      if (by === "usage-window") await this.resumeAtResetOf(taskId);
    });
    this.events.subscribe(UsageWindowsRead, async ({ engineId, readAt, free }) => {
      if (free) await this.resumeFreed(engineId, readAt);
    });
  }

  onModuleDestroy(): void {
    for (const wait of this.waits.values()) wait.cancel();
    this.waits.clear();
  }

  /** As The Office starts: the wait of every Task the usage window holds. */
  async start(): Promise<void> {
    for (const task of await this.repository.list()) {
      if (task.pausedBy === "usage-window" && task.resumesAt !== undefined) {
        this.resumeAt(task.id, task.resumesAt);
      }
    }
  }

  private async resumeFreed(engineId: string, readAt: Date): Promise<void> {
    const freed = await this.tasks.resumeFreedByUsageWindow(engineId, readAt);
    for (const taskId of freed) {
      this.waits.get(taskId)?.cancel();
      this.waits.delete(taskId);
      this.logger.log(`Task ${taskId}: ${engineId}'s usage windows read free before the reset.`);
    }
  }

  private async resumeAtResetOf(taskId: string): Promise<void> {
    const task = await this.repository.find(taskId);
    if (task?.pausedBy === "usage-window" && task.resumesAt !== undefined) {
      this.resumeAt(task.id, task.resumesAt);
    }
  }

  private resumeAt(taskId: string, at: Date): void {
    this.waits.get(taskId)?.cancel();
    this.waits.set(
      taskId,
      this.schedule.once("The resume at a usage window's reset", at, async () => {
        this.waits.delete(taskId);
        await this.tasks.resumeAtReset(taskId, this.schedule.now());
        this.logger.log(`Task ${taskId}: its usage window reset at ${at.toISOString()}.`);
      }),
    );
  }
}
