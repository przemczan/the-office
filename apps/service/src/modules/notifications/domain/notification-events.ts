import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Notification } from "./notification.js";
import type { Routing } from "./notification-kinds.js";
import type { NotificationTiming } from "./notification-timing.js";

/**
 * A Notification was raised, for the channels its kind routes to, taking the place of those it
 * `replaces` on them: collapsed Outcomes replace the Outcome, or the collapse, shown before.
 */
export class NotificationRaised extends DomainEvent {
  constructor(
    readonly notification: Notification,
    readonly replaces: readonly string[] = [],
  ) {
    super(notification.raisedAt);
  }
}

/** The user handled what these Notifications point to: they clear on every channel. */
export class NotificationsCleared extends DomainEvent {
  constructor(readonly notificationIds: readonly string[]) {
    super();
  }
}

/** The user changed what goes where in Settings › Notifications: every new Notification follows it. */
export class RoutingChanged extends DomainEvent {
  constructor(readonly routing: Routing) {
    super();
  }
}

/** The user changed when Notifications reach the desktop and the phone. */
export class TimingChanged extends DomainEvent {
  constructor(readonly timing: NotificationTiming) {
    super();
  }
}
