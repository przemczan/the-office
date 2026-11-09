import { Injectable } from "@nestjs/common";
import type { CpuUse, WorkstationLoad } from "@the-office/contracts";
import { coreTimesOf, cpuUseBetween, type CoreTimes } from "./cpu-use.js";
import { Workstation } from "./workstation.js";

/**
 * Below this, a read gives the last CPU use again rather than measure over a shorter time, so
 * several tabs polling at once don't each measure over a few milliseconds.
 */
export const SHORTEST_MEASURE_MS = 500;

/**
 * Reads the workstation's load on demand, with no job of its own: the CPU use is measured since
 * the read before, so the first read has none yet.
 */
@Injectable()
export class WorkstationLoadReader {
  private lastMeasure: { readonly at: number; readonly cores: readonly CoreTimes[] } | undefined;
  private lastUse: CpuUse | null = null;

  constructor(private readonly workstation: Workstation) {}

  read(): WorkstationLoad {
    const cpus = this.workstation.cpus();
    const [first] = cpus;
    const loadAverage = this.workstation.loadAverage();
    const totalBytes = this.workstation.totalMemoryBytes();
    const availableBytes = Math.min(totalBytes, this.workstation.availableMemoryBytes());
    return {
      cpu: {
        model: first?.model.trim() ?? "",
        speedMhz: Math.max(0, Math.round(first?.speed ?? 0)),
        cores: cpus.length || Math.max(1, this.workstation.availableParallelism()),
        use: this.cpuUse(coreTimesOf(cpus)),
        loadAverage: loadAverage
          ? {
              oneMinute: loadAverage[0],
              fiveMinutes: loadAverage[1],
              fifteenMinutes: loadAverage[2],
            }
          : null,
      },
      memory: { totalBytes, availableBytes, usedBytes: totalBytes - availableBytes },
      officeMemoryBytes: this.workstation.officeMemoryBytes(),
      uptimeSeconds: this.workstation.uptimeSeconds(),
    };
  }

  private cpuUse(cores: readonly CoreTimes[]): CpuUse | null {
    const at = this.workstation.monotonicMilliseconds();
    if (this.lastMeasure && at - this.lastMeasure.at < SHORTEST_MEASURE_MS) return this.lastUse;
    this.lastUse = cpuUseBetween(this.lastMeasure?.cores, cores);
    this.lastMeasure = { at, cores };
    return this.lastUse;
  }
}
