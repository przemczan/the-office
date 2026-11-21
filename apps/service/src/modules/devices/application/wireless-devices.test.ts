import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectRunEnvironmentChanged } from "../../projects/index.js";
import {
  NO_MASK,
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../../run-environments/index.fixtures.js";
import type { TaskInWorktree } from "../../run-environments/index.js";
import { TaskStateChanged } from "../../work/index.js";
import { devicesTestbed, PROJECT_ID, type DevicesTestbed } from "../devices.fixtures.js";
import { ALREADY_IN_THIS_TASK } from "../domain/connected-device.js";
import { ADB_MISSING, ADB_STEP_TIMEOUT_MS, ADB_WITHOUT_PAIR } from "./adb-in-run-environment.js";

const ANN = { userId: "user-ann", name: "Ann Lee" };
const TASK_ID = "00000000-0000-4000-8000-00000000c001";
const OTHER_TASK_ID = "00000000-0000-4000-8000-00000000c002";
const CODE = "482913";
const PHONE = { address: "192.168.1.20", port: 41_234, pairingPort: 37_000, pairingCode: CODE };
const SERIAL = "192.168.1.20:41234";
const PAIR = "adb pair 192.168.1.20:37000";
const CONNECT = `adb connect ${SERIAL}`;
const GETPROP = `adb -s ${SERIAL} shell getprop ro.product.model`;

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

/** Stops the Task's run environment, as the startup sweep stops an open Task's. */
function stop(): Promise<void> {
  return testbed.environments.environments.sweep();
}

async function until(id: string, expected: object): Promise<void> {
  await vi.waitFor(async () => {
    expect(await testbed.devices.read(id)).toMatchObject(expected);
  });
}

async function pairedPhone(): Promise<string> {
  await start();
  const { id } = await testbed.devices.pair(TASK_ID, PHONE, ANN);
  await until(id, { state: "connected" });
  return id;
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

function check(): Promise<unknown> {
  return testbed.environments.environments.run(task, {
    commandLine: "./gradlew installDebug",
    environment: { set: [], unset: [], prependPath: [] },
    mask: NO_MASK,
    timeoutMs: 60_000,
    outputFile: join(testbed.environments.folder, "output", "check"),
  });
}

async function filesUnder(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("pairing an Android phone over wireless debugging", () => {
  it("pairs and connects with adb in the running run environment, with no relay and no helper", async () => {
    await start();
    const device = await testbed.devices.pair(TASK_ID, PHONE, ANN);

    expect(device).toMatchObject({
      kind: "android-wireless",
      state: "connecting",
      deviceKey: "android-wireless:192.168.1.20",
      connectedBy: ANN,
    });
    await until(device.id, { state: "connected", name: "Pixel 9", endpoint: SERIAL });
    expect(testbed.adb.steps).toEqual([
      "command -v adb",
      "adb-key",
      "adb kill-server",
      PAIR,
      CONNECT,
      GETPROP,
    ]);
    expect(
      testbed.runtime.attached.some(({ attachment }) => attachment.arguments.includes("relay")),
    ).toBe(false);
    expect(testbed.environmentStart.starts).toEqual([]);
  });

  it("starts the run environment first when it isn't running", async () => {
    const { id } = await testbed.devices.pair(TASK_ID, PHONE, ANN);

    await until(id, { state: "connected", endpoint: SERIAL });
    expect(testbed.environmentStart.starts).toEqual([TASK_ID]);
    expect(testbed.environments.environments.isRunning(TASK_ID)).toBe(true);
  });

  it("gives the pairing code to adb pair's standard input only", async () => {
    const logged: string[] = [];
    for (const level of ["log", "warn", "error", "debug", "verbose"] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...parts: unknown[]) => {
        logged.push(parts.map(String).join(" "));
      });
    }
    const id = await pairedPhone();
    await check();

    expect(testbed.adb.pairingInputs.map(String)).toEqual([`${CODE}\n`]);
    const files = await filesUnder(testbed.environments.folder);
    const written = await Promise.all(files.map((file) => readFile(file, "utf8")));
    const seen = JSON.stringify([
      testbed.runtime.attached.map(({ attachment }) => attachment),
      testbed.runtime.executions,
      logged,
      written,
      await testbed.devices.read(id),
      await testbed.devices.list(TASK_ID),
      await testbed.taskDevices.of(TASK_ID),
    ]);
    expect(seen).not.toContain(CODE);
  });

  it("ends as an error with adb's words when the pairing fails", async () => {
    testbed.adb.pairAnswer = {
      output: "Failed: Wrong password or connection was dropped.\n",
      exitCode: 1,
    };
    await start();
    const { id } = await testbed.devices.pair(TASK_ID, PHONE, ANN);

    await until(id, {
      state: "disconnected",
      disconnectedBecause: "error",
      problem:
        "adb didn't pair with the phone at 192.168.1.20:37000: Failed: Wrong password or connection was dropped.",
    });
    expect(testbed.adb.steps).not.toContain(CONNECT);
  });

  it("ends as an error when adb pair doesn't answer", async () => {
    testbed.adb.pairHangs = true;
    await start();
    const { id } = await testbed.devices.pair(TASK_ID, PHONE, ANN);
    await vi.waitFor(() => expect(testbed.adb.pairingInputs).toHaveLength(1));

    await testbed.environments.schedule.advanceBy(ADB_STEP_TIMEOUT_MS);

    await until(id, { state: "disconnected", disconnectedBecause: "error" });
    expect((await testbed.devices.read(id)).problem).toMatch(/pair it again/);
  });

  it("says to put a newer platform-tools in .devcontainer when adb has no pair", async () => {
    testbed.adb.pairAnswer = { output: "adb: unknown command pair\n", exitCode: 1 };
    await start();
    const { id } = await testbed.devices.pair(TASK_ID, PHONE, ANN);

    await until(id, { state: "disconnected", problem: ADB_WITHOUT_PAIR });
    expect(ADB_WITHOUT_PAIR).toMatch(/platform-tools.*\.devcontainer/);
  });

  it("says to add Android's platform-tools to .devcontainer when adb isn't there", async () => {
    testbed.adb.present = false;
    const { id } = await testbed.devices.pair(TASK_ID, PHONE, ANN);

    await until(id, { state: "disconnected", disconnectedBecause: "error", problem: ADB_MISSING });
    expect(ADB_MISSING).toMatch(/platform-tools to \.devcontainer/);
    expect(testbed.adb.steps).not.toContain(PAIR);
  });

  it("refuses loopback, unspecified, multicast and link-local addresses in words", async () => {
    for (const address of ["127.0.0.1", "0.0.0.0", "224.0.0.251", "169.254.1.2", "fe80::1"]) {
      await expect(testbed.devices.pair(TASK_ID, { ...PHONE, address }, ANN)).rejects.toMatchObject(
        {
          reasons: [expect.stringContaining(`«${address}»`)],
        },
      );
    }
    expect(await testbed.devices.list(TASK_ID)).toEqual([]);
  });

  it("is refused naming the other Task when the address is connected to it", async () => {
    await testbed.addTask(OTHER_TASK_ID, "Another Task");
    const other = await testbed.devices.pair(OTHER_TASK_ID, PHONE, ANN);
    await until(other.id, { state: "connected" });

    await expect(
      testbed.devices.pair(TASK_ID, { ...PHONE, port: 40_001 }, ANN),
    ).rejects.toMatchObject({
      reasons: ["Already connected to the Task «Another Task»."],
      otherTask: { id: OTHER_TASK_ID, title: "Another Task" },
    });
  });

  it("is refused saying to disconnect it first when this Task already has the address", async () => {
    const first = await testbed.devices.pair(TASK_ID, PHONE, ANN);
    await until(first.id, { state: "connected" });

    await expect(testbed.devices.pair(TASK_ID, PHONE, ANN)).rejects.toMatchObject({
      reasons: [ALREADY_IN_THIS_TASK],
      otherTask: undefined,
    });
  });

  it("is refused while the Project's Run environment is Off, and for a Task Done", async () => {
    testbed.settings.off.add(PROJECT_ID);
    await expect(testbed.devices.pair(TASK_ID, PHONE, ANN)).rejects.toMatchObject({
      reasons: ["The Project's Run environment is Off."],
    });
    testbed.settings.off.clear();
    testbed.tasks.tasks.set(TASK_ID, {
      id: TASK_ID,
      title: "Install on the phone",
      projectId: PROJECT_ID,
      state: "done",
    });
    await expect(testbed.devices.pair(TASK_ID, PHONE, ANN)).rejects.toMatchObject({
      reasons: ["The Task is Done."],
    });
    expect(testbed.environmentStart.starts).toEqual([]);
  });
});

describe("a paired phone over wireless debugging", () => {
  it("waits as the run environment stops and connects again at its next start, never pairing", async () => {
    const id = await pairedPhone();

    await stop();
    await until(id, { state: "waiting-for-run-environment", endpoint: SERIAL });
    testbed.adb.steps.length = 0;
    await start();

    expect(await testbed.devices.read(id)).toMatchObject({ state: "connected", endpoint: SERIAL });
    expect(testbed.adb.steps).toEqual(["command -v adb", "adb-key", CONNECT, GETPROP]);
    expect(testbed.adb.pairingInputs).toHaveLength(1);
    expect(testbed.adb.keyInputs[1]).toEqual(testbed.adb.keyInputs[0]);
  });

  it("is Connected before the first check of a start runs", async () => {
    const id = await pairedPhone();
    await stop();

    await check();

    expect(await testbed.devices.read(id)).toMatchObject({ state: "connected" });
    expect(variablesOfCheck(0)).toMatchObject({ ANDROID_SERIAL: SERIAL });
  });

  it("ends as device unplugged, saying to pair it again, when it doesn't answer at the start", async () => {
    const id = await pairedPhone();
    await stop();
    testbed.adb.unreachable.add(SERIAL);

    await start();

    expect(await testbed.devices.read(id)).toMatchObject({
      state: "disconnected",
      disconnectedBecause: "device-unplugged",
      problem: `The phone didn't answer at ${SERIAL}; pair it again.`,
    });
  });

  it("never starts the run environment to connect again", async () => {
    await pairedPhone();
    await stop();
    await testbed.devices.sweep();

    expect(testbed.environmentStart.starts).toEqual([]);
    expect(testbed.environments.environments.isRunning(TASK_ID)).toBe(false);
  });

  it("runs adb disconnect as a user disconnects it", async () => {
    const id = await pairedPhone();

    const device = await testbed.devices.disconnect(id, "by-user", ANN);

    expect(device).toMatchObject({ disconnectedBecause: "by-user", disconnectedBy: ANN });
    await vi.waitFor(() => expect(testbed.adb.steps).toContain(`adb disconnect ${SERIAL}`));
  });

  it("is disconnected as the Task is Done", async () => {
    const id = await pairedPhone();

    await testbed.environments.events.publish(new TaskStateChanged(TASK_ID, "in-progress", "done"));

    expect(await testbed.devices.read(id)).toMatchObject({ disconnectedBecause: "task-ended" });
  });

  it("is disconnected as the Project's Run environment is turned Off", async () => {
    const id = await pairedPhone();

    await testbed.environments.events.publish(
      new ProjectRunEnvironmentChanged(PROJECT_ID, "off", []),
    );

    expect(await testbed.devices.read(id)).toMatchObject({
      disconnectedBecause: "run-environment-turned-off",
    });
  });

  it("waits for the run environment after an Office restart, as a USB device ends as tab closed", async () => {
    const phone = await pairedPhone();
    const usb = await testbed.devices.connect(
      TASK_ID,
      { kind: "android-usb", name: "Pixel 8", deviceKey: "usb:18d1:4ee7:A1" },
      ANN,
    );

    await testbed.devices.sweep();

    expect(await testbed.devices.read(phone)).toMatchObject({
      state: "waiting-for-run-environment",
      endpoint: SERIAL,
    });
    expect(await testbed.devices.read(usb.id)).toMatchObject({
      state: "disconnected",
      disconnectedBecause: "tab-closed",
    });
  });

  it("is ANDROID_SERIAL when it is the one Android phone Connected", async () => {
    await pairedPhone();
    await check();

    expect(variablesOfCheck(0)).toMatchObject({ ANDROID_SERIAL: SERIAL });
  });
});
