import type { INestApplication } from "@nestjs/common";
import { runEnvironmentCpuLimitSchema, type RunEnvironmentCpuLimit } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { HostCores } from "../../application/host-cores.js";
import { RunEnvironmentCpuLimits } from "../../application/run-environment-cpu-limits.js";
import { RunEnvironmentCpuLimitChanged } from "../../domain/run-environment-events.js";
import { DEFAULT_RUN_ENVIRONMENT_OPTIONS } from "../../domain/run-environment.js";
import { RunEnvironmentSettings } from "../../ports/run-environment-settings.js";
import { PostgresRunEnvironmentSettings } from "../postgres/postgres-run-environment-settings.js";
import { RunEnvironmentWebEvents } from "../websocket/run-environment-web-events.js";
import { RunEnvironmentCpuLimitController } from "./run-environment-cpu-limit.controller.js";

const HOST_CORES = 10;
const PATH = "/api/settings/run-environment-cpu-limit";

let app: INestApplication;
let url: string;
let published: RunEnvironmentCpuLimitChanged[];

beforeEach(async () => {
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [EventsModule, EventStreamModule],
    controllers: [RunEnvironmentCpuLimitController],
    providers: [
      RunEnvironmentCpuLimits,
      RunEnvironmentWebEvents,
      { provide: HostCores, useValue: new HostCores(HOST_CORES) },
      { provide: RunEnvironmentSettings, useClass: PostgresRunEnvironmentSettings },
    ],
  }));
  published = [];
  app.get(EventBus).subscribe(RunEnvironmentCpuLimitChanged, (event) => {
    published.push(event);
  });
});

afterEach(async () => {
  // Every test file shares the database's one row: it goes back to the default.
  await app.get(RunEnvironmentSettings).change(DEFAULT_RUN_ENVIRONMENT_OPTIONS);
  await app.close();
});

function send(method: "GET" | "PUT", body?: unknown): Promise<Response> {
  return fetch(`${url}${PATH}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

async function read(): Promise<RunEnvironmentCpuLimit> {
  const response = await send("GET");
  expect(response.status).toBe(200);
  return runEnvironmentCpuLimitSchema.parse(await response.json());
}

describe("/api/settings/run-environment-cpu-limit", () => {
  it("is Automatic until changed, with what it gives on this computer", async () => {
    expect(await read()).toEqual({
      cpuLimit: "automatic",
      fixedCpus: 2,
      hostCores: HOST_CORES,
      automatic: { checksCpus: 8, otherServicesCpus: 2 },
    });
  });

  it("keeps a fixed number, then Automatic again, and announces each", async () => {
    const fixed = await send("PUT", { cpuLimit: "fixed", fixedCpus: 6 });

    expect(fixed.status).toBe(200);
    expect(await read()).toMatchObject({ cpuLimit: "fixed", fixedCpus: 6 });

    await send("PUT", { cpuLimit: "automatic", fixedCpus: 6 });

    expect(await read()).toMatchObject({ cpuLimit: "automatic", fixedCpus: 6 });
    const forwarding = app.get(WebEventForwarding);
    expect(published.map((event) => forwarding.toWebEvent(event)?.type)).toEqual([
      "run-environment-cpu-limit.changed",
      "run-environment-cpu-limit.changed",
    ]);
  });

  it.each([0, HOST_CORES + 1, 2.5])("refuses a fixed %s CPUs", async (fixedCpus) => {
    const refused = await send("PUT", { cpuLimit: "fixed", fixedCpus });

    expect(refused.status).toBe(400);
    expect(published).toEqual([]);
    expect(await read()).toMatchObject({ cpuLimit: "automatic" });
  });
});
