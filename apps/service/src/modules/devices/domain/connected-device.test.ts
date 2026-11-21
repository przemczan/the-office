import { describe, expect, it } from "vitest";
import {
  alreadyConnectedTo,
  connectedDevicesVariable,
  connectingDevice,
  connectProblemsOf,
  detailsOf,
  deviceBaudRateSet,
  deviceConnected,
  deviceDisconnected,
  deviceNoticed,
  deviceRoundTripMeasured,
  deviceWaiting,
  noticesOf,
  type ConnectedDevice,
  type ConnectedDeviceChange,
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

function board(): ConnectedDevice {
  const change = deviceConnected(
    connectingDevice({
      id: "board-1",
      taskId: "task-1",
      projectId: "shop",
      kind: "serial-usb",
      name: "Arduino Uno",
      deviceKey: "2341:0043:XYZ",
      connectedBy: ANN,
      connectedAt: AT,
    }).device,
    "/dev/ttyACM0",
    "Arduino Uno",
    "rfc2217://127.0.0.1:2217",
  );
  if (change === undefined) throw new Error("Not connected.");
  return change.device;
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
      rfc2217Url: null,
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

  it("keeps a serial board's RFC 2217 address beside its path while Connected, and loses it while Waiting or Disconnected", () => {
    const device = board();
    expect(device).toMatchObject({
      state: "connected",
      endpoint: "/dev/ttyACM0",
      rfc2217Url: "rfc2217://127.0.0.1:2217",
    });
    expect(
      deviceConnected(device, "/dev/ttyACM0", "Arduino Uno", "rfc2217://127.0.0.1:2217"),
    ).toBeUndefined();
    expect(
      changed(deviceConnected(device, "/dev/ttyACM0", "Arduino Uno", "rfc2217://127.0.0.1:2218"))
        .rfc2217Url,
    ).toBe("rfc2217://127.0.0.1:2218");
    expect(changed(deviceWaiting(device))).toMatchObject({ endpoint: null, rfc2217Url: null });
    expect(changed(deviceDisconnected(device, { because: "tab-closed", at: AT }))).toMatchObject({
      endpoint: null,
      rfc2217Url: null,
    });
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

/** The device a change made, its event the change's. */
function changed(change: ConnectedDeviceChange): ConnectedDevice {
  if (change === undefined) throw new Error("Nothing changed.");
  expect(change.event).toBeInstanceOf(ConnectedDeviceChanged);
  return change.device;
}

describe("a serial board's baud rate, round trip and notice", () => {
  it("keeps a new baud rate, and changes nothing for the same one", () => {
    const device = changed(deviceBaudRateSet(connected(), 115_200));
    expect(device.baudRate).toBe(115_200);
    expect(deviceBaudRateSet(device, 115_200)).toBeUndefined();
    expect(changed(deviceBaudRateSet(device, 9600)).baudRate).toBe(9600);
  });

  it("keeps the first round trip, one moved by 25 ms or more, and one crossing 250 ms, rounded", () => {
    const first = changed(deviceRoundTripMeasured(connected(), 40.4));
    expect(first.roundTripMs).toBe(40);
    expect(deviceRoundTripMeasured(first, 64)).toBeUndefined();
    expect(deviceRoundTripMeasured(first, 16)).toBeUndefined();
    const moved = changed(deviceRoundTripMeasured(first, 65));
    expect(moved.roundTripMs).toBe(65);

    const near = changed(deviceRoundTripMeasured(connected(), 240));
    const over = changed(deviceRoundTripMeasured(near, 251));
    expect(over.roundTripMs).toBe(251);
    expect(changed(deviceRoundTripMeasured(over, 250)).roundTripMs).toBe(250);
  });

  it("keeps the helper's latest notice, and changes nothing for the same one", () => {
    const device = changed(deviceNoticed(connected(), "touch-1200"));
    expect(device.notice).toBe("touch-1200");
    expect(deviceNoticed(device, "touch-1200")).toBeUndefined();
    expect(changed(deviceNoticed(device, "no-upload-tool")).notice).toBe("no-upload-tool");
  });

  it("says a slow round trip first, then the helper's notice", () => {
    expect(noticesOf(connected())).toEqual([]);
    const fast = changed(deviceRoundTripMeasured(connected(), 250));
    expect(noticesOf(fast)).toEqual([]);
    const slow = changed(deviceNoticed(changed(deviceRoundTripMeasured(fast, 400)), "touch-1200"));
    expect(noticesOf(slow)).toEqual(["slow-round-trip", "touch-1200"]);
    expect(detailsOf(changed(deviceBaudRateSet(slow, 57_600)))).toEqual([
      "57600 baud",
      "round trip 400 ms",
      "uploads will be slow, each step waiting for the round trip",
      "its 1200-baud touch isn't carried through the browser",
    ]);
    expect(detailsOf(changed(deviceNoticed(connected(), "port-busy")))).toEqual([
      "the board is busy, as one tool at a time can have it open, at its path or its rfc2217:// port",
    ]);
  });

  it("starts the round trip and the notice again at a new helper's READY, keeping the baud rate", () => {
    const told = changed(
      deviceNoticed(
        changed(deviceRoundTripMeasured(changed(deviceBaudRateSet(connected(), 9600)), 30)),
        "no-answer-after-reset",
      ),
    );
    const waiting = changed(deviceWaiting(told));
    expect(waiting).toMatchObject({ baudRate: 9600, roundTripMs: 30 });

    expect(changed(deviceConnected(waiting, "/dev/ttyACM0"))).toMatchObject({
      endpoint: "/dev/ttyACM0",
      baudRate: 9600,
      roundTripMs: null,
      notice: null,
    });
  });

  it("changes nothing for a Disconnected device", () => {
    const ended = changed(deviceDisconnected(connected(), { because: "tab-closed", at: AT }));
    expect(deviceBaudRateSet(ended, 9600)).toBeUndefined();
    expect(deviceRoundTripMeasured(ended, 30)).toBeUndefined();
    expect(deviceNoticed(ended, "touch-1200")).toBeUndefined();
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
      "An Android phone over wireless debugging is paired with its pairing code, not connected through the browser.",
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
      {
        id: "device-1",
        kind: "android-usb",
        name: "Pixel 9",
        endpoint: "127.0.0.1:41234",
        rfc2217Url: null,
      },
    ]);
  });

  it("gives a serial board's RFC 2217 address", () => {
    expect(JSON.parse(connectedDevicesVariable([board()]))).toEqual([
      {
        id: "board-1",
        kind: "serial-usb",
        name: "Arduino Uno",
        endpoint: "/dev/ttyACM0",
        rfc2217Url: "rfc2217://127.0.0.1:2217",
      },
    ]);
  });

  it("is an empty array with none", () => {
    expect(connectedDevicesVariable([])).toBe("[]");
  });
});
