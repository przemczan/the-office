import {
  availableParallelism,
  cpus,
  freemem,
  loadavg,
  totalmem,
  uptime,
  type CpuInfo,
} from "node:os";
import { currentOperatingSystem } from "../os/current-operating-system.js";

/**
 * The computer The Office runs on, as Node reads it: the one place the workstation's figures come
 * from, so a test gives its own and no result depends on the machine.
 */
export abstract class Workstation {
  abstract cpus(): readonly CpuInfo[];
  /** Logical cores the service may use, for when `cpus()` lists none (some containers). */
  abstract availableParallelism(): number;
  abstract totalMemoryBytes(): number;
  /** What can be given to programs without swapping (Linux's MemAvailable). */
  abstract availableMemoryBytes(): number;
  /** Over 1, 5 and 15 minutes; undefined where the operating system has none. */
  abstract loadAverage(): readonly [number, number, number] | undefined;
  abstract uptimeSeconds(): number;
  abstract officeMemoryBytes(): number;
  /** A monotonic clock in ms, for how long since the last read, whatever the Schedule's time. */
  abstract monotonicMilliseconds(): number;
}

export class NodeWorkstation extends Workstation {
  private readonly hasLoadAverage = currentOperatingSystem().hasLoadAverage;

  cpus(): readonly CpuInfo[] {
    return cpus();
  }

  availableParallelism(): number {
    return availableParallelism();
  }

  totalMemoryBytes(): number {
    return totalmem();
  }

  availableMemoryBytes(): number {
    return freemem();
  }

  loadAverage(): readonly [number, number, number] | undefined {
    if (!this.hasLoadAverage) return undefined;
    const [oneMinute = 0, fiveMinutes = 0, fifteenMinutes = 0] = loadavg();
    return [oneMinute, fiveMinutes, fifteenMinutes];
  }

  uptimeSeconds(): number {
    return uptime();
  }

  officeMemoryBytes(): number {
    return process.memoryUsage.rss();
  }

  monotonicMilliseconds(): number {
    return performance.now();
  }
}
