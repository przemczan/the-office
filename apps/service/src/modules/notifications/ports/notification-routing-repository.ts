import type { Routing } from "../domain/notification-kinds.js";

/**
 * Each user's routing, set in Account › Notifications, by level: spec 2.7's defaults until the
 * user sets one.
 */
export abstract class NotificationRoutingRepository {
  abstract read(userId: string): Promise<Routing>;
  /** Applies the change to what the user keeps, holding it meanwhile, and returns what it kept. */
  abstract update(userId: string, change: (stored: Routing) => Routing): Promise<Routing>;
}
