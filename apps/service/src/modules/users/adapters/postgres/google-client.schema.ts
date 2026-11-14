import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The Google OAuth client Continue with Google signs in through, in one row once saved. The secret
 * is kept as entered, since it is sent to Google, and is never sent to the web.
 */
export const googleClient = pgTable(
  "google_client",
  {
    id: smallint("id").primaryKey().default(1),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret").notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
  },
  (table) => [check("google_client_one_row", sql`${table.id} = 1`)],
);
