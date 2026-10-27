import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { RoleCard } from "../../domain/role-card.js";
import type { RoleCardFieldChange } from "../../domain/role-card-changes.js";

/** Each Role someone fills, with the version of its card sessions start with now. */
export const roles = pgTable("roles", {
  key: text("key").primaryKey(),
  cardVersion: integer("card_version").notNull(),
  hiredAt: timestamp("hired_at", { withTimezone: true }).notNull(),
  /** Null while the person fills the Role. */
  letGoAt: timestamp("let_go_at", { withTimezone: true }),
});

/** Every version of each Role's card, kept for the sessions that started with it. */
export const roleCardVersions = pgTable(
  "role_card_versions",
  {
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.key, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    card: jsonb("card").$type<RoleCard>().notNull(),
    /** From the version before; empty for the first. */
    changes: jsonb("changes").$type<RoleCardFieldChange[]>().notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
    /** Who proposed the version, by the key of their Role; null when the user wrote it. */
    proposedBy: text("proposed_by"),
  },
  (table) => [primaryKey({ columns: [table.roleKey, table.version] })],
);
