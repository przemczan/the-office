import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { StageRunWaiting } from "../domain/stage-run-events.js";
import type { StageRun } from "../domain/stage-run.js";
import { StageRunRepository } from "../ports/stage-run-repository.js";
import type { CommandWait } from "../ports/task-commands.js";

/**
 * A run's wait for a free run environment before its Project command (spec §2.3): saved on the run,
 * so the Task page shows it after a reload, and told to the web as it begins and ends.
 */
@Injectable()
export class StageRunWaits {
  constructor(
    private readonly runs: StageRunRepository,
    private readonly events: EventBus,
  ) {}

  of(run: Pick<StageRun, "id" | "taskId" | "stageKey">): CommandWait {
    return {
      started: async () => {
        await this.runs.saveWaitingSince(run.id, new Date());
        await this.events.publish(new StageRunWaiting(run.taskId, run.id, run.stageKey, true));
      },
      ended: async () => {
        await this.runs.saveWaitingSince(run.id, undefined);
        await this.events.publish(new StageRunWaiting(run.taskId, run.id, run.stageKey, false));
      },
    };
  }
}
