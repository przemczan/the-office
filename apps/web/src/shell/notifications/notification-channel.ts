/** A Notification as a channel shows it (spec §2.7): the person, one line, what it is about. */
export interface ShownNotification {
  readonly id: string;
  /** The person's name; undefined when The Office speaks, which has no person (spec §2.7 Defaults). */
  readonly person: string | undefined;
  readonly line: string;
  /** The Task and its Project; undefined for the Office's own kinds. */
  readonly about: string | undefined;
  /** Opens what the Notification points to. */
  readonly open: () => void;
}

/**
 * One way a Notification reaches the user in the browser, behind one port: in-app and desktop in
 * tier 1. Showing carries no action buttons; clearing takes it off the channel once the user
 * handled what it points to.
 */
export interface NotificationChannel {
  show(notification: ShownNotification): void;
  clear(notificationId: string): void;
}
