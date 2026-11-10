import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { ProjectSkillName, SessionSkill } from "../../domain/session-skills.js";
import type { SkillSource, SkillState } from "../../domain/skill.js";

/**
 * Each skill in the library, at its current version; an installed one with its Source, and the
 * update its Source has when the daily check found one.
 */
export const skills = pgTable(
  "skills",
  {
    name: text("name").primaryKey(),
    description: text("description").notNull(),
    source: text("source").$type<SkillSource>().notNull(),
    sourceRepository: text("source_repository"),
    sourceFolder: text("source_folder"),
    pinnedTag: text("pinned_tag"),
    pinnedCommit: text("pinned_commit"),
    updateTag: text("update_tag"),
    updateCommit: text("update_commit"),
    version: integer("version").notNull(),
    filesHash: text("files_hash").notNull(),
    state: text("state").$type<SkillState>().notNull(),
    everyone: boolean("everyone").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "skills_installed_from_source",
      sql`(${table.source} = 'installed') = (${table.sourceRepository} IS NOT NULL AND ${table.sourceFolder} IS NOT NULL AND ${table.pinnedCommit} IS NOT NULL)`,
    ),
    check(
      "skills_update_of_installed",
      sql`${table.updateCommit} IS NULL OR ${table.source} = 'installed'`,
    ),
  ],
);

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
  projectId: text("project_id"),
  projectSkills: jsonb("project_skills").$type<ProjectSkillName[]>().notNull(),
  projectSkillsOff: text("project_skills_off")
    .array()
    .notNull()
    .default(sql`'{}'`),
  preparedAt: timestamp("prepared_at", { withTimezone: true }).notNull(),
});

/**
 * Each Skill use of the last 7 days: of a library skill by its name, which a removed skill takes
 * along, or of a Project skill by its Project and key.
 */
export const skillUses = pgTable(
  "skill_uses",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    usedAt: timestamp("used_at", { withTimezone: true }).notNull(),
    sessionId: text("session_id").notNull(),
    skillName: text("skill_name").references(() => skills.name, { onDelete: "cascade" }),
    projectId: text("project_id"),
    projectSkillKey: text("project_skill_key"),
  },
  (table) => [
    check(
      "skill_uses_library_or_project_skill",
      sql`(${table.skillName} IS NOT NULL AND ${table.projectId} IS NULL AND ${table.projectSkillKey} IS NULL) OR (${table.skillName} IS NULL AND ${table.projectId} IS NOT NULL AND ${table.projectSkillKey} IS NOT NULL)`,
    ),
    index("skill_uses_skill_name").on(table.skillName, table.usedAt),
    index("skill_uses_project_skill").on(table.projectId, table.projectSkillKey, table.usedAt),
    index("skill_uses_used_at").on(table.usedAt),
  ],
);

/** Each library skill assigned to a Role, by the Role's key; a removed skill takes its own along. */
export const roleSkills = pgTable(
  "role_skills",
  {
    roleKey: text("role_key").notNull(),
    skillName: text("skill_name")
      .notNull()
      .references(() => skills.name, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.roleKey, table.skillName] })],
);

/** What each Role gained and lost with each change of its skills, for its change history. */
export const roleSkillChanges = pgTable(
  "role_skill_changes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    roleKey: text("role_key").notNull(),
    added: text("added").array().notNull(),
    removed: text("removed").array().notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("role_skill_changes_role_key").on(table.roleKey)],
);
