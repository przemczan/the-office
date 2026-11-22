import { sql } from "drizzle-orm";
import { boolean, check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type {
  ProjectCommand,
  ProjectMarkColour,
  ProjectRoleOverride,
  PublishingMode,
  RunEnvironmentSetting,
} from "../../domain/project.js";
import type { IssueUser } from "../../domain/issue-settings.js";
import type { StoredEnvironment } from "./stored-environment.js";
import { NO_PROJECT_IMAGE, type ProjectImageVersions } from "../../domain/project-image.js";

/** A command as it is kept: one saved before re-run commands has none, read as blank. */
export type StoredProjectCommand = Omit<ProjectCommand, "rerunCommandLine"> & {
  readonly rerunCommandLine?: string;
};

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
    commands: jsonb("commands").$type<readonly StoredProjectCommand[]>().notNull().default([]),
    installInputs: text("install_inputs")
      .array()
      .notNull()
      .default(sql`'{}'`),
    publishingMode: text("publishing_mode").$type<PublishingMode>().notNull(),
    beforePublishingCommand: text("before_publishing_command").notNull().default(""),
    afterPublishingCommand: text("after_publishing_command").notNull().default(""),
    deleteMergedBranches: boolean("delete_merged_branches").notNull().default(false),
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
    /** Each Kind's own default Pipeline; null follows `default_pipeline`. */
    featureDefaultPipeline: text("feature_default_pipeline"),
    bugDefaultPipeline: text("bug_default_pipeline"),
    choreDefaultPipeline: text("chore_default_pipeline"),
    /** Null while the auto-import is off. */
    issueImportLabel: text("issue_import_label"),
    /** The user who set the label, named in `created_by` of the Tasks the auto-import makes. */
    issueImportLabelSetBy: jsonb("issue_import_label_set_by").$type<IssueUser>(),
    closeIssueOnDone: boolean("close_issue_on_done").notNull().default(true),
    commentOnIssue: boolean("comment_on_issue").notNull().default(false),
    closeIssueOnDrop: boolean("close_issue_on_drop").notNull().default(false),
  },
  (table) => [check("projects_project_limit", sql`${table.projectLimit} > 0`)],
);
