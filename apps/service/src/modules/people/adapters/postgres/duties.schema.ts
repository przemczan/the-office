import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * The duties the user set, one row each: a missing row is a duty never set, held by its default
 * Role key. No foreign key to `roles`, since a default key may never be hired and a let-go Role
 * keeps its row.
 */
export const dutyAssignments = pgTable("duty_assignments", {
  duty: text("duty").primaryKey(),
  /** Null when the user set the duty to none. */
  roleKey: text("role_key"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
});
