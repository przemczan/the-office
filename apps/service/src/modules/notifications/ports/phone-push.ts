import type { Notification } from "../domain/notification.js";

/**
 * The phone channel, outside the browser: pushes a Notification to the user's phone. Task 28 brings
 * Web Push; until then the only adapter records what it would push. Its lines come with the time
 * they name already worded, in the service's time zone, as the phone has no browser to word it.
 */
export abstract class PhonePush {
  abstract push(notification: Notification): Promise<void>;
}
