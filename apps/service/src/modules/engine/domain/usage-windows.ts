/** One usage window of the account, shared by every session on it. */
export interface UsageWindow {
  /** How much of the window is used, from 0 to 100. */
  readonly percentUsed: number;
  /** Undefined while the window has not begun, which counts as unused: its use is then 0. */
  readonly resetsAt: Date | undefined;
}

/**
 * Where a reading's numbers came from (spec §5.4, the glossary's Reading source): the account's
 * usage endpoint, or the rate-limit headers of the engine's last model reply. The two round
 * differently, so only readings of one source are compared.
 */
export type ReadingSource = "usage-endpoint" | "rate-limit-headers";

/**
 * The account's quota (spec §5.4): the 5-hour and the 7-day window, each judged on its own, so a
 * window not begun yet leaves the other's reading standing.
 */
export interface UsageWindows {
  readonly fiveHour: UsageWindow;
  readonly sevenDay: UsageWindow;
  /** Undefined when the answer doesn't tell. */
  readonly source: ReadingSource | undefined;
}

export function sameUsageWindows(one: UsageWindows, other: UsageWindows): boolean {
  return sameWindow(one.fiveHour, other.fiveHour) && sameWindow(one.sevenDay, other.sevenDay);
}

function sameWindow(one: UsageWindow, other: UsageWindow): boolean {
  return (
    one.percentUsed === other.percentUsed && one.resetsAt?.getTime() === other.resetsAt?.getTime()
  );
}

/**
 * The usage windows the Claude Code engine names (docs/engine-check.md,
 * engine.usage-window-refusal): its `rateLimitType`s, in the port's words.
 */
export const USAGE_WINDOW_NAMES = [
  "five-hour",
  "seven-day",
  "seven-day-opus",
  "seven-day-sonnet",
  "seven-day-overage-included",
  "overage",
] as const;

export type KnownUsageWindowName = (typeof USAGE_WINDOW_NAMES)[number];

/**
 * A usage window: one the port names, or the engine's own name for one it doesn't, so a refusal for a
 * window a newer engine adds still pauses rather than fails; `unknown` when the engine named none.
 */
export type UsageWindowName = KnownUsageWindowName | (string & {});
