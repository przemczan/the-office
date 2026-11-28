import type { INestApplication } from "@nestjs/common";
import { workstationLoadSchema, type WorkstationLoad } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { Workstation } from "../../../../platform/workstation/workstation.js";
import { WorkstationController } from "./workstation.controller.js";
import { WorkstationLoadReader } from "../os/workstation-load-reader.js";
import { GIB, FakeWorkstation } from "../../../../platform/workstation/workstation.fixtures.js";

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
});
