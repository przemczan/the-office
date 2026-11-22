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

/** What goes where: each user's kinds × channels grid in Account › Notifications (spec §2.7). */
@Injectable()
export class NotificationRouting {
  constructor(
    private readonly repository: NotificationRoutingRepository,
    private readonly events: EventBus,
  ) {}

  read(userId: string): Promise<Routing> {
    return this.repository.read(userId);
  }

  /** Sets a channel on or off at a level of the kinds tree, for every kind below it. */
  setChannel(userId: string, level: string, channel: Channel, on: boolean): Promise<Routing> {
    return this.change(userId, (routing) => withChannelSet(routing, level, channel, on));
  }

  /** Gives a kind back to its group: each channel inherits again. */
  reset(userId: string, level: string): Promise<Routing> {
    return this.change(userId, (routing) => withLevelReset(routing, level));
  }

  private async change(userId: string, change: (routing: Routing) => Routing): Promise<Routing> {
    const routing = await this.repository.update(userId, change);
    await this.events.publish(new RoutingChanged(userId, routing));
    return routing;
  }
}
