/** One usage window of the account, shared by every session on it. */
export interface UsageWindow {
  /** How much of the window is used, from 0 to 100. */
  readonly percentUsed: number;
  /** Undefined while the window has not begun. */
  readonly resetsAt: Date | undefined;
}

/** The account's quota (spec §5.4): the 5-hour and the 7-day window. */
export interface UsageWindows {
  readonly fiveHour: UsageWindow;
  readonly sevenDay: UsageWindow;
}

/** Windows that have both begun, so each says when it resets. */
export interface BegunUsageWindows {
  readonly fiveHour: UsageWindow & { readonly resetsAt: Date };
  readonly sevenDay: UsageWindow & { readonly resetsAt: Date };
}

/** Only windows that have both begun show what a run used of them. */
export function everyWindowBegun<Windows extends UsageWindows>(
  windows: Windows,
): windows is Windows & BegunUsageWindows {
  return windows.fiveHour.resetsAt !== undefined && windows.sevenDay.resetsAt !== undefined;
}

export function sameUsageWindows(one: UsageWindows, other: UsageWindows): boolean {
  return sameWindow(one.fiveHour, other.fiveHour) && sameWindow(one.sevenDay, other.sevenDay);
}

function sameWindow(one: UsageWindow, other: UsageWindow): boolean {
  return (
    one.percentUsed === other.percentUsed && one.resetsAt?.getTime() === other.resetsAt?.getTime()
  );
}
