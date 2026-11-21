import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  DEVICE_FRAME_TYPES,
  DEVICE_RELAY_ENDED_CLOSE_CODE,
  encodeFrame,
  textFrame,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectRunEnvironmentChanged } from "../../projects/index.js";
import {
  NO_MASK,
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../../run-environments/index.fixtures.js";
import type { TaskInWorktree } from "../../run-environments/index.js";
import { TaskStateChanged } from "../../work/index.js";
import { DeviceRelayLink } from "../adapters/websocket/device-relay-link.js";
import { ConnectedDeviceChanged } from "../domain/connected-device-events.js";
import { ConnectedDeviceRefused } from "../domain/connected-device-refused.js";
import {
  devicesTestbed,
  FakeRelaySocket,
  framesWrittenTo,
  HELPER_ENDPOINT,
  PROJECT_ID,
  type DevicesTestbed,
} from "../devices.fixtures.js";
import { HELPER_START_TIMEOUT_MS } from "./connected-devices.js";
import { hostHelperArchitecture } from "./device-helper-architecture.js";

const ANN = { userId: "user-ann", name: "Ann Lee" };
const PHONE = { kind: "android-usb", name: "Pixel 9", deviceKey: "18d1:4ee7:ABC123" } as const;
const TASK_ID = "00000000-0000-4000-8000-00000000a001";
const OTHER_TASK_ID = "00000000-0000-4000-8000-00000000a002";

let testbed: DevicesTestbed<RunEnvironmentsTestbed>;
let task: TaskInWorktree;
let changes: string[];

beforeEach(async () => {
  const runtime = new ScriptedContainerRuntime();
  testbed = await devicesTestbed(runtime, await runEnvironmentsTestbed(runtime));
  task = await testbed.addTask(TASK_ID, "Flash the phone");
  changes = [];
  testbed.environments.events.subscribe(ConnectedDeviceChanged, ({ deviceId }) => {
    changes.push(deviceId);
  });
});

afterEach(async () => {
  await rm(testbed.environments.folder, { recursive: true, force: true });
});

function start(): Promise<void> {
  return testbed.environments.environments.prepare(
    task,
    join(testbed.environments.folder, "prepare.log"),
  );
}

/** Stops the Task's run environment, as the startup sweep stops an open Task's. */
function stop(): Promise<void> {
  return testbed.environments.environments.sweep();
}

async function connectWithRelay(): Promise<{ id: string; socket: FakeRelaySocket }> {
  const device = await testbed.devices.connect(TASK_ID, PHONE, ANN);
  const socket = new FakeRelaySocket();
  await testbed.devices.relayOpened(device.id, new DeviceRelayLink(socket));
  return { id: device.id, socket };
}

async function stateOf(id: string): Promise<string> {
  return (await testbed.devices.read(id)).state;
}

/** Lets the handlers a socket's close or a helper's end set off run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe("connecting a device", () => {
  it("is Connected at the helper's endpoint while the run environment runs", async () => {
    await start();

    const connecting = await testbed.devices.connect(TASK_ID, PHONE, ANN);
    expect(connecting).toMatchObject({ state: "connecting", connectedBy: ANN, endpoint: null });
    const socket = new FakeRelaySocket();
    await testbed.devices.relayOpened(connecting.id, new DeviceRelayLink(socket));

    expect(await testbed.devices.read(connecting.id)).toMatchObject({
      state: "connected",
      endpoint: HELPER_ENDPOINT,
    });
    expect(socket.states()).toEqual([
      { type: "state", state: "connecting", endpoint: null },
      { type: "state", state: "connected", endpoint: HELPER_ENDPOINT },
    ]);
    expect(testbed.runtime.attached[0]?.attachment.arguments).toEqual([
      `/office-device-helper/office-device-helper-${hostHelperArchitecture()}`,
      "relay",
      "--listen",
      "127.0.0.1:0",
    ]);
    expect(changes).toEqual([connecting.id, connecting.id]);
    expect(await testbed.taskDevices.linesOf(TASK_ID)).toEqual([
      `Android phone over USB «Pixel 9»: Connected, at ${HELPER_ENDPOINT}`,
    ]);
  });

  it("waits for the run environment while it isn't running, never starting it, and is Connected at its start", async () => {
    const { id, socket } = await connectWithRelay();

    expect(await stateOf(id)).toBe("waiting-for-run-environment");
    expect(testbed.runtime.steps).toEqual([]);
    expect(await testbed.taskDevices.linesOf(TASK_ID)).toEqual([
      "Android phone over USB «Pixel 9»: Waiting for the run environment",
    ]);

    await start();

    expect(await stateOf(id)).toBe("connected");
    expect(socket.states().map(({ state }) => state)).toEqual([
      "connecting",
      "waiting-for-run-environment",
      "connected",
    ]);
  });

  it("waits as the run environment stops, and comes back Connected on a new helper at its next start", async () => {
    await start();
    const { id, socket } = await connectWithRelay();

    await stop();
    await settle();
    expect(await testbed.devices.read(id)).toMatchObject({
      state: "waiting-for-run-environment",
      endpoint: null,
    });

    await start();
    expect(await stateOf(id)).toBe("connected");
    expect(
      testbed.runtime.attached.filter(({ attachment }) => attachment.arguments[1] === "relay"),
    ).toHaveLength(2);
    expect(socket.states().map(({ state }) => state)).toEqual([
      "connecting",
      "connected",
      "waiting-for-run-environment",
      "connected",
    ]);
  });

  it("relays the browser's DATA to the helper and the helper's back, holding back the browser's other frames", async () => {
    await start();
    const { socket } = await connectWithRelay();
    const [helper] = testbed.runtime.attached;
    if (helper === undefined) throw new Error("No helper attached.");

    socket.fromBrowser(textFrame(DEVICE_FRAME_TYPES.hello, "not the browser's"));
    socket.fromBrowser({ ...textFrame(DEVICE_FRAME_TYPES.data, "host:version"), channel: 3 });
    await settle();

    expect(framesWrittenTo(helper).map(({ type, channel }) => ({ type, channel }))).toEqual([
      { type: DEVICE_FRAME_TYPES.data, channel: 3 },
    ]);
    const echoed = socket.frames();
    expect(echoed).toHaveLength(1);
    expect(echoed[0]?.channel).toBe(3);
    expect(Buffer.from(echoed[0]?.payload ?? []).toString()).toBe("host:version");
  });

  it("ends as an error when the helper isn't this Office's version", async () => {
    testbed.runtime.onAttach = (process) => {
      process.print(Buffer.from(encodeHelloAndReady("0.9.0")));
    };
    await start();
    const { id, socket } = await connectWithRelay();

    expect(await testbed.devices.read(id)).toMatchObject({
      state: "disconnected",
      disconnectedBecause: "error",
      problem: "The Office device helper is version 0.9.0; this Office is 1.4.0.",
    });
    expect(socket.closedWith?.code).toBe(DEVICE_RELAY_ENDED_CLOSE_CODE);
  });

  it("ends as an error when the helper isn't ready within its time", async () => {
    testbed.runtime.onAttach = () => undefined;
    await start();
    const device = await testbed.devices.connect(TASK_ID, PHONE, ANN);
    const opening = testbed.devices.relayOpened(
      device.id,
      new DeviceRelayLink(new FakeRelaySocket()),
    );
    await settle();

    await testbed.environments.schedule.advanceBy(HELPER_START_TIMEOUT_MS);
    await opening;

    expect(await testbed.devices.read(device.id)).toMatchObject({
      state: "disconnected",
      disconnectedBecause: "error",
      problem: "The Office device helper didn't get ready within 10 seconds.",
    });
    expect(testbed.runtime.attached[0]?.stopped).toBe(true);
  });

  it("ends as an error with the helper's words when it ends by itself while the environment runs", async () => {
    await start();
    const { id } = await connectWithRelay();
    const [helper] = testbed.runtime.attached;

    helper?.print(Buffer.from(encodeText(DEVICE_FRAME_TYPES.ended, "adb went away.")));
    helper?.end(1);
    await settle();

    expect(await testbed.devices.read(id)).toMatchObject({
      state: "disconnected",
      disconnectedBecause: "error",
      problem: "adb went away.",
    });
  });
});

describe("refusing a connect", () => {
  it("names the other Task holding the device", async () => {
    await testbed.addTask(OTHER_TASK_ID, "Test the checkout");
    await testbed.devices.connect(OTHER_TASK_ID, PHONE, ANN);

    const refusal = await testbed.devices
      .connect(TASK_ID, PHONE, ANN)
      .catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ConnectedDeviceRefused);
    expect(refusal).toMatchObject({
      reasons: ["Already connected to the Task «Test the checkout»."],
      otherTask: { id: OTHER_TASK_ID, title: "Test the checkout" },
    });
  });

  it("is refused while the Project's Run environment is Off, or the Task ended", async () => {
    testbed.settings.off.add(PROJECT_ID);
    testbed.tasks.tasks.set(TASK_ID, {
      id: TASK_ID,
      title: "Flash the phone",
      projectId: PROJECT_ID,
      state: "done",
    });

    await expect(testbed.devices.connect(TASK_ID, PHONE, ANN)).rejects.toMatchObject({
      reasons: ["The Task is Done.", "The Project's Run environment is Off."],
      otherTask: undefined,
    });
    expect(await testbed.devices.list(TASK_ID)).toEqual([]);
  });

  it("is refused for an Android phone over wireless debugging, which has no relay yet", async () => {
    await expect(
      testbed.devices.connect(
        TASK_ID,
        { ...PHONE, kind: "android-wireless", deviceKey: "192.168.1.5" },
        ANN,
      ),
    ).rejects.toMatchObject({
      reasons: [
        "An Android phone over wireless debugging can't be connected yet: pairing over the network isn't built.",
      ],
    });
  });
});

describe("disconnecting", () => {
  it("ends as tab closed when the socket closes, stopping the helper", async () => {
    await start();
    const { id, socket } = await connectWithRelay();

    socket.browserCloses();
    await settle();

    expect(await testbed.devices.read(id)).toMatchObject({
      state: "disconnected",
      disconnectedBecause: "tab-closed",
    });
    expect(testbed.runtime.attached[0]?.stopped).toBe(true);
    expect(await testbed.taskDevices.of(TASK_ID)).toEqual([]);
  });

  it("ends as device unplugged when the browser said so before closing", async () => {
    await start();
    const { id, socket } = await connectWithRelay();

    socket.fromBrowser({ type: "unplugged" });
    socket.browserCloses();
    await settle();

    expect((await testbed.devices.read(id)).disconnectedBecause).toBe("device-unplugged");
  });

  it("ends by a user, naming them, and tells and closes the socket", async () => {
    await start();
    const { id, socket } = await connectWithRelay();

    const device = await testbed.devices.disconnect(id, "by-user", {
      userId: "user-ben",
      name: "Ben Ito",
    });

    expect(device).toMatchObject({
      state: "disconnected",
      disconnectedBecause: "by-user",
      disconnectedBy: { userId: "user-ben", name: "Ben Ito" },
    });
    expect(socket.states().at(-1)).toEqual({
      type: "state",
      state: "disconnected",
      endpoint: null,
    });
    expect(socket.closedWith?.code).toBe(DEVICE_RELAY_ENDED_CLOSE_CODE);
  });

  it.each(["done", "dropped"] as const)("ends as Task ended when the Task is %s", async (to) => {
    await start();
    const { id, socket } = await connectWithRelay();

    await testbed.environments.events.publish(new TaskStateChanged(TASK_ID, "in-progress", to));

    expect((await testbed.devices.read(id)).disconnectedBecause).toBe("task-ended");
    expect(socket.closedWith?.code).toBe(DEVICE_RELAY_ENDED_CLOSE_CODE);
  });

  it("ends as Task ended when the run environment is removed", async () => {
    await start();
    const { id } = await connectWithRelay();

    await testbed.environments.environments.remove(TASK_ID);

    expect((await testbed.devices.read(id)).disconnectedBecause).toBe("task-ended");
  });

  it("ends every device of the Project's Tasks as Run environment turned Off", async () => {
    const { id } = await connectWithRelay();

    await testbed.environments.events.publish(
      new ProjectRunEnvironmentChanged(PROJECT_ID, "off", []),
    );

    expect((await testbed.devices.read(id)).disconnectedBecause).toBe("run-environment-turned-off");
  });

  it("closes a second socket for the device as taken, and one for a Disconnected device as ended", async () => {
    const { id } = await connectWithRelay();
    const second = new FakeRelaySocket();
    await testbed.devices.relayOpened(id, new DeviceRelayLink(second));
    expect(second.closedWith?.code).toBe(4409);

    await testbed.devices.disconnect(id, "by-user", ANN);
    const late = new FakeRelaySocket();
    await testbed.devices.relayOpened(id, new DeviceRelayLink(late));
    expect(late.closedWith?.code).toBe(DEVICE_RELAY_ENDED_CLOSE_CODE);
  });

  it("sweeps every open device as tab closed, an Office restart having dropped their sockets", async () => {
    const device = await testbed.devices.connect(TASK_ID, PHONE, ANN);

    await testbed.devices.sweep();

    expect((await testbed.devices.read(device.id)).disconnectedBecause).toBe("tab-closed");
    expect((await testbed.devices.connect(TASK_ID, PHONE, ANN)).state).toBe("connecting");
  });
});

describe("OFFICE_CONNECTED_DEVICES", () => {
  it("reaches every check in the run environment, read as it runs", async () => {
    const command = {
      commandLine: "adb devices",
      environment: { set: [], unset: [], prependPath: [] },
      mask: NO_MASK,
      timeoutMs: 60_000,
      outputFile: join(testbed.environments.folder, "output", "check"),
    };
    await testbed.environments.environments.run(task, command);
    const { id } = await connectWithRelay();
    await testbed.environments.environments.run(task, command);

    const [before, after] = testbed.runtime.executions;
    expect(before?.variables).toEqual({ OFFICE_VARIABLE_0: "[]" });
    expect(JSON.parse(after?.variables["OFFICE_VARIABLE_0"] ?? "")).toEqual([
      { id, kind: "android-usb", name: "Pixel 9", endpoint: HELPER_ENDPOINT },
    ]);
    expect(after?.script).toContain('export OFFICE_CONNECTED_DEVICES="$OFFICE_VARIABLE_0"');
  });
});

function encodeText(
  type: (typeof DEVICE_FRAME_TYPES)[keyof typeof DEVICE_FRAME_TYPES],
  text: string,
): Uint8Array {
  return encodeFrame(textFrame(type, text));
}

function encodeHelloAndReady(version: string): Uint8Array {
  return Buffer.concat([
    encodeText(DEVICE_FRAME_TYPES.hello, version),
    encodeText(DEVICE_FRAME_TYPES.ready, HELPER_ENDPOINT),
  ]);
}
