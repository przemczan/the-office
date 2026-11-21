import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  connectDeviceRefusalSchema,
  connectedDeviceListSchema,
  connectedDeviceSchema,
  DEVICE_CONTROL_CHANNEL,
  DEVICE_FRAME_TYPES,
  DEVICE_RELAY_TAKEN_CLOSE_CODE,
  deviceRelayPath,
  deviceRelayServerMessageSchema,
  disconnectDevicePath,
  encodeFrame,
  FrameReader,
  taskDevicesPath,
  type DeviceFrame,
  type DeviceRelayServerMessage,
} from "@the-office/contracts";
import { WebSocket as WsClient } from "ws";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import type { TaskInWorktree } from "../run-environments/index.js";
import { DevicesController } from "./adapters/http/devices.controller.js";
import { DeviceRelayRoute } from "./adapters/websocket/device-relay-route.js";
import { ConnectedDevices } from "./application/connected-devices.js";
import {
  devicesTestbed,
  framesWrittenTo,
  HELPER_ENDPOINT,
  PROJECT_ID,
  type DevicesTestbed,
} from "./devices.fixtures.js";

const TASK_ID = "00000000-0000-4000-8000-00000000b001";
const OTHER_TASK_ID = "00000000-0000-4000-8000-00000000b002";
const PHONE = { kind: "android-usb", name: "Pixel 9", deviceKey: "18d1:4ee7:RELAY" } as const;

let app: INestApplication;
let url: string;
let port: number;
let cookie: string;
let testbed: DevicesTestbed<RunEnvironmentsTestbed>;
let task: TaskInWorktree;
const clients: WsClient[] = [];

beforeEach(async () => {
  const runtime = new ScriptedContainerRuntime();
  testbed = await devicesTestbed(runtime, await runEnvironmentsTestbed(runtime));
  task = await testbed.addTask(TASK_ID, "Flash the phone");
  ({ app, url, port } = await startTestApplication({
    imports: [EventsModule, EventStreamModule, devicesForTests()],
    requestAccess: "guarded",
    controllers: [DevicesController],
    providers: [{ provide: ConnectedDevices, useValue: testbed.devices }, DeviceRelayRoute],
  }));
  cookie = app.get(DevicesForTests).signIn("browser");
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await app.close();
  await rm(testbed.environments.folder, { recursive: true, force: true });
});

function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function connectDevice(): Promise<string> {
  const response = await post(taskDevicesPath(TASK_ID), PHONE);
  expect(response.status).toBe(201);
  return connectedDeviceSchema.parse(await response.json()).id;
}

/** A signed-in browser's relay socket, its text messages parsed and its frames read. */
interface RelayClient {
  readonly socket: WsClient;
  readonly states: DeviceRelayServerMessage[];
  readonly frames: DeviceFrame[];
  readonly closed: Promise<number>;
}

async function openRelay(deviceId: string): Promise<RelayClient> {
  const socket = new WsClient(`ws://localhost:${port}${deviceRelayPath(deviceId)}`, {
    headers: { cookie },
  });
  clients.push(socket);
  const states: DeviceRelayServerMessage[] = [];
  const frames: DeviceFrame[] = [];
  const reader = new FrameReader();
  socket.on("message", (data: Buffer, isBinary) => {
    if (isBinary) frames.push(...reader.push(data));
    else states.push(deviceRelayServerMessageSchema.parse(JSON.parse(data.toString())));
  });
  const closed = new Promise<number>((resolve) => socket.on("close", (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return { socket, states, frames, closed };
}

function start(): Promise<void> {
  return testbed.environments.environments.prepare(
    task,
    join(testbed.environments.folder, "prepare.log"),
  );
}

describe("a device's relay over the signed-in WebSocket", () => {
  it("carries bytes from the helper to the browser and back unchanged", async () => {
    await start();
    const id = await connectDevice();
    const relay = await openRelay(id);
    await expect
      .poll(() => relay.states.at(-1))
      .toEqual({ type: "state", state: "connected", endpoint: HELPER_ENDPOINT });
    const [helper] = testbed.runtime.attached;
    if (helper === undefined) throw new Error("No helper attached.");

    // adb connects to the helper's endpoint: the helper opens a channel and sends its bytes.
    const sent = Buffer.from([0x43, 0x4e, 0x58, 0x4e, 0x00, 0x00, 0x00, 0x01, 0xff, 0x0a]);
    helper.print(
      encodeFrame({ type: DEVICE_FRAME_TYPES.open, channel: 7, payload: new Uint8Array() }),
    );
    helper.print(encodeFrame({ type: DEVICE_FRAME_TYPES.data, channel: 7, payload: sent }));
    await expect.poll(() => relay.frames.length).toBe(2);
    expect(relay.frames.map(({ type, channel }) => ({ type, channel }))).toEqual([
      { type: DEVICE_FRAME_TYPES.open, channel: 7 },
      { type: DEVICE_FRAME_TYPES.data, channel: 7 },
    ]);

    // The browser, as a loopback device, answers with the same bytes.
    relay.socket.send(encodeFrame(relay.frames[1] ?? { type: 4, channel: 0, payload: sent }));
    await expect
      .poll(() => framesWrittenTo(helper).filter(({ type }) => type === DEVICE_FRAME_TYPES.data))
      .toHaveLength(1);
    const [back] = framesWrittenTo(helper);
    expect(back?.channel).toBe(7);
    expect(Buffer.from(back?.payload ?? [])).toEqual(sent);
    expect(relay.frames.every(({ channel }) => channel !== DEVICE_CONTROL_CHANNEL)).toBe(true);
  });

  it("closes a second socket for the device with 4409", async () => {
    await start();
    const id = await connectDevice();
    await openRelay(id);

    const second = await openRelay(id);

    expect(await second.closed).toBe(DEVICE_RELAY_TAKEN_CLOSE_CODE);
  });

  it("disconnects the device as tab closed when the browser's socket closes", async () => {
    await start();
    const id = await connectDevice();
    const relay = await openRelay(id);
    await expect.poll(() => relay.states.at(-1)?.state).toBe("connected");

    relay.socket.close();

    await expect
      .poll(async () => (await testbed.devices.read(id)).disconnectedBecause)
      .toBe("tab-closed");
    expect(testbed.runtime.attached[0]?.stopped).toBe(true);
  });
});

describe("the Devices routes", () => {
  it("lists the Task's devices and disconnects one by the signed-in user", async () => {
    const id = await connectDevice();

    const disconnected = connectedDeviceSchema.parse(
      await (await post(disconnectDevicePath(id))).json(),
    );
    expect(disconnected).toMatchObject({
      state: "disconnected",
      disconnectedBecause: "by-user",
      disconnectedBy: { userId: "user", name: "Ann Lee" },
    });

    const list = await fetch(`${url}/api${taskDevicesPath(TASK_ID)}`, { headers: { cookie } });
    expect(
      connectedDeviceListSchema.parse(await list.json()).devices.map((device) => device.id),
    ).toEqual([id]);
  });

  it("refuses with 409 naming the other Task, and with 422 otherwise", async () => {
    await testbed.addTask(OTHER_TASK_ID, "Test the checkout");
    await testbed.devices.connect(OTHER_TASK_ID, PHONE, { userId: "user", name: "Ann Lee" });

    const held = await post(taskDevicesPath(TASK_ID), PHONE);
    expect(held.status).toBe(409);
    expect(connectDeviceRefusalSchema.parse(await held.json())).toEqual({
      statusCode: 409,
      message: "Already connected to the Task «Test the checkout».",
      reasons: ["Already connected to the Task «Test the checkout»."],
      otherTask: { id: OTHER_TASK_ID, title: "Test the checkout" },
    });

    testbed.settings.off.add(PROJECT_ID);
    const off = await post(taskDevicesPath(TASK_ID), { ...PHONE, deviceKey: "other" });
    expect(off.status).toBe(422);
    expect(connectDeviceRefusalSchema.parse(await off.json())).toMatchObject({
      reasons: ["The Project's Run environment is Off."],
      otherTask: null,
    });
  });

  it("answers 404 for a Task or a device there is none of", async () => {
    const missing = "00000000-0000-4000-8000-00000000b0ff";
    expect((await post(taskDevicesPath(missing), PHONE)).status).toBe(404);
    expect((await post(disconnectDevicePath(missing))).status).toBe(404);
  });
});
