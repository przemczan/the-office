import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  DEFAULT_TEST_INSTANCE_SETTINGS,
  initiativeTestInstancesSchema,
  projectTestInstancesSchema,
  testInstanceLogSchema,
  testInstanceSchema,
  testInstanceSettingsSchema,
  type TestInstanceSettings,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { EventBus } from "../../platform/events/event-bus.js";
import { EventsModule } from "../../platform/events/events.module.js";
import { SIGNED_IN_FOR_TESTS } from "../../platform/http/signed-in-requests.fixtures.js";
import { EventStreamModule } from "../../platform/websocket/event-stream.module.js";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../run-environments/index.fixtures.js";
import { TestInstanceSettingsController } from "./adapters/http/test-instance-settings.controller.js";
import { TestInstancesController } from "./adapters/http/test-instances.controller.js";
import { PostgresTestInstanceSettings } from "./adapters/postgres/postgres-test-instance-settings.js";
import { TestInstanceWebEvents } from "./adapters/websocket/test-instance-web-events.js";
import { OfficePort, TestInstanceLimits } from "./application/test-instance-limits.js";
import { TestInstances } from "./application/test-instances.js";
import { TestInstanceSettingsChanged } from "./domain/test-instance-events.js";
import { TestInstanceSettingsStore } from "./ports/test-instance-settings-store.js";
import {
  TESTBED_OFFICE_PORT,
  testInstancesTestbed,
  type TestInstancesTestbed,
} from "./test-instances.fixtures.js";

let app: INestApplication;
let url: string;
let runtime: ScriptedContainerRuntime;
let environments: RunEnvironmentsTestbed;
let testbed: TestInstancesTestbed;
let published: TestInstanceSettingsChanged[];

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  runtime.keepExecsRunning();
  environments = await runEnvironmentsTestbed(runtime, undefined, undefined, {
    timeoutMs: 100,
    intervalMs: 5,
    answers: (port) => runtime.answers(port),
  });
  testbed = testInstancesTestbed(
    environments.hostedServices,
    join(environments.folder, "office-data"),
  );
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [EventsModule, EventStreamModule],
    controllers: [TestInstancesController, TestInstanceSettingsController],
    providers: [
      { provide: TestInstances, useValue: testbed.instances },
      { provide: OfficePort, useValue: new OfficePort(TESTBED_OFFICE_PORT) },
      { provide: TestInstanceSettingsStore, useClass: PostgresTestInstanceSettings },
      TestInstanceLimits,
      TestInstanceWebEvents,
    ],
  }));
  published = [];
  app.get(EventBus).subscribe(TestInstanceSettingsChanged, (event) => {
    published.push(event);
  });
});

afterEach(async () => {
  for (const instance of await testbed.repository.active()) {
    await testbed.instances.stop(instance.id);
  }
  await testbed.instances.settled();
  // Every test file shares the database's one row: it goes back to the defaults.
  await app.get(TestInstanceSettingsStore).change(DEFAULT_TEST_INSTANCE_SETTINGS);
  await app.close();
  await rm(environments.folder, { recursive: true, force: true });
});

function send(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

describe("/api/initiatives/:id/test-instances", () => {
  it("launches a Hosted target, lists it under its Project and stops it", async () => {
    const launched = await send("POST", `/initiatives/${testbed.initiativeId}/test-instances`, {
      projectId: "shop",
      targetKey: "web",
    });
    expect(launched.status).toBe(201);
    const instance = testInstanceSchema.parse(await launched.json());
    expect(instance).toMatchObject({
      state: "building",
      port: 4400,
      launchedBy: {
        kind: "user",
        user: { userId: SIGNED_IN_FOR_TESTS.userId, name: SIGNED_IN_FOR_TESTS.name },
      },
    });
    await testbed.instances.settled();

    const listed = await send("GET", `/initiatives/${testbed.initiativeId}/test-instances`);
    expect(listed.status).toBe(200);
    const { projects } = initiativeTestInstancesSchema.parse(await listed.json());
    expect(projects).toEqual([
      {
        projectId: "shop",
        runEnvironmentOn: true,
        branchCommit: "c0ffee0000000000000000000000000000000001",
        targets: [
          expect.objectContaining({
            key: "web",
            kind: "hosted",
            instances: [
              expect.objectContaining({
                id: instance.id,
                state: "running",
                files: [],
                filesRemoved: false,
                runAs: null,
              }),
            ],
          }),
          expect.objectContaining({ key: "android", kind: "build-to-install", instances: [] }),
        ],
      },
    ]);

    const log = await send("GET", `/test-instances/${instance.id}/log?from=0`);
    expect(testInstanceLogSchema.parse(await log.json()).state).toBe("running");

    const stopped = await send("POST", `/test-instances/${instance.id}/stop`);
    expect(stopped.status).toBe(200);
    expect(testInstanceSchema.parse(await stopped.json())).toMatchObject({
      state: "stopped",
      port: null,
    });
  });

  it("answers a refused launch 409 with its reasons, and no such Initiative or instance 404", async () => {
    testbed.project.runEnvironmentOn = false;

    const refused = await send("POST", `/initiatives/${testbed.initiativeId}/test-instances`, {
      projectId: "shop",
      targetKey: "web",
    });

    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      statusCode: 409,
      message: "Turn the Project's Run environment On to launch a Hosted test instance.",
      reasons: ["Turn the Project's Run environment On to launch a Hosted test instance."],
    });
    expect((await send("GET", `/initiatives/${randomUUID()}/test-instances`)).status).toBe(404);
    expect((await send("POST", `/test-instances/${randomUUID()}/stop`)).status).toBe(404);
  });
});

describe("/api/projects/:id/test-instances", () => {
  it("launches on a branch no Initiative has and lists it under its branch", async () => {
    const launched = await send("POST", "/projects/shop/test-instances", {
      branch: "feature/search",
      targetKey: "web",
    });
    expect(launched.status).toBe(201);
    const instance = testInstanceSchema.parse(await launched.json());
    expect(instance).toMatchObject({
      branch: "feature/search",
      initiativeId: null,
      state: "building",
    });
    await testbed.instances.settled();

    const listed = await send("GET", "/projects/shop/test-instances");
    expect(listed.status).toBe(200);
    const body = projectTestInstancesSchema.parse(await listed.json());
    expect(body.branches).toEqual([
      expect.objectContaining({
        name: "feature/search",
        instances: [expect.objectContaining({ id: instance.id, state: "running" })],
      }),
    ]);
    expect(body.initiatives).toEqual([]);
    expect(body.targets.map(({ key }) => key)).toEqual(["web", "android"]);
  });

  it.each(["-bad", "a..b"])("refuses the branch name %s with 400", async (branch) => {
    const refused = await send("POST", "/projects/shop/test-instances", {
      branch,
      targetKey: "web",
    });

    expect(refused.status).toBe(400);
    expect(testbed.repository.rows.size).toBe(0);
  });
});

async function read(): Promise<TestInstanceSettings> {
  const response = await send("GET", "/settings/test-instances");
  expect(response.status).toBe(200);
  return testInstanceSettingsSchema.parse(await response.json());
}

describe("/api/settings/test-instances", () => {
  it("has the spec's defaults until changed, then keeps the change and tells the web", async () => {
    expect(await read()).toEqual(DEFAULT_TEST_INSTANCE_SETTINGS);
    const changed = {
      testInstancesAtOnce: 3,
      idleMinutes: 45,
      firstProxyPort: 5400,
      lastProxyPort: 5409,
    };

    const response = await send("PUT", "/settings/test-instances", changed);

    expect(response.status).toBe(200);
    expect(await read()).toEqual(changed);
    expect(published).toHaveLength(1);
  });

  it("refuses a value out of its bounds, or a range holding The Office's port, 400 naming the field", async () => {
    const outOfBounds = await send("PUT", "/settings/test-instances", {
      ...DEFAULT_TEST_INSTANCE_SETTINGS,
      testInstancesAtOnce: 7,
    });
    expect(outOfBounds.status).toBe(400);
    expect(((await outOfBounds.json()) as { message: string }).message).toContain(
      "testInstancesAtOnce: Test instances at once is a whole number from 1 to 6.",
    );

    const holdingTheOffice = await send("PUT", "/settings/test-instances", {
      ...DEFAULT_TEST_INSTANCE_SETTINGS,
      firstProxyPort: 4390,
      lastProxyPort: 4399,
    });
    expect(holdingTheOffice.status).toBe(400);
    expect(((await holdingTheOffice.json()) as { message: string }).message).toBe(
      `firstProxyPort: The Proxy ports can't hold The Office's own port, ${TESTBED_OFFICE_PORT}.`,
    );
    expect(await read()).toEqual(DEFAULT_TEST_INSTANCE_SETTINGS);
    expect(published).toEqual([]);
  });
});
