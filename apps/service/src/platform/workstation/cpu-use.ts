import type { CpuInfo } from "node:os";
import type { CpuUse } from "@the-office/contracts";

/** One logical core's time since the system started, in ms: in total and idle. */
export interface CoreTimes {
  readonly total: number;
  readonly idle: number;
}

/** The cores' times as `os.cpus()` gives them. */
export function coreTimesOf(cpus: readonly CpuInfo[]): readonly CoreTimes[] {
  return cpus.map(({ times }) => ({
    total: times.user + times.nice + times.sys + times.idle + times.irq,
    idle: times.idle,
  }));
}

/**
 * How busy the CPU was between two reads of its cores' times, overall and per core; null when
 * there is nothing to measure over: no earlier read, no time passed, or the cores changed between.
 */
export function cpuUseBetween(
  earlier: readonly CoreTimes[] | undefined,
  later: readonly CoreTimes[],
): CpuUse | null {
  if (!earlier || earlier.length !== later.length || later.length === 0) return null;
  const elapsed = later.map((core, index) => difference(earlier[index], core));
  const allCores = {
    total: sum(elapsed.map((core) => core.total)),
    idle: sum(elapsed.map((core) => core.idle)),
  };
  if (allCores.total <= 0) return null;
  return {
    percent: busyPercent(allCores),
    perCore: elapsed.map((core) => (core.total > 0 ? busyPercent(core) : 0)),
  };
}

function difference(earlier: CoreTimes | undefined, later: CoreTimes): CoreTimes {
  return {
    total: Math.max(0, later.total - (earlier?.total ?? later.total)),
    idle: Math.max(0, later.idle - (earlier?.idle ?? later.idle)),
  };
}

function busyPercent({ total, idle }: CoreTimes): number {
  return Math.min(100, Math.max(0, ((total - idle) / total) * 100));
}

function sum(values: readonly number[]): number {
  return values.reduce((sumSoFar, value) => sumSoFar + value, 0);
}
