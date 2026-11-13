import type { KnownUsageWindowName, UsageWindowName } from "./usage-windows.js";

const KNOWN_WINDOW_WORDS: Readonly<Record<KnownUsageWindowName, string>> = {
  "five-hour": "5-hour window",
  "seven-day": "7-day window",
  "seven-day-opus": "Opus weekly window",
  "seven-day-sonnet": "Sonnet weekly window",
  "seven-day-overage-included": "weekly window",
  overage: "extra usage",
};

/**
 * A usage window as the user reads it, such as "5-hour window", for every module's words (the
 * queue's wait, a Thread's line, a Notification); a window the engine names but the port doesn't is
 * worded by its own name. The web words it with the contracts' `usageWindowWords`, which mirrors
 * this: the domain layer doesn't read the contracts.
 */
export function usageWindowWords(window: UsageWindowName): string {
  if (window in KNOWN_WINDOW_WORDS) return KNOWN_WINDOW_WORDS[window as KnownUsageWindowName];
  if (window === "unknown") return "usage window";
  return `${window} window`;
}
