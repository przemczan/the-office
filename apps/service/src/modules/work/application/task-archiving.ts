import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { archiveCutoff, archiveIfDue, isFinishedOnTheBoard } from "../domain/task-archive.js";
import { TaskRepository } from "../ports/task-repository.js";
import { WorkSettings } from "../ports/work-settings.js";

/** The daily run's name in the logs. */
export const TASK_ARCHIVING = "archiving finished Tasks";

/**
 * Archives every Done or Dropped Task once its Archive period has passed (spec §2.1), as the
 * user's Archive does. Started only by the service's own start, never by a test app, whose
 * database every test file shares.
 */
@Injectable()
export class TaskArchiving {
  private readonly logger = new Logger(TaskArchiving.name);

  constructor(
    private readonly repository: TaskRepository,
    private readonly settings: WorkSettings,
    private readonly schedule: Schedule,
    private readonly events: EventBus,
  ) {}

  /** Runs now, then once a day; the first run archives every Task already past the period. */
  start(): void {
    this.schedule.daily(TASK_ARCHIVING, async () => {
      await this.archiveDue();
    });
  }

  /** One run: archives each Task due by the period saved now, and says how many. */
  async archiveDue(): Promise<number> {
    const now = this.schedule.now();
    const cutoff = archiveCutoff(now, await this.settings.archivePeriod());
    const candidates = (await this.repository.list()).filter(isFinishedOnTheBoard);
    let archived = 0;
    for (const { id } of candidates) {
      // Weighed again while the Task is held, so a Restore since the list isn't undone.
      const { event } = await this.repository.update(id, (task) => archiveIfDue(task, cutoff, now));
      if (!event) continue;
      await this.events.publish(event);
      archived += 1;
    }
    this.logger.log(`Archived ${archived} finished ${archived === 1 ? "Task" : "Tasks"}.`);
    return archived;
  }
}
