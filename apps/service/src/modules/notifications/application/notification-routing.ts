import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { RoutingChanged } from "../domain/notification-events.js";
import {
  withChannelSet,
  withLevelReset,
  type Channel,
  type Routing,
} from "../domain/notification-kinds.js";
import { NotificationRoutingRepository } from "../ports/notification-routing-repository.js";

/** What goes where: the kinds × channels grid in Settings › Notifications (spec §2.7). */
@Injectable()
export class NotificationRouting {
  constructor(
    private readonly repository: NotificationRoutingRepository,
    private readonly events: EventBus,
  ) {}

  read(): Promise<Routing> {
    return this.repository.read();
  }

  /** Sets a channel on or off at a level of the kinds tree, for every kind below it. */
  setChannel(level: string, channel: Channel, on: boolean): Promise<Routing> {
    return this.change((routing) => withChannelSet(routing, level, channel, on));
  }

  /** Gives a kind back to its group: each channel inherits again. */
  reset(level: string): Promise<Routing> {
    return this.change((routing) => withLevelReset(routing, level));
  }

  private async change(change: (routing: Routing) => Routing): Promise<Routing> {
    const routing = await this.repository.update(change);
    await this.events.publish(new RoutingChanged(routing));
    return routing;
  }
}
