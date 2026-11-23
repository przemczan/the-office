import type { ReadingSource, UsageWindow, UsageWindows } from "../../domain/usage-windows.js";
import type { CodexRateLimitSnapshot, CodexRateLimitWindow } from "./codex-protocol.js";

/*
 * A ChatGPT account's usage windows as Codex reports them (spec §5.4 Defaults, the Codex engine):
 * `primary` and `secondary` of a rate-limit snapshot, each told apart by its length, not its slot.
 */

export const FIVE_HOURS_MINUTES = 5 * 60;
export const SEVEN_DAYS_MINUTES = 7 * 24 * 60;

/** A window the snapshot doesn't hold, which counts as unused. */
const MISSING: UsageWindow = { percentUsed: 0, resetsAt: undefined, missing: true };

/** The snapshot's windows of a length the port doesn't name, by their lengths in minutes. */
export function unknownWindowLengths(snapshot: CodexRateLimitSnapshot): readonly (number | null)[] {
  return codexWindowsOf(snapshot)
    .filter((window) => portWindowOf(window) === undefined)
    .map((window) => window.windowDurationMins ?? null);
}

/**
 * The snapshot's 5-hour and 7-day windows in the port's terms, a missing one marked so and unused;
 * undefined when it holds a window of another length, which is never read as unused.
 */
export function codexUsageWindows(
  snapshot: CodexRateLimitSnapshot,
  source: ReadingSource,
): UsageWindows | undefined {
  if (unknownWindowLengths(snapshot).length > 0) return undefined;
  const windows = codexWindowsOf(snapshot);
  const read = (name: PortWindow): UsageWindow => {
    const window = windows.find((each) => portWindowOf(each) === name);
    return window === undefined ? MISSING : usageWindow(window);
  };
  return { fiveHour: read("fiveHour"), sevenDay: read("sevenDay"), source };
}

type PortWindow = "fiveHour" | "sevenDay";

function portWindowOf(window: CodexRateLimitWindow): PortWindow | undefined {
  if (window.windowDurationMins === FIVE_HOURS_MINUTES) return "fiveHour";
  if (window.windowDurationMins === SEVEN_DAYS_MINUTES) return "sevenDay";
  return undefined;
}

/** The snapshot's windows, whichever slot each is in. */
export function codexWindowsOf(snapshot: CodexRateLimitSnapshot): readonly CodexRateLimitWindow[] {
  return [snapshot.primary, snapshot.secondary].filter(
    (window): window is CodexRateLimitWindow => window !== undefined && window !== null,
  );
}

function usageWindow(window: CodexRateLimitWindow): UsageWindow {
  return {
    percentUsed: Math.min(100, Math.max(0, window.usedPercent)),
    resetsAt: codexResetOf(window),
  };
}

/** When `window` resets: Codex gives it in epoch seconds. */
export function codexResetOf(window: CodexRateLimitWindow | undefined): Date | undefined {
  const resetsAt = window?.resetsAt;
  return resetsAt === undefined || resetsAt === null ? undefined : new Date(resetsAt * 1000);
}

/** Whether nothing is left of `window`. */
export function usedUp(window: CodexRateLimitWindow): boolean {
  return window.usedPercent >= 100;
}
