import type { INestApplication } from "@nestjs/common";
import {
  runEnvironmentOfficeLimitsSchema,
  type RunEnvironmentOfficeLimits,
  type RunEnvironmentOfficeLimitsChange,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { HostCores } from "../../application/host-cores.js";
import { RunEnvironmentOfficeLimits as OfficeLimits } from "../../application/run-environment-office-limits.js";
import { RunEnvironmentSlots } from "../../application/run-environment-slots.js";
import { RunEnvironmentSettingsChanged } from "../../domain/run-environment-events.js";
import { DEFAULT_RUN_ENVIRONMENT_OPTIONS } from "../../domain/run-environment.js";
import { RunEnvironmentSettings } from "../../ports/run-environment-settings.js";
import { PostgresRunEnvironmentSettings } from "../postgres/postgres-run-environment-settings.js";
import { RunEnvironmentWebEvents } from "../websocket/run-environment-web-events.js";
import { RunEnvironmentOfficeActions } from "../office-actions/run-environment-office-actions.js";
import { RunEnvironmentOfficeActionsController } from "./run-environment-office-actions.controller.js";
import { RunEnvironmentOfficeLimitsController } from "./run-environment-office-limits.controller.js";

const HOST_CORES = 10;
const PATH = "/api/settings/run-environments";
const DEFAULTS: RunEnvironmentOfficeLimitsChange = {
  runEnvironmentsAtOnce: 2,
  cpuLimit: "automatic",
  fixedCpus: 2,
  memoryMegabytes: 4096,
  processes: 1024,
};

let app: INestApplication;
let url: string;
let published: RunEnvironmentSettingsChanged[];

beforeEach(async () => {
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [EventsModule, EventStreamModule],
    controllers: [RunEnvironmentOfficeLimitsController, RunEnvironmentOfficeActionsController],
    providers: [
      OfficeLimits,
      RunEnvironmentOfficeActions,
      { provide: OfficeToolRegistry, useValue: new OfficeToolRegistry() },
      RunEnvironmentSlots,
      RunEnvironmentWebEvents,
      { provide: HostCores, useValue: new HostCores(HOST_CORES) },
      { provide: RunEnvironmentSettings, useClass: PostgresRunEnvironmentSettings },
    ],
  }));
  published = [];
  app.get(EventBus).subscribe(RunEnvironmentSettingsChanged, (event) => {
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

async function read(): Promise<RunEnvironmentOfficeLimits> {
  const response = await send("GET");
  expect(response.status).toBe(200);
  return runEnvironmentOfficeLimitsSchema.parse(await response.json());
}

describe("/api/settings/run-environments", () => {
  it("has the spec's defaults until changed, with what Automatic gives on this computer", async () => {
    expect(await read()).toEqual({
      ...DEFAULTS,
      hostCores: HOST_CORES,
      automatic: { checksCpus: 8, otherServicesCpus: 2 },
    });
  });

  it.each<Partial<RunEnvironmentOfficeLimitsChange>>([
    { runEnvironmentsAtOnce: 3 },
    { cpuLimit: "fixed", fixedCpus: 6 },
    { memoryMegabytes: 8192 },
    { processes: 2048 },
  ])("keeps %o with the others as they were", async (changed) => {
    const saved = await send("PUT", { ...DEFAULTS, ...changed });

    expect(saved.status).toBe(200);
    expect(await read()).toMatchObject({ ...DEFAULTS, ...changed });
  });

  it("keeps a fixed number when Automatic is chosen again, and announces each change", async () => {
    await send("PUT", { ...DEFAULTS, cpuLimit: "fixed", fixedCpus: 6 });
    await send("PUT", { ...DEFAULTS, cpuLimit: "automatic", fixedCpus: 6 });

    expect(await read()).toMatchObject({ cpuLimit: "automatic", fixedCpus: 6 });
    const forwarding = app.get(WebEventForwarding);
    expect(published.map((event) => forwarding.toWebEvent(event)?.type)).toEqual([
      "run-environment-settings.changed",
      "run-environment-settings.changed",
    ]);
  });

  it.each<[Partial<RunEnvironmentOfficeLimitsChange>, string]>([
    [{ runEnvironmentsAtOnce: 0 }, "runEnvironmentsAtOnce: Run environments at once is"],
    [{ runEnvironmentsAtOnce: 13 }, "runEnvironmentsAtOnce: Run environments at once is"],
    [{ cpuLimit: "fixed", fixedCpus: 0 }, "fixedCpus: A fixed CPU limit is"],
    [{ cpuLimit: "fixed", fixedCpus: HOST_CORES + 1 }, "fixedCpus: A fixed CPU limit is"],
    [{ cpuLimit: "fixed", fixedCpus: 2.5 }, "fixedCpus: A fixed CPU limit is"],
    [{ memoryMegabytes: 256 }, "memoryMegabytes: Memory per service is"],
    [{ memoryMegabytes: 65_536 + 512 }, "memoryMegabytes: Memory per service is"],
    [{ memoryMegabytes: 1000 }, "memoryMegabytes: Memory per service is"],
    [{ processes: 128 }, "processes: Processes per service is"],
    [{ processes: 65_536 + 256 }, "processes: Processes per service is"],
    [{ processes: 1000 }, "processes: Processes per service is"],
  ])("refuses %o, naming the field", async (changed, problem) => {
    const refused = await send("PUT", { ...DEFAULTS, ...changed });

    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { message: string }).message).toContain(problem);
    expect(published).toEqual([]);
    expect(await read()).toMatchObject(DEFAULTS);
  });
});
