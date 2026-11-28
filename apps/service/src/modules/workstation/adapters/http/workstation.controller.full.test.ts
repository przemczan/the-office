import type { INestApplication } from "@nestjs/common";
import { workstationLoadSchema, type WorkstationLoad } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { Workstation } from "../../../../platform/workstation/workstation.js";
import { WorkstationController } from "./workstation.controller.js";
import {
  LONGEST_MEASURE_MS,
  SHORTEST_MEASURE_MS,
  WorkstationLoadReader,
} from "../os/workstation-load-reader.js";
import { FakeWorkstation } from "../../../../platform/workstation/workstation.fixtures.js";

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
