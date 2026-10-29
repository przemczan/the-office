import type { Routing } from "../domain/notification-kinds.js";

/** The routing the user set in Settings › Notifications, by level. */
export abstract class NotificationRoutingRepository {
  abstract read(): Promise<Routing>;
  /** Applies the change to what is kept, holding it meanwhile, and returns what it kept. */
  abstract update(change: (stored: Routing) => Routing): Promise<Routing>;
}
