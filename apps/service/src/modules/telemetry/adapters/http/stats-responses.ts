import type {
  BasicStats as BasicStatsResponse,
  FullStats as FullStatsResponse,
  StatsEngineWindows as StatsEngineWindowsResponse,
  StatsRanOn,
  SystemHealth as SystemHealthResponse,
  SystemHealthRead as SystemHealthReadResponse,
  TokenTotals,
} from "@the-office/contracts";
import type { BasicStatsRead } from "../../application/basic-stats.js";
import type { FullStatsRead } from "../../application/full-stats.js";
import type { HealthReadingsRead, SystemHealthRead } from "../../application/system-health.js";
import type { StatsTokens } from "../../domain/basic-stats.js";
import type { RanOn, Spend, WindowPoint } from "../../domain/full-stats.js";
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

export function toFullStatsResponse(stats: FullStatsRead): FullStatsResponse {
  if (stats.state !== "full") return stats;
  return {
    state: "full",
    address: stats.address,
    range: stats.range,
    split: stats.split,
    from: stats.from.toISOString(),
    to: stats.to.toISOString(),
    usage: stats.usage.map(({ at, groups }) => ({
      at: at.toISOString(),
      groups: groups.map(({ name, ...spend }) => ({ name, ...toSpend(spend) })),
    })),
    costliestTasks: stats.costliestTasks.map((task) => ({
      taskId: task.taskId,
      title: task.title,
      projectId: task.projectId,
      ...toSpend(task),
      stages: task.stages.map(({ stageName, tries }) => ({
        stageName,
        tries: tries.map((one) => ({
          try: one.try,
          ...toSpend(one),
          ranOn: toRanOnResponse(one.ranOn),
        })),
      })),
      outsideStages: toSpend(task.outsideStages),
    })),
    costliestInitiatives: stats.costliestInitiatives.map((initiative) => ({
      initiativeId: initiative.initiativeId,
      title: initiative.title,
      projectIds: [...initiative.projectIds],
      ...toSpend(initiative),
      tasks: initiative.tasks.map(({ taskId, title, ranOn, ...spend }) => ({
        taskId,
        title,
        ...toSpend(spend),
        ranOn: toRanOnResponse(ranOn),
      })),
      ownThreads: toSpend(initiative.ownThreads),
    })),
    windows: stats.windows.map(({ engineId, name, fiveHour, sevenDay }) => ({
      engineId,
      name,
      fiveHour: fiveHour.map(toWindowPoint),
      sevenDay: sevenDay.map(toWindowPoint),
    })),
    running: stats.running.map(({ startedAt, endedAt, ...run }) => ({
      engineId: run.engineId,
      taskId: run.taskId,
      title: run.title,
      projectId: run.projectId,
      stageName: run.stageName,
      startedAt: startedAt.toISOString(),
      ...(endedAt ? { endedAt: endedAt.toISOString() } : {}),
    })),
  };
}

/** A sum of floating figures can come out a hair below zero, which the contract refuses. */
function toSpend({ tokens, estimatedCostUsd }: Spend) {
  return { tokens: Math.max(0, tokens), estimatedCostUsd: Math.max(0, estimatedCostUsd) };
}

function toRanOnResponse(ranOn: readonly RanOn[]): StatsRanOn[] {
  return ranOn.map(({ engineName, model, standInForEngineName, ...spend }) => ({
    engineName,
    model,
    ...(standInForEngineName === undefined ? {} : { standInForEngineName }),
    ...toSpend(spend),
  }));
}

function toWindowPoint({ at, percentUsed }: WindowPoint) {
  return { at: at.toISOString(), percentUsed };
}

export function toSystemHealthResponse(health: SystemHealthRead): SystemHealthResponse {
  const { readings } = health;
  return {
    range: health.range,
    loadNow: { ...health.loadNow },
    readings: readings.state === "read" ? toHealthReadings(readings) : readings,
  };
}

function toHealthReadings(read: HealthReadingsRead): SystemHealthReadResponse {
  return {
    state: "read",
    from: read.from.toISOString(),
    to: read.to.toISOString(),
    stepSeconds: read.stepSeconds,
    ...(read.readingsSince ? { readingsSince: read.readingsSince.toISOString() } : {}),
    points: read.points.map(({ at, ...figures }) => ({ at: at.toISOString(), ...figures })),
    requests: read.requests,
    requestP95Ms: read.requestP95Ms,
    queries: read.queries,
    queryP95Ms: read.queryP95Ms,
    slowestRoutes: read.slowestRoutes.map(({ route, count, p95Ms, maxMs, totalMs }) => ({
      route: route ? { method: route.method, template: route.template } : null,
      count,
      p95Ms,
      maxMs,
      totalMs,
    })),
    slowestQueries: read.slowestQueries.map(
      ({ operation, table, shape, calledFrom, count, p95Ms, maxMs, totalMs }) => ({
        operation,
        table,
        ...(shape === undefined ? {} : { shape }),
        ...(calledFrom === undefined ? {} : { calledFrom: [...calledFrom] }),
        count,
        p95Ms,
        maxMs,
        totalMs,
      }),
    ),
    unansweredBlocks: [...read.unansweredBlocks],
    ...(read.address === undefined ? {} : { address: read.address }),
  };
}
