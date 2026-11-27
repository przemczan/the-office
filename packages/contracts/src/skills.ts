import { z } from "zod";
import { webEventSchema } from "./events.js";
import { officeAction } from "./office-actions.js";

/** How a skill came into the library. */
export const skillSourceSchema = z.enum([
  "written",
  "uploaded-file",
  "uploaded-folder",
  "installed",
]);
export type SkillSource = z.infer<typeof skillSourceSchema>;

/** The release of its Source an installed skill is held at; no tag when the Source has none. */
export const pinnedVersionSchema = z.object({
  tag: z.string().optional(),
  commit: z.string(),
});
export type PinnedVersion = z.infer<typeof pinnedVersionSchema>;

/** An installed skill's Source: `owner/repo` or a git URL, and the skill's folder in it. */
export const installedSourceSchema = z.object({
  repository: z.string(),
  /** Empty for the repository's top folder. */
  folder: z.string(),
  pinnedVersion: pinnedVersionSchema,
});
export type InstalledSource = z.infer<typeof installedSourceSchema>;

/** Whether sessions get the skill; every new version waits for review. */
export const skillStateSchema = z.enum(["waiting-for-review", "on", "off"]);
export type SkillState = z.infer<typeof skillStateSchema>;

export const skillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  source: skillSourceSchema,
  /** There exactly when it was installed. */
  installedFrom: installedSourceSchema.optional(),
  /** The newer pinned version its Source has, found by the daily check: "Update available". */
  update: pinnedVersionSchema.optional(),
  version: z.number().int().positive(),
  filesHash: z.string(),
  state: skillStateSchema,
  /** Comes with every Role. */
  everyone: z.boolean(),
  /** The Roles it is assigned to, by key, besides everyone when it is for everyone. */
  roles: z.array(z.string()),
  addedAt: z.iso.datetime(),
  /** When the current version was saved. */
  savedAt: z.iso.datetime(),
  /** Its Skill uses in the last 7 days, a rolling window (spec §2.6). */
  usesInLast7Days: z.number().int().nonnegative(),
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

const COMMIT = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/, "must be a commit id");

/** GET /skills/:name/update-diff: the update's pinned versions, from and to, in the query. */
export const skillUpdateDiffQuerySchema = z.object({
  fromTag: z.string().min(1).optional(),
  fromCommit: COMMIT,
  toTag: z.string().min(1).optional(),
  toCommit: COMMIT,
});
export type SkillUpdateDiffQuery = z.infer<typeof skillUpdateDiffQuerySchema>;

/** What an update changes in the skill's files, from its pinned version to the newer one. */
export const skillUpdateDiffSchema = z.object({
  from: pinnedVersionSchema,
  to: pinnedVersionSchema,
  /** The unified diff of the skill's folder, its paths inside the folder. */
  diff: z.string(),
  /** The diff stops at a whole line: the rest is too long to show. */
  diffCut: z.boolean(),
});
export type SkillUpdateDiff = z.infer<typeof skillUpdateDiffSchema>;

/** PUT /skills/:name/state */
export const skillStateChangeSchema = z.object({ state: z.enum(["on", "off"]) });
export type SkillStateChange = z.infer<typeof skillStateChangeSchema>;

/** PUT /skills/:name/everyone */
export const skillEveryoneChangeSchema = z.object({ everyone: z.boolean() });
export type SkillEveryoneChange = z.infer<typeof skillEveryoneChangeSchema>;

/** PUT /skills/:name/roles: exactly the Roles that have it, by key. */
export const skillRolesChangeSchema = z.object({ roles: z.array(z.string().min(1)) });
export type SkillRolesChange = z.infer<typeof skillRolesChangeSchema>;

const skillNameInput = z.string().min(1).describe("The skill's name, as the library lists it.");

/** Office action: a skill written in place, which arrives off until the user reviews it. */
export const WRITE_SKILL_ACTION = officeAction({
  name: "write_skill",
  title: "Write a skill",
  description:
    "Adds a new skill to the library, written as its SKILL.md: its name, when to use it and its instructions. It arrives off until the user has reviewed it. Refused when the name is taken or the skill is invalid.",
  input: writtenSkillSchema.extend({
    name: z
      .string()
      .describe(
        "The skill's name: lowercase letters and digits in words joined by dashes, such as release-notes.",
      ),
    description: z
      .string()
      .describe("When to use the skill, in one sentence; every session that has it lists it."),
    instructions: z
      .string()
      .describe("The skill's instructions, in Markdown: the body of its SKILL.md."),
  }),
  answer: skillSchema,
  route: { method: "POST", path: "/skills" },
  status: 201,
  area: "library",
  group: "skills",
  subject: ({ name }) => ({ kind: "skill", id: name.trim() }),
});

/** Office action: the next version of a skill written in place. */
export const EDIT_SKILL_ACTION = officeAction({
  name: "edit_skill",
  title: "Edit a skill",
  description:
    "Saves the next version of a skill written in place: its description and instructions, whole. The new version waits for review. Refused for a skill that wasn't written in place.",
  input: skillEditSchema.extend({ name: skillNameInput }),
  answer: skillSchema,
  route: { method: "PUT", path: "/skills/:name" },
  area: "library",
  group: "skills",
  subject: ({ name }) => ({ kind: "skill", id: name }),
});

/** POST /skills/installs: one skill of a Source, at the version the Source is pinned at now. */
export const skillInstallSchema = z.object({
  source: z
    .string()
    .min(1)
    .describe(
      "The source: owner/repo on GitHub, or a git URL (https://, ssh://, git@ or file://).",
    ),
  folder: z
    .string()
    .describe(
      "The skill's folder in the source, as list_source_skills gives it; empty for its top folder.",
    ),
});
export type SkillInstall = z.infer<typeof skillInstallSchema>;

/** Office action: one skill installed from a Source, off until the user reviews it. */
export const INSTALL_SKILL_ACTION = officeAction({
  name: "install_skill",
  title: "Install a skill from a source",
  description:
    "Installs one skill from a source into the library, pinned at the source's newest tag (its newest commit when it has no tags); install one skill per call. It arrives off until the user has reviewed it. Refused when the source or folder holds no valid skill or the name is taken.",
  input: skillInstallSchema,
  answer: skillSchema,
  route: { method: "POST", path: "/skills/installs" },
  status: 201,
  area: "library",
  group: "skills",
  subject: ({ source, folder }) => ({ kind: "skill", id: `${source.trim()}#${folder.trim()}` }),
});

/** Office action: an installed skill updated to its Source's newest version. */
export const UPDATE_SKILL_ACTION = officeAction({
  name: "update_skill",
  title: "Update a skill",
  description:
    "Updates an installed skill to its source's newest version; it stays on or off as it was. Read it with read_skill_update first. Refused when the skill wasn't installed, its source has nothing newer, or it holds another skill there now.",
  input: z.object({
    name: skillNameInput,
    notes: z
      .string()
      .optional()
      .describe(
        "What the update changes and what it means for whoever uses the skill, in a sentence or two.",
      ),
  }),
  answer: skillSchema,
  route: { method: "POST", path: "/skills/:name/update" },
  status: 200,
  area: "library",
  group: "skills",
  subject: ({ name }) => ({ kind: "skill", id: name }),
});

/** Office action: a skill turned on or off. */
export const CHANGE_SKILL_STATE_ACTION = officeAction({
  name: "change_skill_state",
  title: "Turn a skill on or off",
  description:
    "Turns a skill on or off for the sessions that have it. Turning it on is the user's review of what it holds; refused for a skill still waiting for review unless it is reviewed.",
  input: skillStateChangeSchema.extend({ name: skillNameInput }),
  answer: skillSchema,
  route: { method: "PUT", path: "/skills/:name/state" },
  area: "library",
  group: "skills",
  subject: ({ name }) => ({ kind: "skill", id: name }),
});

/** Office action: a skill given to every Role, or to none by default. */
export const CHANGE_SKILL_EVERYONE_ACTION = officeAction({
  name: "change_skill_everyone",
  title: "Change whether a skill comes with every Role",
  description: "Sets whether a skill comes with every Role besides the Roles it is assigned to.",
  input: skillEveryoneChangeSchema.extend({ name: skillNameInput }),
  answer: skillSchema,
  route: { method: "PUT", path: "/skills/:name/everyone" },
  area: "library",
  group: "skills",
  subject: ({ name }) => ({ kind: "skill", id: name }),
});

/** Office action: exactly the Roles a skill is assigned to. */
export const CHANGE_SKILL_ROLES_ACTION = officeAction({
  name: "change_skill_roles",
  title: "Change the Roles of a skill",
  description:
    "Assigns a skill to exactly the Roles given, by key, replacing the Roles it had; their next sessions get it.",
  input: skillRolesChangeSchema.extend({ name: skillNameInput }),
  answer: skillSchema,
  route: { method: "PUT", path: "/skills/:name/roles" },
  area: "library",
  group: "skills",
  subject: ({ name }) => ({ kind: "skill", id: name }),
});

/** Office action: a skill removed from the library. */
export const DELETE_SKILL_ACTION = officeAction({
  name: "delete_skill",
  title: "Delete a skill",
  description: "Removes a skill from the library, with all its versions and its Role assignments.",
  input: z.object({ name: skillNameInput }),
  answer: z.void(),
  route: { method: "DELETE", path: "/skills/:name" },
  status: 204,
  area: "library",
  group: "skills",
  subject: ({ name }) => ({ kind: "skill", id: name }),
});

/** The Office actions the skill library carries out. */
export const SKILLS_OFFICE_ACTIONS = [
  WRITE_SKILL_ACTION,
  EDIT_SKILL_ACTION,
  INSTALL_SKILL_ACTION,
  UPDATE_SKILL_ACTION,
  CHANGE_SKILL_STATE_ACTION,
  CHANGE_SKILL_EVERYONE_ACTION,
  CHANGE_SKILL_ROLES_ACTION,
  DELETE_SKILL_ACTION,
] as const;

/** What a refused change answers: every reason, also joined into Nest's `message`. */
export const skillRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type SkillRefusal = z.infer<typeof skillRefusalSchema>;

/** GET /projects/:id/skills: a skill or command of the repository's own, read-only. */
export const projectSkillSchema = z.object({
  /** What the Project turns it off by; two with the same key are one skill to the engine. */
  key: z.string(),
  /** As a session lists it. */
  name: z.string(),
  description: z.string(),
  /** The skill's folder, or the command's file, inside the repository. */
  path: z.string(),
  /** False below the repository's top: a session lists it once a file below it is read. */
  listedAtStart: z.boolean(),
  /** The library has a skill of the same name, which a session with both also lists. */
  alsoInLibrary: z.boolean(),
  /** Its Skill uses in this Project in the last 7 days, counted by its key (spec §2.6). */
  usesInLast7Days: z.number().int().nonnegative(),
});
export type ProjectSkill = z.infer<typeof projectSkillSchema>;

export const projectSkillListSchema = z.array(projectSkillSchema);

/** The skill a Skill use counted for: a library skill by its name, a Project skill by its key. */
export const usedSkillSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("library"), skillName: z.string() }),
  z.object({ kind: z.literal("project"), projectId: z.string(), key: z.string() }),
]);
export type UsedSkill = z.infer<typeof usedSkillSchema>;

/** The library's events the web receives; each names the skill, so its queries refresh. */
export const skillWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("skill.added"), skillName: z.string() }),
  webEventSchema.extend({ type: z.literal("skill.version-saved"), skillName: z.string() }),
  webEventSchema.extend({ type: z.literal("skill.turned-on"), skillName: z.string() }),
  webEventSchema.extend({ type: z.literal("skill.turned-off"), skillName: z.string() }),
  webEventSchema.extend({ type: z.literal("skill.everyone-changed"), skillName: z.string() }),
  /** The daily check found an update at its Source, or the one it found is gone. */
  webEventSchema.extend({ type: z.literal("skill.update-found"), skillName: z.string() }),
  webEventSchema.extend({ type: z.literal("skill.update-gone"), skillName: z.string() }),
  /** An update was applied: pinned at the newer version, on or off as it was. */
  webEventSchema.extend({ type: z.literal("skill.updated"), skillName: z.string() }),
  webEventSchema.extend({ type: z.literal("skill.removed"), skillName: z.string() }),
  /** The Role's skills changed, from its card or from Settings › Skills. */
  webEventSchema.extend({ type: z.literal("skill.role-skills-changed"), roleKey: z.string() }),
  /** A session used a skill, so its count in the last 7 days grew. */
  webEventSchema.extend({ type: z.literal("skill.used"), skill: usedSkillSchema }),
]);
export type SkillWebEvent = z.infer<typeof skillWebEventSchema>;
