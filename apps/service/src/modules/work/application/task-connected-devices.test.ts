import { describe, expect, it } from "vitest";
import { Logger } from "@nestjs/common";
import { TaskConnectedDevices, type TaskConnectedDevice } from "./task-connected-devices.js";

const phone: TaskConnectedDevice = {
  kind: "Android phone over USB",
  name: "Pixel 8",
  state: "Connected",
  connected: true,
  endpoint: "127.0.0.1:41234",
};
const waiting: TaskConnectedDevice = {
  kind: "Android phone over USB",
  name: "Old one",
  state: "Waiting for the run environment",
  connected: false,
  endpoint: null,
};

describe("TaskConnectedDevices", () => {
  it("lists none when no lister is registered", async () => {
    const devices = new TaskConnectedDevices();
    expect(await devices.of("t1")).toEqual([]);
    expect(await devices.linesOf("t1")).toEqual([]);
  });

  it("words each device as a line, with the endpoint when it has one", async () => {
    const devices = new TaskConnectedDevices();
    devices.register(async (taskId) => (taskId === "t1" ? [phone, waiting] : []));
    expect(await devices.linesOf("t1")).toEqual([
      "Android phone over USB «Pixel 8»: Connected, at 127.0.0.1:41234",
      "Android phone over USB «Old one»: Waiting for the run environment",
    ]);
    expect(await devices.of("t2")).toEqual([]);
  });

  it("puts each detail after the endpoint, after a semicolon", async () => {
    const devices = new TaskConnectedDevices();
    devices.register(async () => [
      {
        kind: "Serial board over USB",
        name: "Arduino Uno",
        state: "Connected",
        connected: true,
        endpoint: "/dev/ttyACM0",
        details: ["115200 baud", "round trip 40 ms"],
      },
    ]);
    expect(await devices.linesOf("t1")).toEqual([
      "Serial board over USB «Arduino Uno»: Connected, at /dev/ttyACM0; 115200 baud; round trip 40 ms",
    ]);
  });

  it("leaves out a lister that throws and logs it", async () => {
    const devices = new TaskConnectedDevices();
    devices.register(async () => {
      throw new Error("boom");
    });
    devices.register(async () => [phone]);
    const logged: string[] = [];
    const original = Logger.prototype.error;
    Logger.prototype.error = (message: unknown) => void logged.push(String(message));
    try {
      expect(await devices.of("t1")).toEqual([phone]);
    } finally {
      Logger.prototype.error = original;
    }
    expect(logged.join("\n")).toContain("boom");
  });
});
