import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { IdentityProviderId } from "../../domain/linked-identity.js";
import { users } from "./users.schema.js";

/**
 * Each user's linked identities: the provider, its own id for the person (`subject`, GitHub's
 * numeric user id as text) and its name for them (a GitHub login), shown only. Never a token.
 * Continue with a provider finds a user only by (provider, subject). Removing a user deletes
 * theirs on `UserRemoved`, as their row stays.
 */
export const linkedIdentities = pgTable(
  "linked_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<IdentityProviderId>().notNull(),
    subject: text("subject").notNull(),
    name: text("name").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull(),
    lastSignedInAt: timestamp("last_signed_in_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("linked_identities_provider_subject").on(table.provider, table.subject),
    // Also the index of a user's own, by its first column.
    uniqueIndex("linked_identities_user_provider").on(table.userId, table.provider),
  ],
);
