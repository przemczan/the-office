import { z } from "zod";
import { effortSchema } from "./people.js";

/** "On failure go back to Stage X, at most N times": the Stage's key and its rounds. */
export const onFailureSchema = z.object({
  goBackTo: z.string().min(1),
  rounds: z.int().positive(),
});

/** Where a Publish Stage takes the Task's branch (spec §2.3). */
export const publishTargetSchema = z.enum(["publishing-mode", "branch-only"]);
export type PublishTarget = z.infer<typeof publishTargetSchema>;

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
    /** One of the engine's models; absent keeps the Role's. */
    model: z.string().min(1).optional(),
    /** Absent keeps the Role's. */
    effort: effortSchema.optional(),
    onFailure: onFailureSchema.optional(),
  }),
  z.object({
    kind: z.literal("script"),
    ...stageFields,
    command: z.enum(["build", "lint", "test", "publish"]),
    /**
     * A Publish Stage's alone: by the Project's publishing mode, or pushing the Task's branch only,
     * for a proof of concept. Absent means the publishing mode.
     */
    publishTarget: publishTargetSchema.optional(),
    onFailure: onFailureSchema.optional(),
  }),
  z.object({ kind: z.literal("gate"), ...stageFields }),
]);
export type Stage = z.infer<typeof stageSchema>;
