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
 * away. MCP tools are keyed `server/tool`, as on the card.
 */
export const stagePermissionsSchema = z.object({
  edit: z.literal(false).optional(),
  run: runPermissionSchema.optional(),
  web: z.literal(false).optional(),
  mcpTools: z.record(z.string().regex(/^[a-z0-9-]+\/.+$/), hardSwitchValueSchema).optional(),
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
