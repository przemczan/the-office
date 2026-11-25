import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { ProjectFeaturesChanged, ProjectRunEnvironmentChanged } from "../../projects/index.js";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../../run-environments/index.fixtures.js";
import type { TaskInWorktree } from "../../run-environments/index.js";
import { devicesTestbed, PROJECT_ID, type DevicesTestbed } from "../devices.fixtures.js";
import { ProjectDeviceChanged } from "../domain/project-device-events.js";
import {
  NEEDS_RUN_ENVIRONMENT_ON,
  PAIRING_CUT_OFF_BY_RESTART,
  wirelessProjectDevice,
  type ProjectDevicePairingStep,
} from "../domain/project-device.js";
import { ProjectDeviceRefused } from "../domain/project-device-refused.js";
import { ADB_STEP_TIMEOUT_MS } from "./adb-in-run-environment.js";
import type { WirelessDeviceToAdd } from "./project-devices.js";

const ANN = { userId: "user-ann", name: "Ann Lee" };
const TASK_ID = "00000000-0000-4000-8000-00000000e001";
const OTHER_TASK_ID = "00000000-0000-4000-8000-00000000e002";
const CODE = "482913";
const PHONE: WirelessDeviceToAdd = {
  kind: "android-wireless",
  address: "192.168.1.20",
  port: 41_234,
  pairingPort: 37_000,
  pairingCode: CODE,
};
const SERIAL = "192.168.1.20:41234";
const PAIR = "adb pair 192.168.1.20:37000";
const CONNECT = `adb connect ${SERIAL}`;
const GETPROP = `adb -s ${SERIAL} shell getprop ro.product.model`;
const BOARD = { kind: "serial-usb", name: "Arduino Uno", deviceKey: "usb:2341:0043:1" } as const;

let testbed: DevicesTestbed<RunEnvironmentsTestbed>;
let task: TaskInWorktree;
let events: DomainEvent[];

beforeEach(async () => {
  const runtime = new ScriptedContainerRuntime();
  testbed = await devicesTestbed(runtime, await runEnvironmentsTestbed(runtime));
  task = await testbed.addTask(TASK_ID, "Install on the phone");
  events = [];
  testbed.environments.events.subscribeToEveryEvent((event) => {
    events.push(event);
  });
});

afterEach(async () => {
  await testbed.projectDevices.settled();
  vi.restoreAllMocks();
  await rm(testbed.environments.folder, { recursive: true, force: true });
});

function start(of: TaskInWorktree = task): Promise<void> {
  return testbed.environments.environments.prepare(
    of,
    join(testbed.environments.folder, `prepare-${of.taskId}.log`),
  );
}

/** The pairing environments the runtime still has. */
function pairingEnvironments(): string[] {
  return [...testbed.runtime.projects.keys()].filter((name) => name.includes("-pairing-"));
}

async function pairedPhone(): Promise<string> {
  const { device } = await testbed.projectDevices.add(PROJECT_ID, PHONE, ANN);
  await testbed.projectDevices.settled();
  expect((await testbed.projectDevices.read(device.id)).state).toBe("paired");
  return device.id;
}

async function refusal(work: Promise<unknown>): Promise<ProjectDeviceRefused> {
  const error = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof ProjectDeviceRefused)) throw new Error(`Not refused: ${String(error)}`);
  return error;
}

/** Whether a `ProjectDeviceChanged` of the Project was published for the device since `events` emptied. */
function projectDeviceChangedTold(deviceId: string): boolean {
  return events.some(
    (event) =>
      event instanceof ProjectDeviceChanged &&
      event.deviceId === deviceId &&
      event.projectId === PROJECT_ID,
  );
}

async function filesUnder(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("adding a Project device", () => {
  it("adds a device over USB by its device key, Over USB, with nothing connected", async () => {
    const seen = await testbed.projectDevices.add(PROJECT_ID, BOARD, ANN);

    expect(seen).toMatchObject({
      state: "over-usb",
      inUseBy: null,
      device: {
        projectId: PROJECT_ID,
        kind: "serial-usb",
        name: "Arduino Uno",
        deviceKey: "usb:2341:0043:1",
        address: null,
        port: null,
        addedBy: ANN,
        lastUse: null,
      },
    });
    expect((await testbed.projectDevices.list(PROJECT_ID)).map(({ device }) => device.id)).toEqual([
      seen.device.id,
    ]);
    expect(testbed.runtime.attached).toEqual([]);
    expect(projectDeviceChangedTold(seen.device.id)).toBe(true);
  });

  it("refuses a device key already among the Project's", async () => {
    await testbed.projectDevices.add(PROJECT_ID, BOARD, ANN);

    const refused = await refusal(
      testbed.projectDevices.add(PROJECT_ID, { ...BOARD, name: "Another Uno" }, ANN),
    );

    expect(refused.reasons).toEqual(["Another Uno is already among this Project's devices."]);
    expect(refused.holder).toBeUndefined();
  });

  it("refuses adding and pairing while the Run environment isn't On, or Connected devices is off", async () => {
    testbed.settings.off.add(PROJECT_ID);
    expect((await refusal(testbed.projectDevices.add(PROJECT_ID, BOARD, ANN))).reasons).toEqual([
      NEEDS_RUN_ENVIRONMENT_ON,
    ]);
    expect((await refusal(testbed.projectDevices.add(PROJECT_ID, PHONE, ANN))).reasons).toEqual([
      NEEDS_RUN_ENVIRONMENT_ON,
    ]);

    testbed.settings.off.clear();
    testbed.deviceFeature.off.add(PROJECT_ID);
    expect((await refusal(testbed.projectDevices.add(PROJECT_ID, PHONE, ANN))).reasons).toEqual([
      `Connected devices are switched off for «${PROJECT_ID}».`,
    ]);
    expect(testbed.pairingDefinitions.exported).toEqual([]);
  });

  it("refuses an address the run environment can't reach, starting nothing", async () => {
    const refused = await refusal(
      testbed.projectDevices.add(PROJECT_ID, { ...PHONE, address: "127.0.0.1" }, ANN),
    );

    expect(refused.reasons[0]).toContain("«127.0.0.1» is a loopback address");
    expect(await testbed.projectDevices.list(PROJECT_ID)).toEqual([]);
    expect(testbed.pairingDefinitions.exported).toEqual([]);
  });
});

describe("pairing a Project device in a pairing environment", () => {
  it("pairs in its own environment, steps told as they pass, then removes the environment", async () => {
    const steps: (ProjectDevicePairingStep | null)[] = [];
    testbed.environments.events.subscribe(ProjectDeviceChanged, async ({ deviceId }) => {
      steps.push((await testbed.projectDeviceRepository.find(deviceId))?.pairingStep ?? null);
    });

    const seen = await testbed.projectDevices.add(PROJECT_ID, PHONE, ANN);

    expect(seen).toMatchObject({
      state: "not-paired",
      device: {
        kind: "android-wireless",
        name: "192.168.1.20",
        address: "192.168.1.20",
        port: 41_234,
        deviceKey: "android-wireless:192.168.1.20",
        pairingStep: "starting-environment",
      },
    });
    await testbed.projectDevices.settled();
    expect(await testbed.projectDevices.read(seen.device.id)).toMatchObject({
      state: "paired",
      device: { name: "Pixel 9", pairingStep: null, pairingProblem: null },
    });
    expect(steps).toEqual(["starting-environment", "pairing", "reading-model", null]);
    expect(testbed.adb.steps).toEqual([
      "command -v adb",
      "adb-key",
      "adb kill-server",
      PAIR,
      CONNECT,
      GETPROP,
      `adb disconnect ${SERIAL}`,
    ]);
    expect(testbed.adb.pairingInputs.map(String)).toEqual([`${CODE}\n`]);
    // In the pairing environment, never a Task's, which isn't started.
    expect(new Set(testbed.runtime.attached.map(({ projectName }) => projectName))).toEqual(
      new Set([expect.stringContaining(`-pairing-${seen.device.id}`)]),
    );
    expect(testbed.environmentStart.starts).toEqual([]);
    expect(pairingEnvironments()).toEqual([]);
    expect(testbed.runtime.steps).toContainEqual(
      expect.stringMatching(new RegExp(`^down .*-pairing-${seen.device.id} with built images$`)),
    );
    expect(testbed.pairingDefinitions.removed).toEqual(testbed.pairingDefinitions.exported);
  });

  it("ends Not paired in adb's words when adb refuses, the environment removed", async () => {
    testbed.adb.pairAnswer = {
      output: "Failed: Wrong password or connection was dropped.\n",
      exitCode: 1,
    };
    const { device } = await testbed.projectDevices.add(PROJECT_ID, PHONE, ANN);
    await testbed.projectDevices.settled();

    expect(await testbed.projectDevices.read(device.id)).toMatchObject({
      state: "not-paired",
      device: {
        name: "192.168.1.20",
        pairingStep: null,
        pairingProblem:
          "adb didn't pair with the phone at 192.168.1.20:37000: Failed: Wrong password or connection was dropped.",
      },
    });
    expect(testbed.adb.steps).not.toContain(CONNECT);
    expect(pairingEnvironments()).toEqual([]);
    // Still named by its address, which the Project's record for Agents never shows.
    expect(await testbed.projectDeviceLines.of(PROJECT_ID)).toEqual([
      {
        id: device.id,
        kind: "Android phone over wireless debugging",
        name: "Not named yet",
        state: "Not paired",
        androidPhone: true,
      },
    ]);
  });

  it("ends Not paired when adb pair doesn't answer within its step's time", async () => {
    testbed.adb.pairHangs = true;
    const { device } = await testbed.projectDevices.add(PROJECT_ID, PHONE, ANN);
    await vi.waitFor(() => expect(testbed.adb.pairingInputs).toHaveLength(1));

    await testbed.environments.schedule.advanceBy(ADB_STEP_TIMEOUT_MS);
    await testbed.projectDevices.settled();

    const { device: kept } = await testbed.projectDevices.read(device.id);
    expect(kept).toMatchObject({ pairingStep: null, state: "not-paired" });
    expect(kept.pairingProblem).toMatch(/pair it again/);
    expect(pairingEnvironments()).toEqual([]);
  });

  it("ends Not paired with why when its environment can't start, or the definition can't be read", async () => {
    testbed.runtime.failing.add("up");
    const first = await testbed.projectDevices.add(PROJECT_ID, PHONE, ANN);
    await testbed.projectDevices.settled();

    expect((await testbed.projectDevices.read(first.device.id)).device.pairingProblem).toMatch(
      /couldn't start/,
    );
    expect(pairingEnvironments()).toEqual([]);
    expect(testbed.pairingDefinitions.removed).toEqual(testbed.pairingDefinitions.exported);

    testbed.pairingDefinitions.problems = ["main of Shop has no .devcontainer/ folder at 1a2b3c4."];
    await testbed.projectDevices.pair(first.device.id, PHONE);
    await testbed.projectDevices.settled();
    expect((await testbed.projectDevices.read(first.device.id)).device).toMatchObject({
      state: "not-paired",
      pairingProblem: "main of Shop has no .devcontainer/ folder at 1a2b3c4.",
    });
  });

  it("removes the environment and the definition when the pairing throws", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    vi.spyOn(testbed.adbKeys, "find").mockRejectedValue(new Error("The database is down."));
    const { device } = await testbed.projectDevices.add(PROJECT_ID, PHONE, ANN);
    await testbed.projectDevices.settled();

    expect((await testbed.projectDevices.read(device.id)).device).toMatchObject({
      state: "not-paired",
      pairingStep: null,
      pairingProblem: "The database is down.",
    });
    expect(pairingEnvironments()).toEqual([]);
    expect(testbed.pairingDefinitions.removed).toEqual(testbed.pairingDefinitions.exported);
  });

  it("keeps the pairing code out of every log line, record, event, response and command line", async () => {
    const logged: string[] = [];
    for (const level of ["log", "warn", "error", "debug", "verbose", "fatal"] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...parts: unknown[]) => {
        logged.push(parts.map(String).join(" "));
      });
    }
    const added = await testbed.projectDevices.add(PROJECT_ID, PHONE, ANN);
    await testbed.projectDevices.settled();
    testbed.adb.pairAnswer = { output: "Failed: Wrong password.\n", exitCode: 1 };
    const again = await testbed.projectDevices.pair(added.device.id, PHONE);
    await testbed.projectDevices.settled();

    expect(testbed.adb.pairingInputs.map(String)).toEqual([`${CODE}\n`, `${CODE}\n`]);
    const files = await filesUnder(testbed.environments.folder);
    const written = await Promise.all(files.map((file) => readFile(file, "utf8")));
    const seen = JSON.stringify([
      testbed.runtime.attached.map(({ attachment }) => attachment),
      testbed.runtime.steps,
      logged,
      written,
      events,
      added,
      again,
      [
        ...(testbed.projectDeviceRepository as unknown as { devices: Map<string, unknown> })
          .devices,
      ],
      await testbed.projectDevices.list(PROJECT_ID),
      await testbed.projectDeviceLines.of(PROJECT_ID),
    ]);
    expect(seen).not.toContain(CODE);
  });

  it("refuses pairing again while it is in use, naming the holder, and while a pairing runs", async () => {
    const id = await pairedPhone();
    await testbed.projectDevices.lend(TASK_ID, id, ANN);

    const held = await refusal(testbed.projectDevices.pair(id, PHONE));
    expect(held.reasons).toEqual(["Pixel 9 is in use by Install on the phone."]);
    expect(held.holder).toEqual({ kind: "task", taskId: TASK_ID, title: "Install on the phone" });

    const { device } = await testbed.projectDevices.add(
      PROJECT_ID,
      { ...PHONE, address: "192.168.1.30" },
      ANN,
    );
    expect((await refusal(testbed.projectDevices.pair(device.id, PHONE))).reasons).toEqual([
      "192.168.1.30 is being paired; wait for it to end.",
    ]);
  });

  it("refuses pairing again at an address another of the Project's devices has", async () => {
    await pairedPhone();
    const { device } = await testbed.projectDevices.add(
      PROJECT_ID,
      { ...PHONE, address: "192.168.1.30" },
      ANN,
    );
    await testbed.projectDevices.settled();

    expect((await refusal(testbed.projectDevices.pair(device.id, PHONE))).reasons).toEqual([
      "The phone at 192.168.1.20 is already among this Project's devices.",
    ]);
  });
});

describe("renaming, a new Port and removing", () => {
  it("renames a device and gives a phone a new Port, needing no pairing", async () => {
    const id = await pairedPhone();
    const steps = testbed.adb.steps.length;

    expect(
      await testbed.projectDevices.change(id, { name: " Ann's Pixel ", port: 40_000 }),
    ).toMatchObject({ state: "paired", device: { name: "Ann's Pixel", port: 40_000 } });
    expect(testbed.adb.steps).toHaveLength(steps);
  });

  it("refuses a Port for a device over USB, and a name too long", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, BOARD, ANN);

    expect(
      (await refusal(testbed.projectDevices.change(device.id, { port: 40_000 }))).reasons,
    ).toEqual(["Only a phone over wireless debugging has a Port."]);
    expect(
      (await refusal(testbed.projectDevices.change(device.id, { name: "x".repeat(61) }))).reasons,
    ).toEqual(["A device's name is 1 to 60 characters."]);
  });

  it("removes a device at rest, and refuses one in use, naming the holder", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, BOARD, ANN);
    const record = await testbed.projectDevices.lend(TASK_ID, device.id, ANN);

    const held = await refusal(testbed.projectDevices.remove(device.id));
    expect(held.reasons).toEqual(["Arduino Uno is in use by Install on the phone."]);
    expect(held.holder).toMatchObject({ kind: "task", taskId: TASK_ID });

    await testbed.devices.disconnect(record.id, "by-user", ANN);
    await testbed.projectDevices.remove(device.id);
    expect(await testbed.projectDevices.list(PROJECT_ID)).toEqual([]);
    // Its earlier use stays on the Task.
    expect((await testbed.devices.list(TASK_ID))[0]).toMatchObject({ projectDeviceId: device.id });
  });
});

describe("lending a Project device to a Task", () => {
  it("lends a device over USB Connecting, In use by the Task, and gives it back as it is disconnected", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, BOARD, ANN);
    events.length = 0;

    const record = await testbed.projectDevices.lend(TASK_ID, device.id, ANN);

    expect(record).toMatchObject({
      taskId: TASK_ID,
      projectDeviceId: device.id,
      kind: "serial-usb",
      name: "Arduino Uno",
      deviceKey: "usb:2341:0043:1",
      state: "connecting",
      connectedBy: ANN,
    });
    expect(await testbed.projectDevices.read(device.id)).toMatchObject({
      state: "in-use",
      inUseBy: { kind: "task", taskId: TASK_ID, title: "Install on the phone" },
    });
    expect(projectDeviceChangedTold(device.id)).toBe(true);
    expect(await testbed.projectDeviceLines.of(PROJECT_ID)).toEqual([
      {
        id: device.id,
        kind: "Serial board over USB",
        name: "Arduino Uno",
        state: "In use by Install on the phone",
        androidPhone: false,
      },
    ]);

    events.length = 0;
    await testbed.devices.disconnect(record.id, "by-user", ANN);

    expect(await testbed.projectDevices.read(device.id)).toMatchObject({
      state: "over-usb",
      inUseBy: null,
      device: {
        lastUse: {
          holder: { kind: "task", taskId: TASK_ID, title: "Install on the phone" },
          endedBecause: "by-user",
        },
      },
    });
    expect(projectDeviceChangedTold(device.id)).toBe(true);
  });

  it("connects a paired phone at once with the Project's key, never pairing, and leaves it Paired", async () => {
    const id = await pairedPhone();
    await start();
    const pairs = testbed.adb.pairingInputs.length;

    const record = await testbed.projectDevices.lend(TASK_ID, id, ANN);

    expect(record).toMatchObject({ state: "waiting-for-run-environment", endpoint: SERIAL });
    await vi.waitFor(async () => {
      expect(await testbed.devices.read(record.id)).toMatchObject({
        state: "connected",
        endpoint: SERIAL,
      });
    });
    expect(testbed.adb.pairingInputs).toHaveLength(pairs);
    expect(testbed.adb.steps.slice(-2)).toEqual([CONNECT, GETPROP]);

    await testbed.devices.disconnect(record.id, "by-user", ANN);
    expect(await testbed.projectDevices.read(id)).toMatchObject({
      state: "paired",
      device: { lastUse: { endedBecause: "by-user" } },
    });
  });

  it("waits for the run environment, and is Didn't answer when the phone doesn't answer at its start", async () => {
    const id = await pairedPhone();
    const record = await testbed.projectDevices.lend(TASK_ID, id, ANN);
    expect(record.state).toBe("waiting-for-run-environment");
    testbed.adb.unreachable.add(SERIAL);

    await start();

    expect(await testbed.devices.read(record.id)).toMatchObject({
      state: "disconnected",
      disconnectedBecause: "device-unplugged",
    });
    expect(await testbed.projectDevices.read(id)).toMatchObject({
      state: "didnt-answer",
      device: { lastUse: { endedBecause: "device-unplugged" } },
    });
  });

  it("refuses a second holder, naming the Task that holds it, across a lend and a Task's own pairing", async () => {
    const id = await pairedPhone();
    await testbed.addTask(OTHER_TASK_ID, "Test the checkout");
    await testbed.projectDevices.lend(OTHER_TASK_ID, id, ANN);

    const lentElsewhere = await refusal(testbed.projectDevices.lend(TASK_ID, id, ANN));
    expect(lentElsewhere.reasons).toEqual(["Pixel 9 is in use by Test the checkout."]);
    expect(lentElsewhere.holder).toEqual({
      kind: "task",
      taskId: OTHER_TASK_ID,
      title: "Test the checkout",
    });
    // The Task pairing the same phone itself is refused as a connect is, naming the other Task.
    await expect(testbed.devices.pair(TASK_ID, PHONE, ANN)).rejects.toMatchObject({
      otherTask: { id: OTHER_TASK_ID, title: "Test the checkout" },
    });
  });

  it("refuses lending a phone the Task holds already through its own pairing", async () => {
    const id = await pairedPhone();
    await start();
    const own = await testbed.devices.pair(TASK_ID, PHONE, ANN);
    await vi.waitFor(async () => {
      expect((await testbed.devices.read(own.id)).state).toBe("connected");
    });

    const refused = await refusal(testbed.projectDevices.lend(TASK_ID, id, ANN));
    expect(refused.reasons).toEqual(["Pixel 9 is in use by Install on the phone."]);
    expect(refused.holder).toMatchObject({ kind: "task", taskId: TASK_ID });
  });

  it("refuses lending while the Run environment is Off, Connected devices is off, or it pairs", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, BOARD, ANN);
    testbed.settings.off.add(PROJECT_ID);
    expect((await refusal(testbed.projectDevices.lend(TASK_ID, device.id, ANN))).reasons).toEqual([
      "The Project's Run environment is Off.",
    ]);
    testbed.settings.off.clear();
    testbed.deviceFeature.off.add(PROJECT_ID);
    expect((await refusal(testbed.projectDevices.lend(TASK_ID, device.id, ANN))).reasons).toEqual([
      `Connected devices are switched off for «${PROJECT_ID}».`,
    ]);
    testbed.deviceFeature.off.clear();

    testbed.adb.pairHangs = true;
    const phone = await testbed.projectDevices.add(PROJECT_ID, PHONE, ANN);
    expect(
      (await refusal(testbed.projectDevices.lend(TASK_ID, phone.device.id, ANN))).reasons,
    ).toEqual(["192.168.1.20 is being paired; wait for it to end."]);
    await vi.waitFor(() => expect(testbed.adb.pairingInputs).toHaveLength(1));
    await testbed.environments.schedule.advanceBy(ADB_STEP_TIMEOUT_MS);
  });

  it("ends every lend as the Run environment is turned Off or Connected devices switched off, and gives each back", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, BOARD, ANN);
    const first = await testbed.projectDevices.lend(TASK_ID, device.id, ANN);

    await testbed.environments.events.publish(
      new ProjectRunEnvironmentChanged(PROJECT_ID, "off", []),
    );

    expect(await testbed.devices.read(first.id)).toMatchObject({
      disconnectedBecause: "run-environment-turned-off",
    });
    expect(await testbed.projectDevices.read(device.id)).toMatchObject({
      state: "over-usb",
      device: { lastUse: { endedBecause: "run-environment-turned-off" } },
    });

    const second = await testbed.projectDevices.lend(TASK_ID, device.id, ANN);
    await testbed.environments.events.publish(
      new ProjectFeaturesChanged(PROJECT_ID, {
        "connected-devices": false,
        "test-targets": true,
        "github-issues": true,
        "run-environment": true,
        actions: true,
      }),
    );
    expect((await testbed.devices.read(second.id)).disconnectedBecause).toBe(
      "connected-devices-switched-off",
    );
    expect((await testbed.projectDevices.read(device.id)).state).toBe("over-usb");
  });
});

describe("the startup sweep", () => {
  it("removes the pairing environments left and sets a pairing cut off to Not paired", async () => {
    const { device } = wirelessProjectDevice({
      id: "00000000-0000-4000-8000-00000000f001",
      projectId: PROJECT_ID,
      address: "192.168.1.20",
      deviceKey: "android-wireless:192.168.1.20",
      port: 41_234,
      addedBy: ANN,
      addedAt: new Date(),
    });
    await testbed.projectDeviceRepository.insert({ ...device, pairingStep: "pairing" });
    const sweep = vi.spyOn(testbed.environments.pairingEnvironments, "sweep");

    await testbed.projectDevices.sweep();

    expect(sweep).toHaveBeenCalledOnce();
    expect((await testbed.projectDevices.read(device.id)).device).toMatchObject({
      state: "not-paired",
      pairingStep: null,
      pairingProblem: PAIRING_CUT_OFF_BY_RESTART,
    });
  });
});
