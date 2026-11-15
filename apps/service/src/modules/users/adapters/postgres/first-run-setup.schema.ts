import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";

/**
 * First-run setup, in one row once a setup token is made: the token's SHA-256 only, never the
 * token, and when the basics after the first user opened and closed. An Office whose users came
 * before it has no row, and never opens the basics.
 */
export const firstRunSetup = pgTable(
  "first_run_setup",
  {
    id: smallint("id").primaryKey().default(1),
    setupTokenHash: text("setup_token_hash"),
    setupTokenMadeAt: timestamp("setup_token_made_at", { withTimezone: true }),
    basicsOpenedAt: timestamp("basics_opened_at", { withTimezone: true }),
    basicsClosedAt: timestamp("basics_closed_at", { withTimezone: true }),
  },
  (table) => [check("first_run_setup_one_row", sql`${table.id} = 1`)],
);
