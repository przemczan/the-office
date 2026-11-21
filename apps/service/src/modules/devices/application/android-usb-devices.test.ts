import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { DEVICE_FRAME_TYPES, encodeFrame, FrameReader } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_MASK,
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../../run-environments/index.fixtures.js";
import type { TaskInWorktree } from "../../run-environments/index.js";
import { DeviceRelayLink } from "../adapters/websocket/device-relay-link.js";
import {
  devicesTestbed,
  FakeRelaySocket,
  HELPER_ENDPOINT,
  PROJECT_ID,
  type DevicesTestbed,
} from "../devices.fixtures.js";
import { ADB_MISSING } from "./adb-in-run-environment.js";
import { ADB_RECONNECT_DELAY_MS, ADB_RECONNECT_INTERVAL_MS } from "./android-usb-devices.js";

const ANN = { userId: "user-ann", name: "Ann Lee" };
const PHONE = { kind: "android-usb" as const, name: "Pixel 9", deviceKey: "usb:18d1:4ee7:A1" };
const TASK_ID = "00000000-0000-4000-8000-00000000b001";
const OTHER_TASK_ID = "00000000-0000-4000-8000-00000000b002";
const CONNECT = `adb connect ${HELPER_ENDPOINT}`;

let testbed: DevicesTestbed<RunEnvironmentsTestbed>;
let task: TaskInWorktree;

beforeEach(async () => {
  const runtime = new ScriptedContainerRuntime();
  testbed = await devicesTestbed(runtime, await runEnvironmentsTestbed(runtime));
  task = await testbed.addTask(TASK_ID, "Install on the phone");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(testbed.environments.folder, { recursive: true, force: true });
});

function start(of: TaskInWorktree = task): Promise<void> {
  return testbed.environments.environments.prepare(
    of,
    join(testbed.environments.folder, `prepare-${of.taskId}.log`),
  );
}

async function connectWithRelay(
  taskId = TASK_ID,
  phone: typeof PHONE = PHONE,
): Promise<{ id: string; socket: FakeRelaySocket }> {
  const device = await testbed.devices.connect(taskId, phone, ANN);
  const socket = new FakeRelaySocket();
  await testbed.devices.relayOpened(device.id, new DeviceRelayLink(socket));
  return { id: device.id, socket };
}

/** Waits until adb's steps ran as far as `step`, the nth time. */
async function untilStep(step: string, times = 1): Promise<void> {
  await vi.waitFor(() => {
    expect(testbed.adb.steps.filter((ran) => ran === step)).toHaveLength(times);
  });
}

/** Lets the handlers a helper's frames set off run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** The helper relaying the device, the newest one attached. */
function relayHelper(): ScriptedContainerRuntime["attached"][number] {
  const helpers = testbed.runtime.attached.filter(
    ({ attachment }) => attachment.arguments[1] === "relay",
  );
  const helper = helpers.at(-1);
  if (helper === undefined) throw new Error("No helper attached.");
  return helper;
}

/** adb in the run environment opens a connection to the helper, then drops it. */
function adbConnectsAndDrops(channel: number): void {
  relayHelper().print(
    encodeFrame({ type: DEVICE_FRAME_TYPES.open, channel, payload: new Uint8Array() }),
  );
  relayHelper().print(
    encodeFrame({ type: DEVICE_FRAME_TYPES.close, channel, payload: new Uint8Array() }),
  );
}

/** Each check's variables by name, as its script takes them back from their carriers. */
function variablesOfCheck(index: number): Record<string, string> {
  const execution = testbed.runtime.executions[index];
  if (execution === undefined) throw new Error(`No check ${index}.`);
  const variables: Record<string, string> = {};
  for (const [, name, carrier] of execution.script.matchAll(
    /export (\w+)="\$(OFFICE_VARIABLE_\d+)"/g,
  )) {
    if (name !== undefined && carrier !== undefined) {
      variables[name] = execution.variables[carrier] ?? "";
    }
  }
  return variables;
}

function check(set: { name: string; value: string }[] = []): Promise<unknown> {
  return testbed.environments.environments.run(task, {
    commandLine: "./gradlew installDebug",
    environment: { set, unset: [], prependPath: [] },
    mask: NO_MASK,
    timeoutMs: 60_000,
    outputFile: join(testbed.environments.folder, "output", "check"),
  });
}

describe("an Android phone over USB", () => {
  it("checks adb, writes the Project's key and runs adb connect once the helper is ready", async () => {
    await start();
    const { id } = await connectWithRelay();

    await untilStep(CONNECT);
    expect(testbed.adb.steps).toEqual(["command -v adb", "adb-key", "adb kill-server", CONNECT]);
    expect(await testbed.devices.read(id)).toMatchObject({
      state: "connected",
      endpoint: HELPER_ENDPOINT,
    });
  });

  it("ends Disconnected with words naming adb and .devcontainer when adb isn't there", async () => {
    testbed.adb.present = false;
    await start();
    const { id, socket } = await connectWithRelay();

    await vi.waitFor(async () => {
      expect(await testbed.devices.read(id)).toMatchObject({
        state: "disconnected",
        disconnectedBecause: "error",
        problem: ADB_MISSING,
      });
    });
    expect(ADB_MISSING).toMatch(/adb.*\.devcontainer/);
    expect(testbed.adb.steps).not.toContain("adb-key");
    expect(testbed.adb.steps).not.toContain(CONNECT);
    expect(socket.closedWith).toBeDefined();
  });

  it("stays Connected and runs no further adb step when the adb check is cut off", async () => {
    testbed.adb.checkStopped = true;
    await start();
    const { id } = await connectWithRelay();

    await untilStep("command -v adb");
    await settle();
    expect(testbed.adb.steps).toEqual(["command -v adb"]);
    expect(await testbed.devices.read(id)).toMatchObject({ state: "connected", problem: null });
  });

  it("connects adb again at each start of the run environment, without restarting its server", async () => {
    await start();
    await connectWithRelay();
    await untilStep(CONNECT);

    await testbed.environments.environments.sweep();
    await start();

    await untilStep(CONNECT, 2);
    expect(testbed.adb.steps).toEqual([
      "command -v adb",
      "adb-key",
      "adb kill-server",
      CONNECT,
      "command -v adb",
      "adb-key",
      CONNECT,
    ]);
  });

  it("connects again 2 s after adb drops the connection, at most once per 30 s", async () => {
    await start();
    await connectWithRelay();
    await untilStep(CONNECT);
    const { schedule } = testbed.environments;

    adbConnectsAndDrops(1);
    await settle();
    await schedule.advanceBy(ADB_RECONNECT_DELAY_MS);
    await untilStep(CONNECT, 2);

    adbConnectsAndDrops(2);
    await schedule.advanceBy(ADB_RECONNECT_DELAY_MS);
    await settle();
    expect(testbed.adb.steps.filter((step) => step === CONNECT)).toHaveLength(2);

    await schedule.advanceBy(ADB_RECONNECT_INTERVAL_MS);
    adbConnectsAndDrops(3);
    await settle();
    await schedule.advanceBy(ADB_RECONNECT_DELAY_MS);
    await untilStep(CONNECT, 3);
  });

  it("doesn't reconnect while the browser closes an older connection for a newer one", async () => {
    await start();
    const { socket } = await connectWithRelay();
    await untilStep(CONNECT);
    const { schedule } = testbed.environments;

    relayHelper().print(
      encodeFrame({ type: DEVICE_FRAME_TYPES.open, channel: 1, payload: new Uint8Array() }),
    );
    relayHelper().print(
      encodeFrame({ type: DEVICE_FRAME_TYPES.open, channel: 2, payload: new Uint8Array() }),
    );
    await vi.waitFor(() => expect(socket.frames()).toHaveLength(2));
    socket.fromBrowser({ type: DEVICE_FRAME_TYPES.close, channel: 1, payload: new Uint8Array() });
    await settle();
    await schedule.advanceBy(ADB_RECONNECT_DELAY_MS);

    expect(testbed.adb.steps.filter((step) => step === CONNECT)).toHaveLength(1);
  });

  it("runs adb disconnect as it is disconnected", async () => {
    await start();
    const { id } = await connectWithRelay();
    await untilStep(CONNECT);

    await testbed.devices.disconnect(id, "by-user", ANN);

    await untilStep(`adb disconnect ${HELPER_ENDPOINT}`);
    expect((await testbed.devices.read(id)).state).toBe("disconnected");
  });
});

describe("the Project's adb key", () => {
  it("is made once per Project and given to each of its Tasks' run environments the same", async () => {
    const other = await testbed.addTask(OTHER_TASK_ID, "Another Task");
    await start();
    await start(other);
    await connectWithRelay();
    await untilStep("adb-key");
    await connectWithRelay(OTHER_TASK_ID, { ...PHONE, deviceKey: "usb:18d1:4ee7:B2" });
    await untilStep("adb-key", 2);

    expect(testbed.adbKeys.keys.size).toBe(1);
    const key = testbed.adbKeys.keys.get(PROJECT_ID);
    const [first, second] = testbed.adb.keyInputs.map((input) => new FrameReader().push(input));
    expect(
      first?.map(({ channel, payload }) => [channel, Buffer.from(payload).toString()]),
    ).toEqual([
      [1, key?.privateKey],
      [2, key?.publicKey],
    ]);
    expect(second).toEqual(first);
  });

  it("is in no command line, log line, device record or Task's words", async () => {
    const logged: string[] = [];
    for (const level of ["log", "warn", "error", "debug", "verbose"] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...parts: unknown[]) => {
        logged.push(parts.map(String).join(" "));
      });
    }
    await start();
    const { id } = await connectWithRelay();
    await untilStep(CONNECT);
    const key = testbed.adbKeys.keys.get(PROJECT_ID);
    if (key === undefined) throw new Error("No key kept.");
    const secret = key.privateKey.split("\n")[1] ?? key.privateKey;

    const seen = JSON.stringify([
      testbed.runtime.attached.map(({ attachment }) => attachment),
      logged,
      await testbed.devices.read(id),
      await testbed.devices.list(TASK_ID),
    ]);
    expect(seen).not.toContain(secret);
  });
});

describe("ANDROID_SERIAL", () => {
  it("is the adb serial when exactly one Android phone is Connected", async () => {
    await start();
    await connectWithRelay();
    await check();

    expect(variablesOfCheck(0)).toMatchObject({ ANDROID_SERIAL: HELPER_ENDPOINT });
  });

  it("isn't given with two phones Connected, nor with none", async () => {
    await start();
    await check();
    await connectWithRelay();
    await connectWithRelay(TASK_ID, { ...PHONE, deviceKey: "usb:18d1:4ee7:B2" });
    await check();

    expect(variablesOfCheck(0)).not.toHaveProperty("ANDROID_SERIAL");
    expect(variablesOfCheck(1)).not.toHaveProperty("ANDROID_SERIAL");
  });

  it("isn't given when the Project's environment sets it", async () => {
    await start();
    await connectWithRelay();
    await check([{ name: "ANDROID_SERIAL", value: "emulator-5554" }]);

    expect(variablesOfCheck(0)).toMatchObject({ ANDROID_SERIAL: "emulator-5554" });
    expect(testbed.runtime.executions[0]?.script.match(/export ANDROID_SERIAL=/g)).toHaveLength(1);
  });
});
