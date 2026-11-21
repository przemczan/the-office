import { describe, expect, it } from "vitest";
import {
  alreadyConnectedTo,
  connectedDevicesVariable,
  connectingDevice,
  connectProblemsOf,
  deviceConnected,
  deviceDisconnected,
  deviceWaiting,
  type ConnectedDevice,
} from "./connected-device.js";
import { ConnectedDeviceChanged } from "./connected-device-events.js";

const ANN = { userId: "user-ann", name: "Ann Lee" };
const AT = new Date("2026-11-21T10:00:00.000Z");

function connecting(id = "device-1"): ConnectedDevice {
  return connectingDevice({
    id,
    taskId: "task-1",
    projectId: "shop",
    kind: "android-usb",
    name: "Pixel 9",
    deviceKey: "18d1:4ee7:ABC123",
    connectedBy: ANN,
    connectedAt: AT,
  }).device;
}

function connected(id = "device-1", endpoint = "127.0.0.1:41234"): ConnectedDevice {
  const change = deviceConnected(connecting(id), endpoint);
  if (change === undefined) throw new Error("Not connected.");
  return change.device;
}

describe("a Connected device's transitions", () => {
  it("starts Connecting, with its event", () => {
    const { device, event } = connectingDevice({
      id: "device-1",
      taskId: "task-1",
      projectId: "shop",
      kind: "serial-usb",
      name: "Arduino Uno",
      deviceKey: "2341:0043:XYZ",
      connectedBy: ANN,
      connectedAt: AT,
    });
    expect(device).toMatchObject({
      state: "connecting",
      endpoint: null,
      disconnectedBecause: null,
      connectedBy: ANN,
      connectedAt: AT,
    });
    expect(event).toBeInstanceOf(ConnectedDeviceChanged);
    expect(event).toMatchObject({ taskId: "task-1", deviceId: "device-1" });
  });

  it("goes Connected at an endpoint, and changes nothing at the same endpoint again", () => {
    const device = connected();
    expect(device).toMatchObject({ state: "connected", endpoint: "127.0.0.1:41234" });
    expect(deviceConnected(device, "127.0.0.1:41234")).toBeUndefined();
    expect(deviceConnected(device, "127.0.0.1:5555")?.device.endpoint).toBe("127.0.0.1:5555");
  });

  it("waits from Connecting or Connected, losing its endpoint, and comes back Connected", () => {
    const waiting = deviceWaiting(connected())?.device;
    expect(waiting).toMatchObject({ state: "waiting-for-run-environment", endpoint: null });
    expect(deviceWaiting(connecting())?.device.state).toBe("waiting-for-run-environment");
    expect(waiting && deviceWaiting(waiting)).toBeUndefined();
    expect(waiting && deviceConnected(waiting, "127.0.0.1:1")?.device.state).toBe("connected");
  });

  it("disconnects any open device for good, naming who only when by a user", () => {
    const byUser = deviceDisconnected(connected(), { because: "by-user", by: ANN, at: AT })?.device;
    expect(byUser).toMatchObject({
      state: "disconnected",
      disconnectedBecause: "by-user",
      disconnectedBy: ANN,
      problem: null,
      endpoint: null,
      disconnectedAt: AT,
    });
    const tabClosed = deviceDisconnected(connecting(), { because: "tab-closed", by: ANN, at: AT });
    expect(tabClosed?.device.disconnectedBy).toBeNull();
    const failed = deviceDisconnected(connected(), { because: "error", problem: "Boom.", at: AT });
    expect(failed?.device.problem).toBe("Boom.");

    if (byUser === undefined) throw new Error("Not disconnected.");
    expect(deviceDisconnected(byUser, { because: "tab-closed", at: AT })).toBeUndefined();
    expect(deviceConnected(byUser, "127.0.0.1:1")).toBeUndefined();
    expect(deviceWaiting(byUser)).toBeUndefined();
  });
});

describe("connectProblemsOf", () => {
  it("takes an open Task with the Run environment On and a relayed kind", () => {
    expect(
      connectProblemsOf({ taskState: "in-progress", runEnvironmentOn: true, kind: "android-usb" }),
    ).toEqual([]);
  });

  it("gives every reason at once, in the UI's words", () => {
    expect(
      connectProblemsOf({ taskState: "done", runEnvironmentOn: false, kind: "android-wireless" }),
    ).toEqual([
      "The Task is Done.",
      "The Project's Run environment is Off.",
      "An Android phone over wireless debugging can't be connected yet: pairing over the network isn't built.",
    ]);
    expect(
      connectProblemsOf({ taskState: "dropped", runEnvironmentOn: true, kind: "serial-usb" }),
    ).toEqual(["The Task is Dropped."]);
  });

  it("names the Task that holds the device", () => {
    expect(alreadyConnectedTo({ id: "task-2", title: "Flash the board" })).toBe(
      "Already connected to the Task «Flash the board».",
    );
  });
});

describe("connectedDevicesVariable", () => {
  it("lists the Connected devices only, as JSON", () => {
    const waiting = deviceWaiting(connected("device-2"))?.device;
    expect(
      JSON.parse(
        connectedDevicesVariable([
          connected("device-1"),
          connecting("device-3"),
          ...(waiting ? [waiting] : []),
        ]),
      ),
    ).toEqual([
      { id: "device-1", kind: "android-usb", name: "Pixel 9", endpoint: "127.0.0.1:41234" },
    ]);
  });

  it("is an empty array with none", () => {
    expect(connectedDevicesVariable([])).toBe("[]");
  });
});
