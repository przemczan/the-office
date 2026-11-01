import { sql } from "drizzle-orm";
import { check, pgTable, smallint, text } from "drizzle-orm/pg-core";

/** The GitHub App behind Sign in with GitHub, in one row once registered. */
export const githubApp = pgTable(
  "github_app",
  {
    id: smallint("id").primaryKey().default(1),
    clientId: text("client_id").notNull(),
    slug: text("slug").notNull(),
    owner: text("owner").notNull(),
  },
  (table) => [check("github_app_one_row", sql`${table.id} = 1`)],
);
