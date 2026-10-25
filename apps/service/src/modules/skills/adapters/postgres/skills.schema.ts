import { boolean, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { SkillSource, SkillState } from "../../domain/skill.js";

/** Each skill in the library, at its current version. */
export const skills = pgTable("skills", {
  name: text("name").primaryKey(),
  description: text("description").notNull(),
  source: text("source").$type<SkillSource>().notNull(),
  version: integer("version").notNull(),
  filesHash: text("files_hash").notNull(),
  state: text("state").$type<SkillState>().notNull(),
  everyone: boolean("everyone").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
});

/** Every version each skill in the library has had. */
export const skillVersions = pgTable(
  "skill_versions",
  {
    skillName: text("skill_name")
      .notNull()
      .references(() => skills.name, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    filesHash: text("files_hash").notNull(),
    description: text("description").notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.skillName, table.version] })],
);
