import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { BusyItem } from "../domain/busy-item.js";
import { BusyWorkChanged } from "../domain/busy-work-events.js";

/** Ends a piece of work `BusyWork.begin` counted. Calling it again does nothing. */
export type EndBusyWork = () => void;

/**
 * The work going on now that a scheduled Office update waits for (spec §5.1 Defaults): each
 * module counts its own, where it starts and ends it (an Agent's turn, a Script Stage, a Publish, a
 * clone, an environment check). Kept in memory, as a restart ends all of it.
 */
@Injectable()
export class BusyWork {
  private readonly going = new Map<symbol, BusyItem>();

  constructor(private readonly events: EventBus) {}

  /**
   * Counts the item as busy until the returned function is called. The change is announced in the
   * background, so a caller counting in the middle of its own work never waits on the reactions.
   */
  begin(item: BusyItem): EndBusyWork {
    const key = Symbol(item.label);
    this.going.set(key, item);
    this.changed();
    return () => {
      if (this.going.delete(key)) this.changed();
    };
  }

  /** Runs `work`, counting the item as busy until it ends, however it ends. */
  async during<Result>(item: BusyItem, work: () => Promise<Result>): Promise<Result> {
    const end = this.begin(item);
    try {
      return await work();
    } finally {
      end();
    }
  }

  list(): readonly BusyItem[] {
    return [...this.going.values()];
  }

  private changed(): void {
    // oxlint-disable-next-line office/caught-voided-calls -- the bus logs a failing reaction itself
    void this.events.publish(new BusyWorkChanged(this.going.size));
  }
}
