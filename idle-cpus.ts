import { availableParallelism, cpus, type CpuInfo } from "node:os";

// Long enough to average out a moment's spike, short enough not to slow the run's start.
const SAMPLE_MILLISECONDS = 500;

/**
 * Workers for a test run: half the CPUs it may use, but never more than half of this computer's
 * idle CPUs. Another Task's run beside this one (each run environment may use nearly every core,
 * spec §5.5 "The CPU limit") takes its share, so both together don't oversubscribe the cores into
 * the tests' timeouts. Shared by the vitest and Playwright configs.
 */
export function workersByIdleCpus(): number {
  // availableParallelism, not os.cpus(): it follows a run environment's CPU limit.
  const usable = Math.min(availableParallelism(), idleCpus() ?? Infinity);
  return Math.max(1, Math.floor(usable / 2));
}

/**
 * How many of this computer's cores were idle over a short sample, undefined when the cores
 * aren't listed (some containers). A run environment's os.cpus() reads the whole computer's
 * /proc/stat, so its idle time counts other Tasks' work too.
 */
function idleCpus(): number | undefined {
  const before = cpus();
  if (before.length === 0) return undefined;
  sleep(SAMPLE_MILLISECONDS);
  const after = cpus();
  const total = after.reduce(
    (sum, core, index) => sum + busyAndIdle(core) - busyAndIdle(before[index]),
    0,
  );
  if (total <= 0) return undefined;
  const idle = after.reduce(
    (sum, core, index) => sum + core.times.idle - (before[index]?.times.idle ?? 0),
    0,
  );
  return (idle / total) * after.length;
}

function busyAndIdle(core: CpuInfo | undefined): number {
  if (core === undefined) return 0;
  const { user, nice, sys, idle, irq } = core.times;
  return user + nice + sys + idle + irq;
}

// The configs are read synchronously, so the sample waits in place.
function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
