import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { ReceivedNotification } from "./notification.js";
import type { Routing } from "./notification-kinds.js";
import type { NotificationTiming } from "./notification-timing.js";

/**
 * A Notification reached one user, on the channels their routing gives it, taking the place of
 * those it `replaces` on them: their collapsed Outcomes replace the Outcome, or the collapse, they
 * were shown before. One event for each user it reaches.
 */
export class NotificationRaised extends DomainEvent {
  constructor(
    readonly userId: string,
    readonly notification: ReceivedNotification,
    readonly replaces: readonly string[] = [],
  ) {
    super(notification.raisedAt);
  }
}

/** The user handled what these Notifications point to: they clear on every channel, for everyone. */
export class NotificationsCleared extends DomainEvent {
  constructor(readonly notificationIds: readonly string[]) {
    super();
  }
}

/**
 * A user changed what goes where in Account › Notifications: every new Notification reaches them
 * by it.
 */
export class RoutingChanged extends DomainEvent {
  constructor(
    readonly userId: string,
    readonly routing: Routing,
  ) {
    super();
  }
}

/** A user changed when Notifications reach their desktop and phone. */
export class TimingChanged extends DomainEvent {
  constructor(
    readonly userId: string,
    readonly timing: NotificationTiming,
  ) {
    super();
  }
}
