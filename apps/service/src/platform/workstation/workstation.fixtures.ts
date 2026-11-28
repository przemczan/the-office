import type { CpuInfo } from "node:os";
import { Workstation } from "./workstation.js";

export const GIB = 1024 ** 3;

/** A two-core workstation whose CPU times and clock the test moves. */
export class FakeWorkstation extends Workstation {
  idle = [1000, 1000];
  total = [1000, 1000];
  clock = 0;

  constructor(private readonly hasLoadAverage: boolean) {
    super();
  }

  cpus(): readonly CpuInfo[] {
    return this.total.map((total, index) => {
      const idle = this.idle[index] ?? 0;
      return {
        model: " Test CPU 3000 ",
        speed: 3000,
        times: { user: total - idle, nice: 0, sys: 0, idle, irq: 0 },
      };
    });
  }

  availableParallelism(): number {
    return 2;
  }

  totalMemoryBytes(): number {
    return 16 * GIB;
  }

  availableMemoryBytes(): number {
    return 4 * GIB;
  }

  loadAverage(): readonly [number, number, number] | undefined {
    return this.hasLoadAverage ? [1.5, 1.25, 0.75] : undefined;
  }

  uptimeSeconds(): number {
    return 3600;
  }

  officeMemoryBytes(): number {
    return 200 * 1024 ** 2;
  }

  monotonicMilliseconds(): number {
    return this.clock;
  }

  /** Both cores half busy over the next second. */
  passHalfBusySecond(): void {
    this.clock += 1000;
    this.total = this.total.map((total) => total + 1000);
    this.idle = this.idle.map((idle) => idle + 500);
  }
}
