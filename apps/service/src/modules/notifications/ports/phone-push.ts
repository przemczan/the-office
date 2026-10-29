import type { Notification } from "../domain/notification.js";

/**
 * The phone channel, outside the browser: pushes a Notification to the user's phone. Task 28 brings
 * Web Push; until then the only adapter records what it would push.
 */
export abstract class PhonePush {
  abstract push(notification: Notification): Promise<void>;
}
