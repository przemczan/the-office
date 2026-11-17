import type {
  BasicStats as BasicStatsResponse,
  StatsEngineWindows as StatsEngineWindowsResponse,
  TokenTotals,
} from "@the-office/contracts";
import type { BasicStatsRead } from "../../application/basic-stats.js";
import type { StatsTokens } from "../../domain/basic-stats.js";
import type { StatsEngineWindows, StatsUsageWindow } from "../../ports/engine-windows.js";

export function toBasicStatsResponse(stats: BasicStatsRead): BasicStatsResponse {
  return {
    days: stats.days.map(({ day, tokens }) => ({ day, tokens: toTokenTotals(tokens) })),
    weekStartsAt: stats.weekStartsAt.toISOString(),
    topTasks: stats.topTasks.map(({ taskId, title, projectId, tokens }) => ({
      taskId,
      title,
      projectId,
      tokens,
    })),
    tasksDone: stats.tasksDone,
    stageRetries: stats.stageRetries,
    engines: stats.engines.map(({ engineId, name, windows }) => ({
      engineId,
      name,
      windows: toWindowsResponse(windows),
    })),
  };
}

/**
 * A day's count grows by what each Thread grew since its last count, which shrinks when a turn's
 * own count replaces its running one; a turn running over midnight can leave a kind of a day below
 * zero, shown as 0.
 */
function toTokenTotals(tokens: StatsTokens): TokenTotals {
  return {
    input: Math.max(0, tokens.input),
    output: Math.max(0, tokens.output),
    cacheRead: Math.max(0, tokens.cacheRead),
    cacheCreation: Math.max(0, tokens.cacheCreation),
  };
}

function toWindowsResponse(windows: StatsEngineWindows): StatsEngineWindowsResponse {
  if (windows.state !== "read") return { state: windows.state };
  return {
    state: "read",
    fiveHour: toWindow(windows.fiveHour),
    sevenDay: toWindow(windows.sevenDay),
    readAt: windows.readAt.toISOString(),
  };
}

function toWindow({ percentUsed, resetsAt }: StatsUsageWindow) {
  return { percentUsed, resetsAt: resetsAt?.toISOString() ?? null };
}
