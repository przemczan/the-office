import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { SessionSkill } from "../../domain/session-skills.js";
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

/** What each session got, while it can be resumed. */
export const sessionSkills = pgTable("session_skills", {
  sessionId: text("session_id").primaryKey(),
  skills: jsonb("skills").$type<SessionSkill[]>().notNull(),
  projectSkills: text("project_skills")
    .array()
    .notNull()
    .default(sql`'{}'`),
  projectSkillsOff: text("project_skills_off")
    .array()
    .notNull()
    .default(sql`'{}'`),
  preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull(),
});
