import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { ProjectFeaturesChanged, ProjectRunEnvironmentChanged } from "../../projects/index.js";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../../run-environments/index.fixtures.js";
import { RunEnvironmentRefused, type TaskInWorktree } from "../../run-environments/index.js";
import { DeviceRelayLink } from "../adapters/websocket/device-relay-link.js";
import {
  devicesTestbed,
  FakeRelaySocket,
  HELPER_ENDPOINT,
  PROJECT_ID,
  type DevicesTestbed,
} from "../devices.fixtures.js";
import { heldDevice, type RunHolder } from "../domain/connected-device.js";
import { ConnectedDeviceChanged } from "../domain/connected-device-events.js";
import { ProjectDeviceChanged } from "../domain/project-device-events.js";
import {
  PAIRING_CUT_OFF_BY_RUN_ENVIRONMENT_OFF,
  PAIRING_CUT_OFF_BY_SWITCH,
  PAIRING_ENVIRONMENT_DIDNT_START,
} from "../domain/project-device.js";
import { ProjectDeviceRefused } from "../domain/project-device-refused.js";
import { ADB_STEP_TIMEOUT_MS } from "./adb-in-run-environment.js";
import { HELD_RELAY_WAIT_MS } from "./connected-devices.js";
import type { DeviceHold, DeviceHoldRequest, HoldingEnvironment } from "./device-holds.js";
import {
  PAIRING_ENVIRONMENT_START_TIMEOUT_MS,
  type WirelessDeviceToAdd,
} from "./project-devices.js";

const ANN = { userId: "user-ann", name: "Ann Lee" };
const TASK_ID = "00000000-0000-4000-8000-00000000c001";
const PHONE: WirelessDeviceToAdd = {
  kind: "android-wireless",
  address: "192.168.1.20",
  port: 41_234,
  pairingPort: 37_000,
  pairingCode: "482913",
};
const SERIAL = "192.168.1.20:41234";
const USB_PHONE = { kind: "android-usb", name: "Pixel 9", deviceKey: "usb:18d1:4ee7:A1" } as const;
const ACTION_RUN: RunHolder = {
  kind: "action-run",
  actionRunId: "00000000-0000-4000-8000-00000000c101",
  name: "Install on my phone",
};
const TEST_INSTANCE: RunHolder = {
  kind: "test-instance",
  testInstanceId: "00000000-0000-4000-8000-00000000c201",
  name: "Install on a device",
};
const ALL_ON = {
  "test-targets": true,
  "github-issues": true,
  "run-environment": true,
  actions: true,
};

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

/** The run's environment: here the Task's, started, which the hold reaches only through it. */
async function runEnvironment(): Promise<HoldingEnvironment> {
  await testbed.environments.environments.prepare(
    task,
    join(testbed.environments.folder, `prepare-${task.taskId}.log`),
  );
  return {
    label: "the Action run under test",
    checksUser: "1000:1000",
    attach: (attachment) => testbed.environments.environments.attach(TASK_ID, attachment),
  };
}

function request(
  projectDeviceId: string,
  environment: HoldingEnvironment,
  given: Partial<DeviceHoldRequest> = {},
): DeviceHoldRequest {
  return {
    projectId: PROJECT_ID,
    projectDeviceId,
    holder: ACTION_RUN,
    startedBy: ANN,
    environment,
    ...given,
  };
}

async function pairedPhone(): Promise<string> {
  const { device } = await testbed.projectDevices.add(PROJECT_ID, PHONE, ANN);
  await testbed.projectDevices.settled();
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

function held(hold: DeviceHold): Extract<DeviceHold, { held: true }> {
  if (!hold.held) throw new Error(`Not held: ${hold.problem}`);
  return hold;
}

/** The record the tab named `relayTab` learns of, as `connected-device.changed` tells it. */
async function recordForTab(relayTab: string): Promise<string> {
  let id: string | undefined;
  await vi.waitFor(() => {
    id = events.find(
      (event): event is ConnectedDeviceChanged =>
        event instanceof ConnectedDeviceChanged &&
        event.relayTab === relayTab &&
        event.state === "connecting",
    )?.deviceId;
    expect(id).toBeDefined();
  });
  return id ?? "";
}

describe("holding a Project device for a run", () => {
  it("holds a paired phone over wireless debugging, connecting with the Project's key, then lets go of it as run ended", async () => {
    const id = await pairedPhone();
    const environment = await runEnvironment();
    const pairs = testbed.adb.pairingInputs.length;
    events.length = 0;

    const hold = held(await testbed.projectDevices.hold(request(id, environment)));

    expect(hold).toMatchObject({ deviceName: "Pixel 9", serial: SERIAL });
    expect(hold.variables).toEqual([
      {
        name: "OFFICE_CONNECTED_DEVICES",
        value: JSON.stringify([
          {
            id: hold.holdId,
            kind: "android-wireless",
            name: "Pixel 9",
            endpoint: SERIAL,
            rfc2217Url: null,
          },
        ]),
      },
      { name: "ANDROID_SERIAL", value: SERIAL },
    ]);
    expect(testbed.adb.pairingInputs).toHaveLength(pairs);
    expect(testbed.adb.steps.slice(-2)).toEqual([
      `adb connect ${SERIAL}`,
      `adb -s ${SERIAL} shell getprop ro.product.model`,
    ]);
    expect(await testbed.devices.read(hold.holdId)).toMatchObject({
      taskId: null,
      runHolder: ACTION_RUN,
      state: "connected",
      everConnected: true,
      connectedBy: ANN,
    });
    expect(await testbed.projectDevices.read(id)).toMatchObject({
      state: "in-use",
      inUseBy: ACTION_RUN,
    });
    expect((await testbed.projectDeviceLines.of(PROJECT_ID))[0]).toMatchObject({
      state: "In use by Install on my phone",
      androidPhone: true,
    });
    expect(
      events.some(
        (event) =>
          event instanceof ConnectedDeviceChanged &&
          event.deviceId === hold.holdId &&
          event.taskId === null &&
          event.runHolder === ACTION_RUN,
      ),
    ).toBe(true);
    // A run's hold is none of the Task's devices.
    expect(await testbed.devices.list(TASK_ID)).toEqual([]);
    expect(await testbed.devices.open()).toEqual([]);

    await testbed.projectDevices.letGo(hold.holdId);
    await testbed.projectDevices.letGo(hold.holdId);

    expect(await testbed.devices.read(hold.holdId)).toMatchObject({
      state: "disconnected",
      disconnectedBecause: "run-ended",
    });
    await vi.waitFor(() => expect(testbed.adb.steps.at(-1)).toBe(`adb disconnect ${SERIAL}`));
    expect(await testbed.projectDevices.read(id)).toMatchObject({
      state: "paired",
      inUseBy: null,
      device: { lastUse: { holder: ACTION_RUN, endedBecause: "run-ended" } },
    });
  });

  it("answers not held, the phone Didn't answer, when it doesn't answer at its address and Port", async () => {
    const id = await pairedPhone();
    const environment = await runEnvironment();
    testbed.adb.unreachable.add(SERIAL);

    const hold = await testbed.projectDevices.hold(request(id, environment));

    expect(hold).toMatchObject({ held: false, problem: "Pixel 9 didn't answer." });
    expect(await testbed.projectDevices.read(id)).toMatchObject({
      state: "didnt-answer",
      device: { lastUse: { holder: ACTION_RUN, endedBecause: "device-unplugged" } },
    });
  });

  it("holds an Android phone over USB through the starting tab's relay, the helper in the run's environment", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, USB_PHONE, ANN);
    const environment = await runEnvironment();
    const relayTab = randomUUID();

    const holding = testbed.projectDevices.hold(
      request(device.id, environment, { holder: TEST_INSTANCE, relayTab }),
    );
    const recordId = await recordForTab(relayTab);
    expect(await testbed.devices.read(recordId)).toMatchObject({
      state: "connecting",
      relayTab,
      runHolder: TEST_INSTANCE,
    });
    await testbed.devices.relayOpened(
      recordId,
      new DeviceRelayLink(new FakeRelaySocket(), testbed.environments.schedule),
    );
    const hold = held(await holding);

    expect(hold).toMatchObject({ holdId: recordId, serial: HELPER_ENDPOINT });
    expect(hold.variables.map(({ name }) => name)).toEqual([
      "OFFICE_CONNECTED_DEVICES",
      "ANDROID_SERIAL",
    ]);
    expect(testbed.adb.steps).toContain(`adb connect ${HELPER_ENDPOINT}`);
    expect(
      testbed.runtime.attached.some(({ attachment }) => attachment.arguments[1] === "relay"),
    ).toBe(true);

    await testbed.projectDevices.letGo(hold.holdId);

    expect(await testbed.devices.read(hold.holdId)).toMatchObject({
      disconnectedBecause: "run-ended",
    });
    await vi.waitFor(() =>
      expect(testbed.adb.steps.at(-1)).toBe(`adb disconnect ${HELPER_ENDPOINT}`),
    );
    expect(await testbed.projectDevices.read(device.id)).toMatchObject({
      state: "over-usb",
      device: { lastUse: { holder: TEST_INSTANCE, endedBecause: "run-ended" } },
    });
  });

  it("holds a serial board through its relay, at its endpoint, with no ANDROID_SERIAL", async () => {
    const board = {
      kind: "serial-usb",
      name: "Arduino Uno",
      deviceKey: "usb:2341:0043:1",
    } as const;
    const { device } = await testbed.projectDevices.add(PROJECT_ID, board, ANN);
    const environment = await runEnvironment();
    const relayTab = randomUUID();

    const holding = testbed.projectDevices.hold(request(device.id, environment, { relayTab }));
    await testbed.devices.relayOpened(
      await recordForTab(relayTab),
      new DeviceRelayLink(new FakeRelaySocket(), testbed.environments.schedule),
    );
    const hold = held(await holding);

    expect(hold.variables.map(({ name }) => name)).toEqual(["OFFICE_CONNECTED_DEVICES"]);
    expect(
      testbed.runtime.attached.find(({ attachment }) => attachment.arguments[1] === "pty")
        ?.attachment,
    ).toMatchObject({ user: "0:0", arguments: expect.arrayContaining(["1000:1000"]) as unknown });
    await testbed.projectDevices.letGo(hold.holdId);
  });

  it("answers not held, in 2.13's words, when no tab opens the device's relay in time", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, USB_PHONE, ANN);
    const environment = await runEnvironment();
    const relayTab = randomUUID();

    const holding = testbed.projectDevices.hold(request(device.id, environment, { relayTab }));
    const recordId = await recordForTab(relayTab);
    await testbed.environments.schedule.advanceBy(HELD_RELAY_WAIT_MS);

    expect(await holding).toEqual({
      held: false,
      holdId: recordId,
      problem: "Pixel 9 isn't plugged into this computer, or the browser can't open it.",
    });
    expect(await testbed.devices.read(recordId)).toMatchObject({
      disconnectedBecause: "device-unplugged",
    });
    expect((await testbed.projectDevices.read(device.id)).state).toBe("over-usb");
  });

  it("stops waiting and lets go as run ended when the run's signal aborts", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, USB_PHONE, ANN);
    const environment = await runEnvironment();
    const relayTab = randomUUID();
    const controller = new AbortController();

    const holding = testbed.projectDevices.hold(
      request(device.id, environment, { relayTab, signal: controller.signal }),
    );
    const recordId = await recordForTab(relayTab);
    controller.abort();

    expect(await holding).toMatchObject({ held: false, holdId: recordId });
    expect(await testbed.devices.read(recordId)).toMatchObject({
      disconnectedBecause: "run-ended",
    });
  });
});

describe("one environment at a time", () => {
  it("refuses a hold naming each kind of holder: a Task, an Action run, a test instance", async () => {
    const id = await pairedPhone();
    const environment = await runEnvironment();

    const lent = await testbed.projectDevices.lend(TASK_ID, id, ANN);
    const byTask = await refusal(testbed.projectDevices.hold(request(id, environment)));
    expect(byTask.reasons).toEqual(["Pixel 9 is in use by Install on the phone."]);
    expect(byTask.holder).toEqual({ kind: "task", taskId: TASK_ID, title: "Install on the phone" });
    await testbed.devices.disconnect(lent.id, "by-user", ANN);

    for (const holder of [ACTION_RUN, TEST_INSTANCE]) {
      const hold = held(await testbed.projectDevices.hold(request(id, environment, { holder })));
      const other: RunHolder = TEST_INSTANCE === holder ? ACTION_RUN : TEST_INSTANCE;
      const refused = await refusal(
        testbed.projectDevices.hold(request(id, environment, { holder: other })),
      );
      expect(refused.reasons).toEqual([`Pixel 9 is in use by ${holder.name}.`]);
      expect(refused.holder).toEqual(holder);
      expect((await refusal(testbed.projectDevices.checkFree(PROJECT_ID, id))).holder).toEqual(
        holder,
      );
      expect((await refusal(testbed.projectDevices.lend(TASK_ID, id, ANN))).reasons).toEqual([
        `Pixel 9 is in use by ${holder.name}.`,
      ]);
      // A Task's own pairing of the same phone is refused naming the run.
      await expect(testbed.devices.pair(TASK_ID, PHONE, ANN)).rejects.toMatchObject({
        reasons: [`192.168.1.20 is in use by ${holder.name}.`],
      });
      await testbed.projectDevices.letGo(hold.holdId);
    }

    expect(await testbed.projectDevices.checkFree(PROJECT_ID, id)).toEqual({
      id,
      name: "Pixel 9",
      kind: "android-wireless",
    });
  });

  it("refuses a hold while the Run environment isn't On, Connected devices is off, or the device isn't the Project's", async () => {
    const id = await pairedPhone();
    const environment = await runEnvironment();

    testbed.settings.off.add(PROJECT_ID);
    expect((await refusal(testbed.projectDevices.checkFree(PROJECT_ID, id))).reasons).toEqual([
      "Needs Run environment On: a device is paired and used in the run environment.",
    ]);
    testbed.settings.off.clear();
    testbed.deviceFeature.off.add(PROJECT_ID);
    expect((await refusal(testbed.projectDevices.hold(request(id, environment)))).reasons).toEqual([
      `Connected devices are switched off for «${PROJECT_ID}».`,
    ]);
    testbed.deviceFeature.off.clear();
    expect(
      (
        await refusal(
          testbed.projectDevices.hold({ ...request(id, environment), projectId: "other" }),
        )
      ).reasons,
    ).toEqual(["The device isn't one of this Project's devices."]);
    expect(
      (await refusal(testbed.projectDevices.checkFree(PROJECT_ID, randomUUID()))).holder,
    ).toBeUndefined();
  });
});

describe("a hold's lifecycle", () => {
  it("ends a hold as the Run environment is turned Off, or Connected devices switched off, telling the run", async () => {
    const id = await pairedPhone();
    const environment = await runEnvironment();
    const first = held(await testbed.projectDevices.hold(request(id, environment)));
    events.length = 0;

    await testbed.environments.events.publish(
      new ProjectRunEnvironmentChanged(PROJECT_ID, "off", []),
    );

    expect(await testbed.devices.read(first.holdId)).toMatchObject({
      disconnectedBecause: "run-environment-turned-off",
    });
    expect(
      events.some(
        (event) =>
          event instanceof ConnectedDeviceChanged &&
          event.runHolder === ACTION_RUN &&
          event.state === "disconnected",
      ),
    ).toBe(true);
    expect((await testbed.projectDevices.read(id)).device.lastUse).toMatchObject({
      holder: ACTION_RUN,
      endedBecause: "run-environment-turned-off",
    });

    const second = held(await testbed.projectDevices.hold(request(id, environment)));
    await testbed.environments.events.publish(
      new ProjectFeaturesChanged(PROJECT_ID, { ...ALL_ON, "connected-devices": false }),
    );
    expect((await testbed.devices.read(second.holdId)).disconnectedBecause).toBe(
      "connected-devices-switched-off",
    );
  });

  it("ends every run's hold the last run left as run ended at the startup sweep", async () => {
    const id = await pairedPhone();
    const { device } = heldDevice({
      id: randomUUID(),
      runHolder: TEST_INSTANCE,
      projectId: PROJECT_ID,
      projectDeviceId: id,
      kind: "android-wireless",
      name: "Pixel 9",
      deviceKey: "android-wireless:192.168.1.20",
      relayTab: null,
      connectedBy: ANN,
      connectedAt: new Date(),
    });
    await testbed.repository.insert({ ...device, state: "connected", endpoint: SERIAL });

    await testbed.devices.sweep();

    expect(await testbed.devices.read(device.id)).toMatchObject({
      state: "disconnected",
      disconnectedBecause: "run-ended",
    });
    expect(await testbed.projectDevices.read(id)).toMatchObject({
      state: "paired",
      device: { lastUse: { holder: TEST_INSTANCE, endedBecause: "run-ended" } },
    });
  });

  it("keeps whether a lend ever connected on its record, across a restart", async () => {
    const id = await pairedPhone();
    await runEnvironment();
    const record = await testbed.projectDevices.lend(TASK_ID, id, ANN);
    await vi.waitFor(async () => {
      expect((await testbed.devices.read(record.id)).state).toBe("connected");
    });
    // At rest it said Didn't answer before this use; the use's connect answered.
    await testbed.projectDeviceRepository.update(id, (device) => ({
      device: { ...device, state: "didnt-answer" },
      event: new ProjectDeviceChanged(device.projectId, device.id),
    }));

    // A new instance over the same rows, which remembers nothing of the first.
    const restarted = await devicesTestbed(
      testbed.runtime,
      testbed.environments,
      testbed.repository,
      testbed.projectDeviceRepository,
    );
    await restarted.devices.disconnect(record.id, "by-user", ANN);

    expect((await restarted.projectDevices.read(id)).state).toBe("paired");
  });
});

describe("a pairing cut off", () => {
  it("is Not paired, its environment removed, when the Run environment turns Off or Connected devices is switched off", async () => {
    testbed.adb.pairHangs = true;
    const { device } = await testbed.projectDevices.add(PROJECT_ID, PHONE, ANN);
    await vi.waitFor(() => expect(testbed.adb.pairingInputs).toHaveLength(1));

    await testbed.environments.events.publish(
      new ProjectRunEnvironmentChanged(PROJECT_ID, "off", []),
    );

    expect((await testbed.projectDevices.read(device.id)).device).toMatchObject({
      state: "not-paired",
      pairingStep: null,
      pairingProblem: PAIRING_CUT_OFF_BY_RUN_ENVIRONMENT_OFF,
    });
    await testbed.environments.schedule.advanceBy(ADB_STEP_TIMEOUT_MS);
    await testbed.projectDevices.settled();
    expect((await testbed.projectDevices.read(device.id)).device.pairingProblem).toBe(
      PAIRING_CUT_OFF_BY_RUN_ENVIRONMENT_OFF,
    );
    expect(
      [...testbed.runtime.projects.keys()].filter((name) => name.includes("-pairing-")),
    ).toEqual([]);

    await testbed.projectDevices.pair(device.id, PHONE);
    await vi.waitFor(() => expect(testbed.adb.pairingInputs).toHaveLength(2));
    await testbed.environments.events.publish(
      new ProjectFeaturesChanged(PROJECT_ID, { ...ALL_ON, "connected-devices": false }),
    );
    expect((await testbed.projectDevices.read(device.id)).device.pairingProblem).toBe(
      PAIRING_CUT_OFF_BY_SWITCH,
    );
    await testbed.environments.schedule.advanceBy(ADB_STEP_TIMEOUT_MS);
  });

  it("is Not paired when its environment doesn't start in time, the start stopped through its signal", async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(testbed.environments.pairingEnvironments, "start").mockImplementation(
      (start) =>
        new Promise((_resolve, reject) => {
          signal = start.signal;
          start.signal?.addEventListener("abort", () => {
            reject(new RunEnvironmentRefused(["The pairing was stopped."]));
          });
        }),
    );
    const { device } = await testbed.projectDevices.add(PROJECT_ID, PHONE, ANN);
    await vi.waitFor(() => expect(signal).toBeDefined());

    await testbed.environments.schedule.advanceBy(PAIRING_ENVIRONMENT_START_TIMEOUT_MS);
    await testbed.projectDevices.settled();

    expect(signal?.aborted).toBe(true);
    expect((await testbed.projectDevices.read(device.id)).device).toMatchObject({
      state: "not-paired",
      pairingStep: null,
      pairingProblem: PAIRING_ENVIRONMENT_DIDNT_START,
    });
  });
});
