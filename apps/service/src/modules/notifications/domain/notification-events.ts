import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Notification } from "./notification.js";
import type { Routing } from "./notification-kinds.js";

/** A Notification was raised, for the channels its kind routes to. */
export class NotificationRaised extends DomainEvent {
  constructor(readonly notification: Notification) {
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
