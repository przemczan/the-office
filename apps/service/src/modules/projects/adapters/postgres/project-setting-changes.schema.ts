import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ProjectSetting, SettingChangedBy } from "../../domain/project-setting-change.js";
import { projects } from "./projects.schema.js";

/**
 * Each change to a Project's everyday settings: which setting, what changed in words (never a
 * Secret variable's value), who and when. Written only in the transaction that saves the change;
 * kept as long as the Project.
 */
export const projectSettingChanges = pgTable(
  "project_setting_changes",
  {
    id: uuid("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    setting: text("setting").$type<ProjectSetting>().notNull(),
    summary: text("summary").notNull(),
    by: jsonb("by").$type<SettingChangedBy>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // The Project's Recent activity reads its newest changes first.
    index("project_setting_changes_project_newest").on(table.projectId, table.at.desc()),
  ],
);
