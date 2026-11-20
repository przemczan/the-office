/** An Agent Stage session's soft and hard context limits, in tokens (spec §2.5). */
export interface StageContextLimits {
  readonly soft: number;
  readonly hard: number;
}

/** Which limit a Stage session's context passed. */
export type StageContextLimit = "soft" | "hard";

/** The Office defaults until Settings › Office limits saves its own. */
export const DEFAULT_STAGE_CONTEXT_LIMITS: StageContextLimits = { soft: 100_000, hard: 180_000 };

/**
 * The limits a Stage session works under: the hard limit never past the share of the model's
 * window where a chat hands over, which leaves room for the turn that writes the Handover note, and
 * the soft limit never past the hard one. Unchanged while the window is unknown.
 */
export function stageLimitsWithin(
  limits: StageContextLimits,
  window: number | undefined,
  handOverAtShare: number,
): StageContextLimits {
  if (window === undefined) return limits;
  const hard = Math.min(limits.hard, Math.floor(window * handOverAtShare));
  return { soft: Math.min(limits.soft, hard), hard };
}

/** The limit a context reading of `tokens` reaches, the hard one first; undefined below both. */
export function limitReached(
  { soft, hard }: StageContextLimits,
  tokens: number,
): StageContextLimit | undefined {
  if (tokens >= hard) return "hard";
  if (tokens >= soft) return "soft";
  return undefined;
}
