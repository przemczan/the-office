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
  publishingMode: publishingModeSchema,
  /** A Pipeline's id. */
  defaultPipeline: z.string(),
});
export type NewProject = z.infer<typeof newProjectSchema>;

export const projectSchema = newProjectSchema.extend({
  id: z.string().min(1),
  useProjectSkills: z.boolean(),
  addedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectListSchema = z.array(projectSchema);

/** PUT /projects/:id/commands/:key */
export const commandChangeSchema = z.object({ commandLine: z.string() });
export type CommandChange = z.infer<typeof commandChangeSchema>;

/** PUT /projects/:id/publishing-mode */
export const publishingModeChangeSchema = z.object({ publishingMode: publishingModeSchema });
export type PublishingModeChange = z.infer<typeof publishingModeChangeSchema>;

/** PUT /projects/:id/default-pipeline */
export const defaultPipelineChangeSchema = z.object({ defaultPipeline: z.string() });
export type DefaultPipelineChange = z.infer<typeof defaultPipelineChangeSchema>;

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
    type: z.literal("project.publishing-mode-changed"),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("project.default-pipeline-changed"),
    projectId: z.string(),
  }),
]);
export type ProjectWebEvent = z.infer<typeof projectWebEventSchema>;
