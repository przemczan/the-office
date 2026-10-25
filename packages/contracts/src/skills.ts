import { z } from "zod";
import { webEventSchema } from "./events.js";

/** How a skill came into the library. */
export const skillSourceSchema = z.enum(["written", "uploaded-file", "uploaded-folder"]);
export type SkillSource = z.infer<typeof skillSourceSchema>;

/** Whether sessions get the skill; every new version waits for review. */
export const skillStateSchema = z.enum(["waiting-for-review", "on", "off"]);
export type SkillState = z.infer<typeof skillStateSchema>;

export const skillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  source: skillSourceSchema,
  version: z.number().int().positive(),
  filesHash: z.string(),
  state: skillStateSchema,
  /** Comes with every Role. */
  everyone: z.boolean(),
  addedAt: z.iso.datetime(),
  /** When the current version was saved. */
  savedAt: z.iso.datetime(),
});
export type Skill = z.infer<typeof skillSchema>;

export const skillListSchema = z.array(skillSchema);

/** POST /skills: a skill written in place. PUT /skills/:name takes the same without the name. */
export const writtenSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  instructions: z.string(),
});
export type WrittenSkill = z.infer<typeof writtenSkillSchema>;

export const skillEditSchema = writtenSkillSchema.omit({ name: true });
export type SkillEdit = z.infer<typeof skillEditSchema>;

/**
 * POST /skills/uploads and POST /skills/:name/versions take the file itself as the body
 * (`application/octet-stream`), and its name in the query.
 */
export const skillUploadQuerySchema = z.object({ fileName: z.string().min(1) });
export type SkillUploadQuery = z.infer<typeof skillUploadQuerySchema>;

/** The most an upload's body may be, in bytes. */
export const SKILL_UPLOAD_BYTES = 10 * 1024 * 1024;

/** A file of the skill, as Review shows it. */
export const reviewedFileSchema = z.object({
  path: z.string(),
  /** Absent for a file that is no text. */
  text: z.string().optional(),
  script: z.boolean(),
});
export type ReviewedFile = z.infer<typeof reviewedFileSchema>;

/** GET /skills/:name/review: what the user reads before turning it on. */
export const skillReviewSchema = z.object({
  skill: skillSchema,
  files: z.array(reviewedFileSchema),
  /** SKILL.md's instructions, after its frontmatter. */
  instructions: z.string(),
  warnings: z.array(z.string()),
});
export type SkillReview = z.infer<typeof skillReviewSchema>;

/** PUT /skills/:name/state */
export const skillStateChangeSchema = z.object({ state: z.enum(["on", "off"]) });
export type SkillStateChange = z.infer<typeof skillStateChangeSchema>;

/** PUT /skills/:name/everyone */
export const skillEveryoneChangeSchema = z.object({ everyone: z.boolean() });
export type SkillEveryoneChange = z.infer<typeof skillEveryoneChangeSchema>;

/** What a refused change answers: every reason, also joined into Nest's `message`. */
export const skillRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type SkillRefusal = z.infer<typeof skillRefusalSchema>;

/** GET /projects/:id/skills: a skill or command of the repository's own, read-only. */
export const repositorySkillSchema = z.object({
  /** As a session lists it. */
  name: z.string(),
  description: z.string(),
  /** The skill's folder, or the command's file, inside the repository. */
  path: z.string(),
  /** False below the repository's top: a session lists it once a file below it is read. */
  listedAtStart: z.boolean(),
  /** The library has a skill of the same name, which a session with both also lists. */
  alsoInLibrary: z.boolean(),
});
export type RepositorySkill = z.infer<typeof repositorySkillSchema>;

export const repositorySkillListSchema = z.array(repositorySkillSchema);

/** The library's events the web receives; each names the skill, so its queries refresh. */
export const skillWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("skill.added"), skillName: z.string() }),
  webEventSchema.extend({ type: z.literal("skill.version-saved"), skillName: z.string() }),
  webEventSchema.extend({ type: z.literal("skill.turned-on"), skillName: z.string() }),
  webEventSchema.extend({ type: z.literal("skill.turned-off"), skillName: z.string() }),
  webEventSchema.extend({ type: z.literal("skill.everyone-changed"), skillName: z.string() }),
  webEventSchema.extend({ type: z.literal("skill.removed"), skillName: z.string() }),
]);
export type SkillWebEvent = z.infer<typeof skillWebEventSchema>;
