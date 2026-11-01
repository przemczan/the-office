import type { StageTokens, UsageWindow, UsageWindowReading } from "../../domain/stage-run.js";

/** A usage window as JSON keeps it: its reset as an ISO string, none while it has not begun. */
interface StoredUsageWindow {
  readonly percentUsed: number;
  readonly resetsAt?: string;
}

/** A usage window reading as a `jsonb` column keeps it. */
export interface StoredUsageWindowReading {
  readonly fiveHour: StoredUsageWindow;
  readonly sevenDay: StoredUsageWindow;
  readonly readAt: string;
  readonly officeTokensSoFar: StageTokens;
}

export function storedUsageWindowReading(reading: UsageWindowReading): StoredUsageWindowReading {
  return {
    fiveHour: storedWindow(reading.fiveHour),
    sevenDay: storedWindow(reading.sevenDay),
    readAt: reading.readAt.toISOString(),
    officeTokensSoFar: reading.officeTokensSoFar,
  };
}

export function usageWindowReadingOf(stored: StoredUsageWindowReading): UsageWindowReading {
  return {
    fiveHour: windowOf(stored.fiveHour),
    sevenDay: windowOf(stored.sevenDay),
    readAt: new Date(stored.readAt),
    officeTokensSoFar: stored.officeTokensSoFar,
  };
}

function storedWindow({ percentUsed, resetsAt }: UsageWindow): StoredUsageWindow {
  return resetsAt === undefined
    ? { percentUsed }
    : { percentUsed, resetsAt: resetsAt.toISOString() };
}

function windowOf({ percentUsed, resetsAt }: StoredUsageWindow): UsageWindow {
  return { percentUsed, resetsAt: resetsAt === undefined ? undefined : new Date(resetsAt) };
}
