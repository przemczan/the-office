import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Each Project's adb key (spec §2.13, "The adb key"), kept as its Secret variables are. The Project
 * is Projects' record, named by id alone; a Project is never removed.
 */
export const projectAdbKeys = pgTable("project_adb_keys", {
  projectId: text("project_id").primaryKey(),
  privateKey: text("private_key").notNull(),
  publicKey: text("public_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});
