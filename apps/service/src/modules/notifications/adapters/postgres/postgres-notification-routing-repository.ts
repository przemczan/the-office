import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  CHANNELS,
  DEFAULT_ROUTING,
  type Channel,
  type Routing,
} from "../../domain/notification-kinds.js";
import { NotificationRoutingRepository } from "../../ports/notification-routing-repository.js";
import { userNotificationRouting } from "./notifications.schema.js";

type RoutingRow = typeof userNotificationRouting.$inferSelect;

@Injectable()
export class PostgresNotificationRoutingRepository extends NotificationRoutingRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async read(userId: string): Promise<Routing> {
    return routingOf(
      await this.database
        .select()
        .from(userNotificationRouting)
        .where(eq(userNotificationRouting.userId, userId)),
    );
  }

  /**
   * Holds the user's routing while the change is worked out, then keeps the routing it gives. A
   * user who never set it has no row to lock, so the lock is on their id.
   */
  async update(userId: string, change: (stored: Routing) => Routing): Promise<Routing> {
    return this.database.transaction(async (transaction) => {
      const lockKey = `user_notification_routing:${userId}`;
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
      const byUser = eq(userNotificationRouting.userId, userId);
      const changed = change(
        routingOf(await transaction.select().from(userNotificationRouting).where(byUser)),
      );
      await transaction.delete(userNotificationRouting).where(byUser);
      const rows = rowsOf(userId, changed);
      if (rows.length > 0) await transaction.insert(userNotificationRouting).values(rows);
      return changed;
    });
  }
}

/**
 * The user's rows as routing. A group always keeps a row for each channel, so none at all means
 * the user never set it: they have the defaults.
 */
function routingOf(rows: readonly RoutingRow[]): Routing {
  if (rows.length === 0) return DEFAULT_ROUTING;
  const routing: Record<string, Partial<Record<Channel, boolean>>> = {};
  for (const { level, channel, on } of rows) routing[level] = { ...routing[level], [channel]: on };
  return routing;
}

function rowsOf(userId: string, routing: Routing): RoutingRow[] {
  return Object.entries(routing).flatMap(([level, settings]) =>
    CHANNELS.flatMap((channel) => {
      const on = settings[channel];
      return on === undefined ? [] : [{ userId, level, channel, on }];
    }),
  );
}
