import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { CHANNELS, type Channel, type Routing } from "../../domain/notification-kinds.js";
import { NotificationRoutingRepository } from "../../ports/notification-routing-repository.js";
import { notificationRouting } from "./notifications.schema.js";

type RoutingRow = typeof notificationRouting.$inferSelect;

@Injectable()
export class PostgresNotificationRoutingRepository extends NotificationRoutingRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async read(): Promise<Routing> {
    return routingOf(await this.database.select().from(notificationRouting));
  }

  /** Holds the whole table while the change is worked out, then keeps the routing it gives. */
  async update(change: (stored: Routing) => Routing): Promise<Routing> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`LOCK TABLE ${notificationRouting} IN EXCLUSIVE MODE`);
      const changed = change(routingOf(await transaction.select().from(notificationRouting)));
      await transaction.delete(notificationRouting);
      const rows = rowsOf(changed);
      if (rows.length > 0) await transaction.insert(notificationRouting).values(rows);
      return changed;
    });
  }
}

function routingOf(rows: readonly RoutingRow[]): Routing {
  const routing: Record<string, Partial<Record<Channel, boolean>>> = {};
  for (const { level, channel, on } of rows) routing[level] = { ...routing[level], [channel]: on };
  return routing;
}

function rowsOf(routing: Routing): RoutingRow[] {
  return Object.entries(routing).flatMap(([level, settings]) =>
    CHANNELS.flatMap((channel) => {
      const on = settings[channel];
      return on === undefined ? [] : [{ level, channel, on }];
    }),
  );
}
