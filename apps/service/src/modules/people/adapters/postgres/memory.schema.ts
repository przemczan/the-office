import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { MemoryNoteSource } from "../../domain/memory-note.js";
import { roles } from "./roles.schema.js";

/** Each person's Memory: notes only ever added, or deleted. */
export const memoryNotes = pgTable(
  "memory_notes",
  {
    id: text("id").primaryKey(),
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.key, { onDelete: "cascade" }),
    /** A Project the Projects module keeps; no foreign key across modules. */
    projectId: text("project_id"),
    text: text("text").notNull(),
    source: jsonb("source").$type<MemoryNoteSource>().notNull(),
    writtenAt: timestamp("written_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("memory_notes_role_written_idx").on(table.roleKey, table.writtenAt)],
);
