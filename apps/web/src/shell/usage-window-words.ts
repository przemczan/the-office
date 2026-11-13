import { usageWindowWords } from "@the-office/contracts";
import { momentWords } from "./time.ts";

/** A Paused Task the usage window holds (spec 2.1), with when it resumes by itself. */
export function pausedByUsageWindowWords(resumesAt: string | null, now: Date = new Date()): string {
  return resumesAt === null
    ? "Usage window used up"
    : `Usage window used up · resumes ${momentWords(resumesAt, now)}`;
}

/**
 * A Thread's line for a turn the engine refused (spec 2.4): "Claude Code's 5-hour window is used up
 * until 14:00", the reset in local time, with its day when it isn't today.
 */
export function usageWindowUsedUpWords(
  {
    engineName,
    window,
    resetsAt,
  }: { readonly engineName: string; readonly window: string; readonly resetsAt: string },
  now: Date = new Date(),
): string {
  return `${engineName}'s ${usageWindowWords(window)} is used up until ${momentWords(resetsAt, now)}`;
}
