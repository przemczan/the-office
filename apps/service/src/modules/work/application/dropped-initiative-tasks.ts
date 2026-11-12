import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { dropLeftOpenTasks } from "../domain/initiative-changes.js";
import type { StateChangeCause } from "../domain/state-change.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";

export const ITS_INITIATIVE_WAS_DROPPED: StateChangeCause = {
  kind: "office",
  reason: "its Initiative was dropped",
};

/**
 * Drops the Tasks that Initiatives dropped before a Drop took its Tasks along left open (spec 2.1,
 * "An Initiative is done"). Run at every start, only by the service's own, as it changes nothing
 * once none is left open.
 */
@Injectable()
export class DroppedInitiativeTasks {
  private readonly logger = new Logger(DroppedInitiativeTasks.name);

  constructor(
    private readonly repository: InitiativeRepository,
    private readonly events: EventBus,
  ) {}

  /** Drops them one Initiative per save, and says how many Tasks; a failure is only logged. */
  async dropLeftOpen(): Promise<number> {
    try {
      return await this.dropEach();
    } catch (error) {
      // Those left open are dropped at the next start.
      this.logger.warn(`Could not drop the dropped Initiatives' open Tasks: ${String(error)}`);
      return 0;
    }
  }

  private async dropEach(): Promise<number> {
    const dropped = (await this.repository.list()).filter(({ state }) => state === "dropped");
    let count = 0;
    for (const { id } of dropped) {
      // Weighed again while the Initiative and its Tasks are held.
      const taskChanges = await this.repository.changeTasks(id, (initiative, tasks) =>
        dropLeftOpenTasks(initiative, tasks, ITS_INITIATIVE_WAS_DROPPED),
      );
      for (const { event } of taskChanges) await this.events.publish(event);
      count += taskChanges.length;
    }
    if (count > 0) this.logger.log(`Dropped ${count} Tasks of dropped Initiatives.`);
    return count;
  }
}
