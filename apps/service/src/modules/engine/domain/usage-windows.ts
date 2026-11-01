/** One usage window of the account, shared by every session on it. */
export interface UsageWindow {
  /** How much of the window is used, from 0 to 100. */
  readonly percentUsed: number;
  /** Undefined while the window has not begun, which counts as unused: its use is then 0. */
  readonly resetsAt: Date | undefined;
}

/**
 * The account's quota (spec §5.4): the 5-hour and the 7-day window, each judged on its own, so a
 * window not begun yet leaves the other's reading standing.
 */
export interface UsageWindows {
  readonly fiveHour: UsageWindow;
  readonly sevenDay: UsageWindow;
}

export function sameUsageWindows(one: UsageWindows, other: UsageWindows): boolean {
  return sameWindow(one.fiveHour, other.fiveHour) && sameWindow(one.sevenDay, other.sevenDay);
}

function sameWindow(one: UsageWindow, other: UsageWindow): boolean {
  return (
    one.percentUsed === other.percentUsed && one.resetsAt?.getTime() === other.resetsAt?.getTime()
  );
}
