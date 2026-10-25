import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { ProjectMarkColour, PublishingMode } from "../../domain/project.js";

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  baseBranch: text("base_branch").notNull(),
  markLabel: text("mark_label").notNull(),
  markColour: text("mark_colour").$type<ProjectMarkColour>().notNull(),
  installCommand: text("install_command").notNull(),
  buildCommand: text("build_command").notNull(),
  lintCommand: text("lint_command").notNull(),
  testCommand: text("test_command").notNull(),
  publishingMode: text("publishing_mode").$type<PublishingMode>().notNull(),
  defaultPipeline: text("default_pipeline").notNull(),
  useProjectSkills: boolean("use_project_skills").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
});
