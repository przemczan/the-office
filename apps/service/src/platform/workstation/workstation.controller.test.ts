import type { INestApplication } from "@nestjs/common";
import type { CpuInfo } from "node:os";
import { workstationLoadSchema, type WorkstationLoad } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { Workstation } from "./workstation.js";
import { WorkstationController } from "./workstation.controller.js";
import {
  LONGEST_MEASURE_MS,
  SHORTEST_MEASURE_MS,
  WorkstationLoadReader,
} from "./workstation-load-reader.js";

const GIB = 1024 ** 3;

/** A two-core workstation whose CPU times and clock the test moves. */
class FakeWorkstation extends Workstation {
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

let app: INestApplication | undefined;

async function serveWorkstation(workstation: Workstation): Promise<() => Promise<WorkstationLoad>> {
  const started = await startTestApplication({
    controllers: [WorkstationController],
    providers: [{ provide: Workstation, useValue: workstation }, WorkstationLoadReader],
  });
  app = started.app;
  return async () => {
    const response = await fetch(`${started.url}/api/workstation/load`);
    expect(response.status).toBe(200);
    return workstationLoadSchema.parse(await response.json());
  };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /api/workstation/load", () => {
  it("reports the workstation, measuring the CPU from the second read on", async () => {
    const workstation = new FakeWorkstation(true);
    const readLoad = await serveWorkstation(workstation);

    const first = await readLoad();
    workstation.passHalfBusySecond();
    const second = await readLoad();

    expect(first).toEqual({
      cpu: {
        model: "Test CPU 3000",
        speedMhz: 3000,
        cores: 2,
        use: null,
        loadAverage: { oneMinute: 1.5, fiveMinutes: 1.25, fifteenMinutes: 0.75 },
      },
      memory: { totalBytes: 16 * GIB, availableBytes: 4 * GIB, usedBytes: 12 * GIB },
      officeMemoryBytes: 200 * 1024 ** 2,
      uptimeSeconds: 3600,
    });
    expect(second.cpu.use).toEqual({ percent: 50, perCore: [50, 50] });
  });

  it("gives the last measure again to a read soon after it", async () => {
    const workstation = new FakeWorkstation(true);
    const readLoad = await serveWorkstation(workstation);
    await readLoad();
    workstation.passHalfBusySecond();
    await readLoad();

    workstation.clock += SHORTEST_MEASURE_MS - 1;
    workstation.total = workstation.total.map((total) => total + 100);
    const soonAfter = await readLoad();

    expect(soonAfter.cpu.use).toEqual({ percent: 50, perCore: [50, 50] });
  });

  it("measures afresh when the read before is too old to give the use now", async () => {
    const workstation = new FakeWorkstation(true);
    const readLoad = await serveWorkstation(workstation);
    await readLoad();

    workstation.clock += LONGEST_MEASURE_MS + 1;
    workstation.total = workstation.total.map((total) => total + 1000);
    const longAfter = await readLoad();
    workstation.passHalfBusySecond();
    const next = await readLoad();

    expect(longAfter.cpu.use).toBeNull();
    expect(next.cpu.use).toEqual({ percent: 50, perCore: [50, 50] });
  });

  it("leaves the load average out where the operating system has none", async () => {
    const readLoad = await serveWorkstation(new FakeWorkstation(false));

    expect((await readLoad()).cpu.loadAverage).toBeNull();
  });
});
