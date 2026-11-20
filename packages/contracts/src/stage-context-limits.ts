import { z } from "zod";

/**
 * An Agent Stage session's context limits, in tokens, as Settings › Office limits and the Stage form
 * step them (spec §2.5): the soft limit at least `softMin`, the hard one `gap` or more above it.
 */
export const STAGE_CONTEXT_LIMIT_TOKENS = {
  softMin: 50_000,
  gap: 20_000,
  max: 1_000_000,
  step: 5_000,
} as const;

/** The Office defaults until a user changes them. */
export const DEFAULT_STAGE_CONTEXT_LIMITS = { soft: 100_000, hard: 180_000 } as const;

const limitTokens = z
  .int()
  .min(STAGE_CONTEXT_LIMIT_TOKENS.softMin)
  .max(STAGE_CONTEXT_LIMIT_TOKENS.max)
  .multipleOf(STAGE_CONTEXT_LIMIT_TOKENS.step);

/**
 * Past `soft` The Office tells the Agent to finish the part it is on and hand over; past `hard` it
 * stops the turn and asks for the Handover note at once. Then the Stage goes on in a fresh session.
 */
export const stageContextLimitsSchema = z
  .object({ soft: limitTokens, hard: limitTokens })
  .refine((limits) => limits.hard >= limits.soft + STAGE_CONTEXT_LIMIT_TOKENS.gap, {
    error: `The hard limit is at least ${STAGE_CONTEXT_LIMIT_TOKENS.gap / 1000}k above the soft limit.`,
    path: ["hard"],
  });
export type StageContextLimits = z.infer<typeof stageContextLimitsSchema>;

/**
 * An Agent Stage's own context limits: its own soft and hard limits (`set`), or No limit (`none`),
 * which never restarts on context size. A Stage without it takes the Office defaults.
 */
export const stageContextLimitsOverrideSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set"), limits: stageContextLimitsSchema }),
  z.object({ kind: z.literal("none") }),
]);
export type StageContextLimitsOverride = z.infer<typeof stageContextLimitsOverrideSchema>;
