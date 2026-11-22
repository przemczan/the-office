import { describe, expect, it } from "vitest";
import { connectingDevice, deviceDisconnected, type ConnectedDevice } from "./connected-device.js";
import {
  alreadyAmongTheProjects,
  inUseBy,
  NAME_LENGTH,
  ONLY_WIRELESS_HAS_A_PORT,
  PAIRING_CUT_OFF_BY_RESTART,
  pairingCutOff,
  pairingFailed,
  pairingStarted,
  pairingStepped,
  pairingSucceeded,
  projectDeviceGivenBack,
  projectDevicePortChanged,
  projectDeviceRenamed,
  projectDeviceStateOf,
  restStateAfter,
  usbProjectDevice,
  wirelessProjectDevice,
  type ProjectDevice,
  type ProjectDeviceChange,
} from "./project-device.js";
import { ProjectDeviceRefused } from "./project-device-refused.js";

const ANN = { userId: "user-ann", name: "Ann Lee" };
const AT = new Date("2026-11-22T10:00:00.000Z");
const HOLDER = { kind: "task", taskId: "task-1", title: "Install on the phone" } as const;

function phone(): ProjectDevice {
  return wirelessProjectDevice({
    id: "device-1",
    projectId: "shop",
    address: "192.168.1.20",
    deviceKey: "android-wireless:192.168.1.20",
    port: 41_234,
    addedBy: ANN,
    addedAt: AT,
  }).device;
}

function board(): ProjectDevice {
  return usbProjectDevice({
    id: "device-2",
    projectId: "shop",
    kind: "serial-usb",
    name: "  Arduino Uno  ",
    deviceKey: "usb:2341:0043:1",
    addedBy: ANN,
    addedAt: AT,
  }).device;
}

function changed(change: ProjectDeviceChange): ProjectDevice {
  if (change === undefined) throw new Error("Nothing changed.");
  return change.device;
}

function lentRecord(device: ProjectDevice): ConnectedDevice {
  return connectingDevice({
    id: "record-1",
    taskId: HOLDER.taskId,
    projectId: device.projectId,
    projectDeviceId: device.id,
    kind: device.kind,
    name: device.name,
    deviceKey: device.deviceKey,
    connectedBy: ANN,
    connectedAt: AT,
  }).device;
}

function ended(record: ConnectedDevice, because: "by-user" | "device-unplugged"): ConnectedDevice {
  const change = deviceDisconnected(record, { because, at: new Date("2026-11-22T11:00:00.000Z") });
  if (change === undefined) throw new Error("Not ended.");
  return change.device;
}

describe("a Project device at rest", () => {
  it("starts Over USB for a device over USB, its name trimmed, and Not paired for a phone, pairing", () => {
    expect(board()).toMatchObject({ name: "Arduino Uno", state: "over-usb", pairingStep: null });
    expect(phone()).toMatchObject({
      name: "192.168.1.20",
      state: "not-paired",
      pairingStep: "starting-environment",
    });
  });

  it("cuts a long name the browser reports to 60 characters, and refuses an empty one", () => {
    const long = usbProjectDevice({
      ...board(),
      name: "x".repeat(200),
    }).device;
    expect(long.name).toHaveLength(60);
    expect(() => usbProjectDevice({ ...board(), name: "   " })).toThrow(NAME_LENGTH);
  });

  it("is In use while an open record names it, at rest again once it is Disconnected", () => {
    const device = changed(pairingSucceeded(phone(), "Pixel 9"));
    const record = lentRecord(device);

    expect(projectDeviceStateOf(device, undefined)).toBe("paired");
    expect(projectDeviceStateOf(device, record)).toBe("in-use");
    expect(projectDeviceStateOf(device, ended(record, "by-user"))).toBe("paired");
  });
});

describe("a lend's end", () => {
  it("leaves a phone Paired when it connected, Didn't answer when it didn't answer", () => {
    const device = changed(pairingSucceeded(phone(), "Pixel 9"));
    const record = lentRecord(device);

    expect(restStateAfter(device, ended(record, "by-user"), true)).toBe("paired");
    expect(restStateAfter(device, ended(record, "device-unplugged"), false)).toBe("didnt-answer");
    expect(restStateAfter(board(), ended(lentRecord(board()), "device-unplugged"), true)).toBe(
      "over-usb",
    );
    const notPaired = changed(pairingFailed(phone(), "No."));
    expect(restStateAfter(notPaired, ended(lentRecord(notPaired), "by-user"), false)).toBe(
      "not-paired",
    );
  });

  it("keeps its last use: the Task, when and why it ended", () => {
    const device = changed(pairingSucceeded(phone(), "Pixel 9"));
    const given = changed(
      projectDeviceGivenBack(device, ended(lentRecord(device), "device-unplugged"), HOLDER, true),
    );

    expect(given).toMatchObject({
      state: "didnt-answer",
      lastUse: {
        holder: HOLDER,
        endedAt: "2026-11-22T11:00:00.000Z",
        endedBecause: "device-unplugged",
      },
    });
  });
});

describe("changing a Project device", () => {
  it("renames it trimmed, refusing an empty or a too long name", () => {
    expect(changed(projectDeviceRenamed(board(), "  Uno on the desk "))).toMatchObject({
      name: "Uno on the desk",
    });
    expect(projectDeviceRenamed(board(), "Arduino Uno")).toBeUndefined();
    expect(() => projectDeviceRenamed(board(), " ")).toThrow(NAME_LENGTH);
    expect(() => projectDeviceRenamed(board(), "x".repeat(61))).toThrow(ProjectDeviceRefused);
  });

  it("gives a phone a new Port, Paired again after Didn't answer, and refuses one for a board", () => {
    const didntAnswer = {
      ...changed(pairingSucceeded(phone(), "Pixel 9")),
      state: "didnt-answer" as const,
    };

    expect(changed(projectDevicePortChanged(didntAnswer, 40_000))).toMatchObject({
      port: 40_000,
      state: "paired",
    });
    expect(projectDevicePortChanged(didntAnswer, 41_234)).toBeUndefined();
    expect(() => projectDevicePortChanged(board(), 40_000)).toThrow(ONLY_WIRELESS_HAS_A_PORT);
  });
});

describe("pairing a Project device", () => {
  it("steps through the pairing and ends Paired, named by the model while its name was the address", () => {
    const pairing = changed(pairingStepped(phone(), "pairing"));
    expect(pairingStepped(pairing, "pairing")).toBeUndefined();
    const reading = changed(pairingStepped(pairing, "reading-model"));

    expect(changed(pairingSucceeded(reading, "Pixel 9"))).toMatchObject({
      name: "Pixel 9",
      state: "paired",
      pairingStep: null,
      pairingProblem: null,
    });
    const named = { ...reading, name: "Ann's phone" };
    expect(changed(pairingSucceeded(named, "Pixel 9")).name).toBe("Ann's phone");
  });

  it("ends Not paired with why, and refuses a second pairing while one runs", () => {
    expect(changed(pairingFailed(phone(), "adb didn't pair."))).toMatchObject({
      state: "not-paired",
      pairingStep: null,
      pairingProblem: "adb didn't pair.",
    });
    expect(() =>
      pairingStarted(phone(), {
        address: "192.168.1.21",
        deviceKey: "android-wireless:192.168.1.21",
        port: 40_000,
      }),
    ).toThrow("192.168.1.20 is being paired; wait for it to end.");
  });

  it("pairs again at a new address, its name following the address", () => {
    const paired = changed(pairingFailed(phone(), "No."));

    expect(
      changed(
        pairingStarted(paired, {
          address: "192.168.1.21",
          deviceKey: "android-wireless:192.168.1.21",
          port: 40_000,
        }),
      ),
    ).toMatchObject({
      name: "192.168.1.21",
      address: "192.168.1.21",
      deviceKey: "android-wireless:192.168.1.21",
      port: 40_000,
      pairingStep: "starting-environment",
      pairingProblem: null,
    });
  });

  it("is Not paired when a restart cut its pairing off; nothing for one not pairing", () => {
    expect(changed(pairingCutOff(phone()))).toMatchObject({
      state: "not-paired",
      pairingStep: null,
      pairingProblem: PAIRING_CUT_OFF_BY_RESTART,
    });
    expect(pairingCutOff(board())).toBeUndefined();
  });

  it("says who holds it, and that a key is the Project's already, in the UI's words", () => {
    expect(inUseBy({ name: "Pixel 9" }, HOLDER)).toBe("Pixel 9 is in use by Install on the phone.");
    expect(alreadyAmongTheProjects("The phone at 192.168.1.20")).toBe(
      "The phone at 192.168.1.20 is already among this Project's devices.",
    );
  });
});
