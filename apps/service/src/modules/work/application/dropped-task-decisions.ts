import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TaskStateChanged } from "../domain/task-events.js";
import { TaskDecisions } from "../ports/task-decisions.js";
import { TaskRepository } from "../ports/task-repository.js";

/**
 * A dropped Task leaves no Decision open (spec §2.4): each Drop, the Task's own, a Gate's, or its
 * Initiative's taking it along, closes the Decisions still open on it, so none stays in Needs you.
 * At every start, those Tasks dropped before this rule, or while a close failed, are caught up.
 */
@Injectable()
export class DroppedTaskDecisions implements OnModuleInit {
  private readonly logger = new Logger(DroppedTaskDecisions.name);

  constructor(
    private readonly tasks: TaskRepository,
    private readonly decisions: TaskDecisions,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(TaskStateChanged, async ({ taskId, to }) => {
      if (to === "dropped") await this.decisions.closeOnDroppedTask(taskId);
    });
  }

  /**
   * Closes the Decisions left open on every Task already Dropped, run only by the service's own at
   * its start; it changes nothing once none is left open. A failure is only logged.
   */
  async closeLeftOpen(): Promise<void> {
    try {
      for (const taskId of await this.tasks.droppedIds()) {
        await this.decisions.closeOnDroppedTask(taskId);
      }
    } catch (error) {
      // Those left open are closed at the next start.
      this.logger.warn(`Could not close the dropped Tasks' open Decisions: ${String(error)}`);
    }
  }
}
