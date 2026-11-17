import type { UseQueryResult } from "@tanstack/react-query";
import type { StageProblem } from "@the-office/contracts";

/** The part of a Stages check query that says whether it has answered the Stages on show. */
export type StagesCheckState = Pick<UseQueryResult, "isPending" | "isPlaceholderData">;

/**
 * Whether the check hasn't yet answered the Stages on show, so Save waits for it. A refetch of the
 * same Stages, which any event about the Task or the library makes, doesn't count: Save would go
 * disabled for a moment with nothing changed, and a click then would be lost.
 */
export function checkAwaited(check: StagesCheckState): boolean {
  return check.isPending || check.isPlaceholderData;
}

/** A check's answer by level: problems, which hold Save, and warnings, which it saves anyway. */
export interface StageProblemsByLevel {
  readonly problems: readonly StageProblem[];
  readonly warnings: readonly StageProblem[];
}

export function byLevel(found: readonly StageProblem[] = []): StageProblemsByLevel {
  return {
    problems: found.filter(({ level }) => level === "problem"),
    warnings: found.filter(({ level }) => level === "warning"),
  };
}
