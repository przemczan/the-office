import { sql } from "drizzle-orm";
import { boolean, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type {
  ProjectMarkColour,
  ProjectRoleOverride,
  PublishingMode,
} from "../../domain/project.js";
import type { ProjectEnvironment } from "../../domain/project-environment.js";

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  path: text("path").notNull(),
  repositoryUrl: text("repository_url"),
  baseBranch: text("base_branch").notNull(),
  markLabel: text("mark_label").notNull(),
  markColour: text("mark_colour").$type<ProjectMarkColour>().notNull(),
  installCommand: text("install_command").notNull(),
  buildCommand: text("build_command").notNull(),
  lintCommand: text("lint_command").notNull(),
  testCommand: text("test_command").notNull(),
  installInputs: text("install_inputs")
    .array()
    .notNull()
    .default(sql`'{}'`),
  publishingMode: text("publishing_mode").$type<PublishingMode>().notNull(),
  defaultPipeline: text("default_pipeline").notNull(),
  environment: jsonb("environment")
    .$type<ProjectEnvironment>()
    .notNull()
    .default({ set: [], unset: [], prependPath: [] }),
  useProjectSkills: boolean("use_project_skills").notNull(),
  /** The Project default: both set, or neither. */
  projectDefaultEngineId: text("project_default_engine_id"),
  projectDefaultModel: text("project_default_model"),
  useForEveryRole: boolean("use_for_every_role").notNull().default(false),
  roleOverrides: jsonb("role_overrides")
    .$type<readonly ProjectRoleOverride[]>()
    .notNull()
    .default([]),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
});
