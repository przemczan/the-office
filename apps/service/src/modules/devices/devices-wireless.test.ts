import { rm } from "node:fs/promises";
import { Logger, type INestApplication } from "@nestjs/common";
import {
  connectDeviceRefusalSchema,
  connectedDeviceListSchema,
  connectedDeviceSchema,
  taskDevicesPath,
  taskWirelessDevicesPath,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { EventsModule } from "../../platform/events/events.module.js";
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
import { DevicesController } from "./adapters/http/devices.controller.js";
import { ConnectedDevices } from "./application/connected-devices.js";
import { devicesTestbed, PROJECT_ID, type DevicesTestbed } from "./devices.fixtures.js";

const TASK_ID = "00000000-0000-4000-8000-00000000d001";
const OTHER_TASK_ID = "00000000-0000-4000-8000-00000000d002";
const CODE = "482913";
const PHONE = { address: "192.168.1.20", port: 41_234, pairingPort: 37_000, pairingCode: CODE };
const LOG_LEVELS = ["log", "warn", "error", "debug", "verbose", "fatal"] as const;

let app: INestApplication;
let url: string;
let cookie: string;
let testbed: DevicesTestbed<RunEnvironmentsTestbed>;
/** Every log line any Logger wrote, by an instance or Nest's static one. */
let logged: string[];
/** Every response body the test read. */
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
    controllers: [DevicesController],
    providers: [{ provide: ConnectedDevices, useValue: testbed.devices }],
  }));
  cookie = app.get(DevicesForTests).signIn("browser");
});

afterEach(async () => {
  await app.close();
  await rm(testbed.environments.folder, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** POSTs the body and answers the status and the body, kept in `bodies`. */
async function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${url}/api${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  bodies.push(text);
  return { status: response.status, body: JSON.parse(text) as unknown };
}

async function list(): Promise<unknown> {
  const response = await fetch(`${url}/api${taskDevicesPath(TASK_ID)}`, { headers: { cookie } });
  const text = await response.text();
  bodies.push(text);
  return JSON.parse(text) as unknown;
}

describe("pairing an Android phone over wireless debugging through the route", () => {
  it("answers the Connecting record, later Connected, with the code in no body and no log line", async () => {
    const answer = await post(taskWirelessDevicesPath(TASK_ID), PHONE);

    expect(answer.status).toBe(201);
    const device = connectedDeviceSchema.parse(answer.body);
    expect(device).toMatchObject({
      taskId: TASK_ID,
      kind: "android-wireless",
      name: "192.168.1.20",
      state: "connecting",
      connectedBy: { userId: "user", name: "Ann Lee" },
    });
    await expect
      .poll(async () => connectedDeviceListSchema.parse(await list()).devices[0], {
        timeout: 10_000,
      })
      .toMatchObject({
        id: device.id,
        state: "connected",
        name: "Pixel 9",
        endpoint: "192.168.1.20:41234",
      });
    expect(testbed.adb.pairingInputs.map(String)).toEqual([`${CODE}\n`]);
    expect(bodies.join("\n")).not.toContain(CODE);
    expect(logged.join("\n")).not.toContain(CODE);
  });

  it("refuses with 409 naming the other Task holding the address", async () => {
    await testbed.addTask(OTHER_TASK_ID, "Test the checkout");
    const other = await testbed.devices.pair(OTHER_TASK_ID, PHONE, {
      userId: "user",
      name: "Ann Lee",
    });
    // Its pairing, in the background, starts its run environment: let it end first.
    await expect
      .poll(async () => (await testbed.devices.read(other.id)).state, { timeout: 10_000 })
      .toBe("connected");

    const held = await post(taskWirelessDevicesPath(TASK_ID), { ...PHONE, port: 40_000 });

    expect(held.status).toBe(409);
    expect(connectDeviceRefusalSchema.parse(held.body)).toEqual({
      statusCode: 409,
      message: "Already connected to the Task «Test the checkout».",
      reasons: ["Already connected to the Task «Test the checkout»."],
      otherTask: { id: OTHER_TASK_ID, title: "Test the checkout" },
    });
    expect(bodies.join("\n")).not.toContain(CODE);
  });

  it.each([
    ["127.0.0.1", "«127.0.0.1» is a loopback address"],
    ["fe80::1", "«fe80::1» is a link-local address"],
  ])("refuses the address %s with 422 and words", async (address, words) => {
    const refused = await post(taskWirelessDevicesPath(TASK_ID), { ...PHONE, address });

    expect(refused.status).toBe(422);
    const refusal = connectDeviceRefusalSchema.parse(refused.body);
    expect(refusal.otherTask).toBeNull();
    expect(refusal.reasons).toHaveLength(1);
    expect(refusal.reasons[0]).toContain(words);
    expect(testbed.adb.steps).toEqual([]);
    expect(bodies.join("\n")).not.toContain(CODE);
  });

  it("refuses with 422 when the Project's Run environment is Off, starting nothing", async () => {
    testbed.settings.off.add(PROJECT_ID);

    const off = await post(taskWirelessDevicesPath(TASK_ID), PHONE);

    expect(off.status).toBe(422);
    expect(connectDeviceRefusalSchema.parse(off.body)).toMatchObject({
      reasons: ["The Project's Run environment is Off."],
      otherTask: null,
    });
    expect(testbed.environmentStart.starts).toEqual([]);
    expect(bodies.join("\n")).not.toContain(CODE);
  });

  it.each(["9137402", "91374", "91a374"])(
    "answers 400 for the malformed code %s without echoing it",
    async (pairingCode) => {
      const malformed = await post(taskWirelessDevicesPath(TASK_ID), { ...PHONE, pairingCode });

      expect(malformed.status).toBe(400);
      expect(malformed.body).toMatchObject({
        message: "pairingCode: The pairing code is 6 digits.",
      });
      expect(bodies.join("\n")).not.toContain(pairingCode);
      expect(logged.join("\n")).not.toContain(pairingCode);
      expect(await testbed.devices.list(TASK_ID)).toEqual([]);
    },
  );
});
