import { z } from "zod";
import { effortSchema, hardSwitchValueSchema, runPermissionSchema } from "./people.js";
import { projectCommandKeySchema } from "./projects.js";

/** "On failure go back to Stage X, at most N times": the Stage's key and its rounds. */
export const onFailureSchema = z.object({
  goBackTo: z.string().min(1),
  rounds: z.int().positive(),
});

/** Where a Publish Stage takes the Task's branch (spec §2.3). */
export const publishTargetSchema = z.enum(["publishing-mode", "branch-only"]);
export type PublishTarget = z.infer<typeof publishTargetSchema>;

/** What a Publish Stage does once a conflict is resolved and tested (spec §2.3). */
export const afterConflictSchema = z.enum(["publish", "review"]);
export type AfterConflict = z.infer<typeof afterConflictSchema>;

/**
 * What an Agent Stage states of its Role card's permission profile (spec §6), each absent where the
 * card's stands: it may narrow the profile, never widen it, so editing and the web can only be taken
 * away. MCP tools are keyed `server/tool`, as on the card. `commands` keeps only those of the
 * Project's commands, by key; absent keeps every one, and install is never among them.
 */
export const stagePermissionsSchema = z.object({
  edit: z.literal(false).optional(),
  run: runPermissionSchema.optional(),
  web: z.literal(false).optional(),
  mcpTools: z.record(z.string().regex(/^[a-z0-9-]+\/.+$/), hardSwitchValueSchema).optional(),
  commands: z
    .array(projectCommandKeySchema)
    .min(1, "List at least one Project command, or leave the Role card's.")
    .refine((keys) => new Set(keys).size === keys.length, {
      error: "A Project command is listed twice.",
    })
    .optional(),
});
export type StagePermissions = z.infer<typeof stagePermissionsSchema>;

/**
 * What a Script Stage runs: `publish`, kept for Publish, or a Project command by its key. Install is
 * never a Stage's, as it runs before every Stage on its own (spec §2.3).
 */
export const scriptStageCommandSchema = z.union([z.literal("publish"), projectCommandKeySchema]);

const stageFields = {
  key: z.string().min(1),
  name: z.string(),
  optional: z.boolean(),
};

/**
 * A Stage of a Pipeline (spec §2.3), apart from the rest of Pipelines' contracts so that a
 * Proposal of a Pipeline's Stages can name it.
 */
export const stageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent"),
    ...stageFields,
    /** The key of the Role that works it. */
    role: z.string(),
    brief: z.string(),
    session: z.enum(["fresh", "continue"]),
    /** Tokens. */
    budget: z.int().positive(),
    /** Absent keeps the Role's. */
    effort: effortSchema.optional(),
    /** Absent keeps the Role card's profile whole. */
    permissions: stagePermissionsSchema.optional(),
    onFailure: onFailureSchema.optional(),
  }),
  z.object({
    kind: z.literal("script"),
    ...stageFields,
    command: scriptStageCommandSchema,
    /**
     * A Publish Stage's alone: by the Project's publishing mode, or pushing the Task's branch only,
     * for a proof of concept. Absent means the publishing mode.
     */
    publishTarget: publishTargetSchema.optional(),
    /** A Publish Stage's alone: absent publishes automatically. */
    afterConflict: afterConflictSchema.optional(),
    onFailure: onFailureSchema.optional(),
  }),
  z.object({ kind: z.literal("gate"), ...stageFields }),
]);
export type Stage = z.infer<typeof stageSchema>;

/**
 * The fields a Change gives a Stage of a Project Pipeline, at least one; `null` clears an optional
 * one. Never its key or kind, which take a Replace (spec §2.3).
 */
export const stageFieldChangesSchema = z
  .strictObject({
    name: z.string().optional(),
    optional: z.boolean().optional(),
    role: z.string().optional(),
    brief: z.string().optional(),
    session: z.enum(["fresh", "continue"]).optional(),
    budget: z.int().positive().optional(),
    effort: effortSchema.nullable().optional(),
    permissions: stagePermissionsSchema.nullable().optional(),
    onFailure: onFailureSchema.nullable().optional(),
    command: scriptStageCommandSchema.optional(),
    publishTarget: publishTargetSchema.nullable().optional(),
    afterConflict: afterConflictSchema.nullable().optional(),
  })
  .refine((fields) => Object.values(fields).some((value) => value !== undefined), {
    error: "A Change gives at least one field.",
  });
export type StageFieldChanges = z.infer<typeof stageFieldChangesSchema>;

const stageKeyField = { stageKey: z.string().min(1) };

const stageNameField = {
  /** The name its Stage had when the Project Pipeline was last saved, for its words alone. */
  stageName: z.string(),
};

/** The five Stage changes by `kind`, each with `named`: the Stage's name, given or kept. */
function stageChangeVariants<Named extends z.ZodType>(named: Named) {
  const fields = { ...stageKeyField, stageName: named };
  return [
    z.strictObject({ kind: z.literal("insert-before"), ...fields, stage: stageSchema }),
    z.strictObject({ kind: z.literal("insert-after"), ...fields, stage: stageSchema }),
    z.strictObject({ kind: z.literal("replace"), ...fields, stage: stageSchema }),
    z.strictObject({ kind: z.literal("change"), ...fields, fields: stageFieldChangesSchema }),
    z.strictObject({ kind: z.literal("remove"), ...fields }),
  ] as const;
}

/**
 * One Stage change of a Project Pipeline (spec §2.3) as an edit gives it, naming its Stage by key:
 * one of the base Pipeline's Stages, or one an earlier Stage change inserted. One read back keeps
 * its `stageName`, which a save refreshes. Here beside the Stage, so that a Proposal of a Project
 * Pipeline can name it.
 */
export const stageChangeSchema = z.discriminatedUnion(
  "kind",
  stageChangeVariants(stageNameField.stageName.optional()),
);
export type StageChange = z.infer<typeof stageChangeSchema>;

/** A Stage change as a Project Pipeline keeps it, with its Stage's name. */
export const keptStageChangeSchema = z.discriminatedUnion(
  "kind",
  stageChangeVariants(stageNameField.stageName),
);
export type KeptStageChange = z.infer<typeof keptStageChangeSchema>;
