/** A Stage session's soft and hard context limits, in tokens (spec §2.5). */
export interface ContextLimits {
  readonly soft: number;
  readonly hard: number;
}

/**
 * An Agent Stage's own context limits (spec §2.5): its own soft and hard limits (`set`), or No limit
 * (`none`), which never restarts its session on context size. A Stage without it takes the Office
 * defaults.
 */
export type StageContextLimitsOverride =
  { readonly kind: "set"; readonly limits: ContextLimits } | { readonly kind: "none" };

/**
 * The limits a Stage's session runs under: its own, none for No limit, else the Office defaults.
 */
export function effectiveStageContextLimits(
  override: StageContextLimitsOverride | undefined,
  officeDefaults: ContextLimits,
): ContextLimits | undefined {
  if (override === undefined) return officeDefaults;
  return override.kind === "set" ? override.limits : undefined;
}
