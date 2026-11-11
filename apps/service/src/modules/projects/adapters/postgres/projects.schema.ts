import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type {
  ProjectCommand,
  ProjectMarkColour,
  ProjectRoleOverride,
  PublishingMode,
  RunEnvironmentSetting,
} from "../../domain/project.js";
import type { StoredEnvironment } from "./stored-environment.js";
import { NO_PROJECT_IMAGE, type ProjectImageVersions } from "../../domain/project-image.js";

export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    path: text("path").notNull(),
    repositoryUrl: text("repository_url"),
    baseBranch: text("base_branch").notNull(),
    markLabel: text("mark_label").notNull(),
    markColour: text("mark_colour").$type<ProjectMarkColour>().notNull(),
    icon: jsonb("icon").$type<ProjectImageVersions>().notNull().default(NO_PROJECT_IMAGE),
    logo: jsonb("logo").$type<ProjectImageVersions>().notNull().default(NO_PROJECT_IMAGE),
    installCommand: text("install_command").notNull(),
    commands: jsonb("commands").$type<readonly ProjectCommand[]>().notNull().default([]),
    installInputs: text("install_inputs")
      .array()
      .notNull()
      .default(sql`'{}'`),
    publishingMode: text("publishing_mode").$type<PublishingMode>().notNull(),
    defaultPipeline: text("default_pipeline").notNull(),
    environment: jsonb("environment")
      .$type<StoredEnvironment>()
      .notNull()
      .default({ set: [], unset: [], prependPath: [] }),
    useProjectSkills: boolean("use_project_skills").notNull(),
    projectSkillsOff: text("project_skills_off")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** The Project default: both set, or neither. */
    projectDefaultEngineId: text("project_default_engine_id"),
    projectDefaultModel: text("project_default_model"),
    useForEveryRole: boolean("use_for_every_role").notNull().default(false),
    roleOverrides: jsonb("role_overrides")
      .$type<readonly ProjectRoleOverride[]>()
      .notNull()
      .default([]),
    runEnvironment: text("run_environment")
      .$type<RunEnvironmentSetting>()
      .notNull()
      .default("not-decided"),
    runEnvironmentSetUpProblems: text("run_environment_set_up_problems")
      .array()
      .notNull()
      .default(sql`'{}'`),
    projectLimit: integer("project_limit").notNull().default(1),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  },
  (table) => [check("projects_project_limit", sql`${table.projectLimit} > 0`)],
);
