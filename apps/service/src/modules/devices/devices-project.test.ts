import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { Logger, type INestApplication } from "@nestjs/common";
import {
  connectedDeviceSchema,
  projectDeviceListSchema,
  projectDevicePairPath,
  projectDevicePath,
  projectDeviceRefusalSchema,
  projectDeviceSchema,
  projectDevicesPath,
  projectDeviceWebEventSchema,
  taskLendDevicePath,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { EventsModule } from "../../platform/events/events.module.js";
import { WebEventForwarding } from "../../platform/websocket/web-event-forwarding.js";
import { EventStreamModule } from "../../platform/websocket/event-stream.module.js";
import {
  devicesForTests,
  DevicesForTests,
} from "../../platform/websocket/event-stream.fixtures.js";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../run-environments/index.fixtures.js";
import { ProjectDevicesController } from "./adapters/http/project-devices.controller.js";
import { ProjectDeviceWebEvents } from "./adapters/websocket/project-device-web-events.js";
import { ProjectDevices } from "./application/project-devices.js";
import { devicesTestbed, PROJECT_ID, type DevicesTestbed } from "./devices.fixtures.js";
import { ProjectDeviceChanged } from "./domain/project-device-events.js";

const TASK_ID = "00000000-0000-4000-8000-00000000d101";
const CODE = "482913";
const PHONE = {
  kind: "android-wireless",
  address: "192.168.1.20",
  port: 41_234,
  pairingPort: 37_000,
  pairingCode: CODE,
} as const;
const BOARD = { kind: "serial-usb", name: "Arduino Uno", deviceKey: "usb:2341:0043:1" } as const;
const LOG_LEVELS = ["log", "warn", "error", "debug", "verbose", "fatal"] as const;

let app: INestApplication;
let url: string;
let cookie: string;
let testbed: DevicesTestbed<RunEnvironmentsTestbed>;
let logged: string[];
let bodies: string[];

beforeEach(async () => {
  logged = [];
  bodies = [];
  const capture = (...parts: unknown[]): void => {
    logged.push(parts.map((part) => (part instanceof Error ? part.stack : String(part))).join(" "));
  };
  for (const level of LOG_LEVELS) {
    vi.spyOn(Logger.prototype, level).mockImplementation(capture);
    vi.spyOn(Logger, level).mockImplementation(capture);
  }
  const runtime = new ScriptedContainerRuntime();
  testbed = await devicesTestbed(runtime, await runEnvironmentsTestbed(runtime));
  await testbed.addTask(TASK_ID, "Install on the phone");
  ({ app, url } = await startTestApplication({
    imports: [EventsModule, EventStreamModule, devicesForTests()],
    requestAccess: "guarded",
    controllers: [ProjectDevicesController],
    providers: [
      { provide: ProjectDevices, useValue: testbed.projectDevices },
      ProjectDeviceWebEvents,
    ],
  }));
  cookie = app.get(DevicesForTests).signIn("browser");
});

afterEach(async () => {
  await testbed.projectDevices.settled();
  await app.close();
  await rm(testbed.environments.folder, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** Sends the body and answers the status and the body, kept in `bodies`. */
async function send(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${url}/api${path}`, {
    method,
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  bodies.push(text);
  return { status: response.status, body: text === "" ? undefined : (JSON.parse(text) as unknown) };
}

async function list(): Promise<ReturnType<typeof projectDeviceListSchema.parse>> {
  const answer = await send("GET", projectDevicesPath(PROJECT_ID));
  expect(answer.status).toBe(200);
  return projectDeviceListSchema.parse(answer.body);
}

describe("a Project's devices through the routes", () => {
  it("adds a device over USB and lists it, Over USB", async () => {
    const added = await send("POST", projectDevicesPath(PROJECT_ID), BOARD);

    expect(added.status).toBe(201);
    const device = projectDeviceSchema.parse(added.body);
    expect(device).toMatchObject({
      projectId: PROJECT_ID,
      kind: "serial-usb",
      name: "Arduino Uno",
      address: null,
      port: null,
      state: "over-usb",
      inUseBy: null,
      pairingStep: null,
      lastUse: null,
      addedBy: { userId: "user", name: "Ann Lee" },
    });
    expect((await list()).devices).toEqual([device]);
  });

  it("adds a phone over wireless debugging Not paired, then Paired, with the code in no body and no log line", async () => {
    const added = await send("POST", projectDevicesPath(PROJECT_ID), PHONE);

    expect(added.status).toBe(201);
    expect(projectDeviceSchema.parse(added.body)).toMatchObject({
      state: "not-paired",
      address: "192.168.1.20",
      port: 41_234,
      pairingStep: "starting-environment",
    });
    await testbed.projectDevices.settled();
    expect((await list()).devices[0]).toMatchObject({
      name: "Pixel 9",
      state: "paired",
      pairingStep: null,
    });
    expect(bodies.join("\n")).not.toContain(CODE);
    expect(logged.join("\n")).not.toContain(CODE);
  });

  it("refuses adding with 422 and words while the Run environment isn't On", async () => {
    testbed.settings.off.add(PROJECT_ID);

    const refused = await send("POST", projectDevicesPath(PROJECT_ID), BOARD);

    expect(refused.status).toBe(422);
    expect(projectDeviceRefusalSchema.parse(refused.body)).toEqual({
      statusCode: 422,
      message: "Needs Run environment On: a device is paired and used in the run environment.",
      reasons: ["Needs Run environment On: a device is paired and used in the run environment."],
      holder: null,
    });
  });

  it("renames a device and gives a phone a new Port", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, PHONE, {
      userId: "u",
      name: "U",
    });
    await testbed.projectDevices.settled();

    const changed = await send("PATCH", projectDevicePath(device.id), {
      name: "Ann's Pixel",
      port: 40_000,
    });

    expect(changed.status).toBe(200);
    expect(projectDeviceSchema.parse(changed.body)).toMatchObject({
      name: "Ann's Pixel",
      port: 40_000,
      state: "paired",
    });
    const malformed = await send("PATCH", projectDevicePath(device.id), {});
    expect(malformed.status).toBe(400);
  });

  it("pairs a phone again, answering the device with its pairing started", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, PHONE, {
      userId: "u",
      name: "U",
    });
    await testbed.projectDevices.settled();
    const { kind: _kind, ...again } = PHONE;

    const paired = await send("POST", projectDevicePairPath(device.id), { ...again, port: 40_000 });

    expect(paired.status).toBe(201);
    expect(projectDeviceSchema.parse(paired.body)).toMatchObject({
      id: device.id,
      port: 40_000,
      pairingStep: "starting-environment",
    });
    await testbed.projectDevices.settled();
    expect(testbed.adb.pairingInputs).toHaveLength(2);
    expect(bodies.join("\n")).not.toContain(CODE);
  });

  it("lends a device to a Task, refuses removing it with 409 naming the holder, then removes it once given back", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, BOARD, {
      userId: "u",
      name: "U",
    });

    const lent = await send("POST", taskLendDevicePath(TASK_ID), { projectDeviceId: device.id });

    expect(lent.status).toBe(201);
    const record = connectedDeviceSchema.parse(lent.body);
    expect(record).toMatchObject({
      taskId: TASK_ID,
      projectDeviceId: device.id,
      kind: "serial-usb",
      state: "connecting",
      connectedBy: { userId: "user", name: "Ann Lee" },
    });
    expect((await list()).devices[0]).toMatchObject({
      state: "in-use",
      inUseBy: { kind: "task", taskId: TASK_ID, title: "Install on the phone" },
    });

    const held = await send("DELETE", projectDevicePath(device.id));
    expect(held.status).toBe(409);
    expect(projectDeviceRefusalSchema.parse(held.body)).toEqual({
      statusCode: 409,
      message: "Arduino Uno is in use by Install on the phone.",
      reasons: ["Arduino Uno is in use by Install on the phone."],
      holder: { kind: "task", taskId: TASK_ID, title: "Install on the phone" },
    });

    await testbed.devices.disconnect(record.id, "by-user", { userId: "user", name: "Ann Lee" });
    const removed = await send("DELETE", projectDevicePath(device.id));
    expect(removed.status).toBe(204);
    expect((await list()).devices).toEqual([]);
  });

  it("answers 404 for a Project device that isn't there", async () => {
    const id = randomUUID();

    expect((await send("PATCH", projectDevicePath(id), { name: "Uno" })).status).toBe(404);
    expect((await send("DELETE", projectDevicePath(id))).status).toBe(404);
    const { kind: _kind, ...again } = PHONE;
    expect((await send("POST", projectDevicePairPath(id), again)).status).toBe(404);
    expect((await send("POST", taskLendDevicePath(TASK_ID), { projectDeviceId: id })).status).toBe(
      404,
    );
  });

  it("publishes project-device.changed to the web, naming the Project", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, BOARD, {
      userId: "u",
      name: "U",
    });

    const webEvent = app
      .get(WebEventForwarding)
      .toWebEvent(new ProjectDeviceChanged(PROJECT_ID, device.id));

    expect(projectDeviceWebEventSchema.parse(webEvent)).toMatchObject({
      type: "project-device.changed",
      projectId: PROJECT_ID,
    });
  });
});
