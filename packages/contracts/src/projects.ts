import { z } from "zod";
import { webEventSchema } from "./events.js";

export const projectCommandKeySchema = z.enum(["install", "build", "lint", "test"]);
export type ProjectCommandKey = z.infer<typeof projectCommandKeySchema>;

/** How Publish ships a Task's branch: pushed with a pull request opened, or merged. */
export const publishingModeSchema = z.enum(["push-and-pull-request", "merge"]);
export type PublishingMode = z.infer<typeof publishingModeSchema>;

/** The design system's ramps a Project's mark may take. */
export const projectMarkColourSchema = z.enum(["teal", "violet", "gray", "ink"]);
export type ProjectMarkColour = z.infer<typeof projectMarkColourSchema>;

const projectMarkSchema = z.object({ label: z.string(), colour: projectMarkColourSchema });

const projectCommandsSchema = z.object({
  install: z.string(),
  build: z.string(),
  lint: z.string(),
  test: z.string(),
});

/** What the user gives to add a Project (POST /projects). */
export const newProjectSchema = z.object({
  name: z.string(),
  path: z.string(),
  baseBranch: z.string(),
  mark: projectMarkSchema,
  commands: projectCommandsSchema,
  /** Paths inside the repository whose change makes a worktree install again. */
  installInputs: z.array(z.string()),
  publishingMode: publishingModeSchema,
  /** A Pipeline's id. */
  defaultPipeline: z.string(),
});
export type NewProject = z.infer<typeof newProjectSchema>;

/** How the Project's commands and Agents change the variables they inherit. */
export const projectEnvironmentSchema = z.object({
  set: z.array(z.object({ name: z.string(), value: z.string() })),
  unset: z.array(z.string()),
  /** Folders put in front of PATH, in this order. */
  prependPath: z.array(z.string()),
});
export type ProjectEnvironment = z.infer<typeof projectEnvironmentSchema>;

export const projectSchema = newProjectSchema.extend({
  id: z.string().min(1),
  environment: projectEnvironmentSchema,
  useProjectSkills: z.boolean(),
  addedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectListSchema = z.array(projectSchema);

/** PUT /projects/:id/commands/:key */
export const commandChangeSchema = z.object({ commandLine: z.string() });
export type CommandChange = z.infer<typeof commandChangeSchema>;

/** PUT /projects/:id/install-inputs */
export const installInputsChangeSchema = z.object({ installInputs: z.array(z.string()) });
export type InstallInputsChange = z.infer<typeof installInputsChangeSchema>;

/** PUT /projects/:id/publishing-mode */
export const publishingModeChangeSchema = z.object({ publishingMode: publishingModeSchema });
export type PublishingModeChange = z.infer<typeof publishingModeChangeSchema>;

/** PUT /projects/:id/default-pipeline */
export const defaultPipelineChangeSchema = z.object({ defaultPipeline: z.string() });
export type DefaultPipelineChange = z.infer<typeof defaultPipelineChangeSchema>;

/** How a Project command ended. */
export const commandOutcomeSchema = z.enum([
  "passed",
  "failed",
  "could-not-run",
  "timed-out",
  "stopped",
]);
export type CommandOutcome = z.infer<typeof commandOutcomeSchema>;

/** A Project command The Office ran, with its output cut to what tells why it failed. */
export const commandRunSchema = z.object({
  commandLine: z.string(),
  outcome: commandOutcomeSchema,
  /** Absent when it never exited by itself. */
  exitCode: z.number().int().optional(),
  durationMs: z.number().int(),
  output: z.string(),
});
export type CommandRun = z.infer<typeof commandRunSchema>;

export const checkStateSchema = z.enum(["waiting", "running", "passed", "failed", "skipped"]);
export type CheckState = z.infer<typeof checkStateSchema>;

/** That a fresh worktree of the freshly fetched base branch opens. */
export const worktreeCheckSchema = z.object({
  step: z.literal("worktree"),
  state: checkStateSchema,
  base: z
    .object({
      commit: z.string(),
      /** Such as `origin/main`; absent when the base branch tracks none and was used unfetched. */
      fetchedFrom: z.string().optional(),
    })
    .optional(),
  /** Why it failed, in git's words. */
  problem: z.string().optional(),
});
export type WorktreeCheck = z.infer<typeof worktreeCheckSchema>;

/** That one of the Project's commands passes in that worktree. */
export const commandCheckSchema = z.object({
  step: projectCommandKeySchema,
  state: checkStateSchema,
  commandLine: z.string(),
  run: commandRunSchema.optional(),
});
export type CommandCheck = z.infer<typeof commandCheckSchema>;

export const environmentCheckStateSchema = z.enum(["running", "passed", "failed", "stopped"]);
export type EnvironmentCheckState = z.infer<typeof environmentCheckStateSchema>;

/** A try of an environment in a fresh worktree; it is saved only when every check passes. */
export const environmentCheckSchema = z.object({
  projectId: z.string(),
  environment: projectEnvironmentSchema,
  state: environmentCheckStateSchema,
  /** The worktree's check, then install, build, lint and test. */
  checks: z.array(z.discriminatedUnion("step", [worktreeCheckSchema, commandCheckSchema])),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
});
export type EnvironmentCheck = z.infer<typeof environmentCheckSchema>;

/** GET /projects/:id/environment-check: the running check, or the last finished one. */
export const latestEnvironmentCheckSchema = z.object({ check: environmentCheckSchema.nullable() });
export type LatestEnvironmentCheck = z.infer<typeof latestEnvironmentCheckSchema>;

/** POST /projects/:id/environment-check */
export const environmentCheckStartSchema = z.object({ environment: projectEnvironmentSchema });
export type EnvironmentCheckStart = z.infer<typeof environmentCheckStartSchema>;

/** What a refused change answers: every reason, also joined into Nest's `message`. */
export const projectRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type ProjectRefusal = z.infer<typeof projectRefusalSchema>;

/** The Project's events the web receives; each says which Project changed, so its queries refresh. */
export const projectWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("project.added"), projectId: z.string() }),
  webEventSchema.extend({
    type: z.literal("project.command-changed"),
    projectId: z.string(),
    key: projectCommandKeySchema,
  }),
  webEventSchema.extend({
    type: z.literal("project.environment-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    /** A check started, one of its checks moved on, or it finished. */
    type: z.literal("project.environment-check-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.install-inputs-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.publishing-mode-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.default-pipeline-changed"),
    projectId: z.string(),
  }),
]);
export type ProjectWebEvent = z.infer<typeof projectWebEventSchema>;
