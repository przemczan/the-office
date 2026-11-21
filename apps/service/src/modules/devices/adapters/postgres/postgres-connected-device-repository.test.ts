import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import {
  connectingDevice,
  deviceBaudRateSet,
  deviceConnected,
  deviceDisconnected,
  deviceNoticed,
  deviceRoundTripMeasured,
  type ConnectedDevice,
} from "../../domain/connected-device.js";
import { PostgresConnectedDeviceRepository } from "./postgres-connected-device-repository.js";

let app: INestApplication;
let repository: PostgresConnectedDeviceRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresConnectedDeviceRepository],
  }));
  repository = app.get(PostgresConnectedDeviceRepository);
});

afterAll(async () => {
  await app.close();
});

/** A device of this test's own Task and Project, under a key no other file's rows hold. */
function aDevice(taskId: string, deviceKey: string, at: Date, projectId = "shop"): ConnectedDevice {
  return connectingDevice({
    id: randomUUID(),
    taskId,
    projectId,
    kind: "android-usb",
    name: "Pixel 9",
    deviceKey,
    connectedBy: { userId: "user-ann", name: "Ann Lee" },
    connectedAt: at,
  }).device;
}

describe("PostgresConnectedDeviceRepository", () => {
  it("refuses a second open record with the same device key, answering the one that holds it", async () => {
    const key = `usb:${randomUUID()}`;
    const first = aDevice(randomUUID(), key, new Date("2004-01-01T10:00:00Z"));
    const second = aDevice(randomUUID(), key, new Date("2004-01-01T10:01:00Z"));

    expect(await repository.insert(first)).toEqual({});
    expect(await repository.insert(second)).toEqual({ heldBy: first });
    expect(await repository.find(second.id)).toBeUndefined();
  });

  it("takes the same device key again once the record holding it is Disconnected", async () => {
    const key = `usb:${randomUUID()}`;
    const taskId = randomUUID();
    const first = aDevice(taskId, key, new Date("2004-01-02T10:00:00Z"));
    await repository.insert(first);
    await repository.update(first.id, (device) =>
      deviceDisconnected(device, { because: "tab-closed", at: new Date("2004-01-02T10:05:00Z") }),
    );

    const again = aDevice(taskId, key, new Date("2004-01-02T10:06:00Z"));
    expect(await repository.insert(again)).toEqual({});

    expect((await repository.listOfTask(taskId)).map(({ id }) => id)).toEqual([again.id, first.id]);
    expect((await repository.openOfTask(taskId)).map(({ id }) => id)).toEqual([again.id]);
  });

  it("keeps a change, lists the open ones of a Project and of all, and skips a change to nothing", async () => {
    const projectId = `project-${randomUUID()}`;
    const device = aDevice(
      randomUUID(),
      `usb:${randomUUID()}`,
      new Date("2004-01-03T10:00:00Z"),
      projectId,
    );
    await repository.insert(device);

    const changed = await repository.update(device.id, (kept) =>
      deviceConnected(kept, "127.0.0.1:41234"),
    );
    expect(changed?.device.state).toBe("connected");
    expect(
      await repository.update(device.id, (kept) => deviceConnected(kept, "127.0.0.1:41234")),
    ).toBeUndefined();
    expect(await repository.find(device.id)).toEqual({
      ...device,
      state: "connected",
      endpoint: "127.0.0.1:41234",
    });

    expect((await repository.openOfProject(projectId)).map(({ id }) => id)).toEqual([device.id]);
    expect((await repository.allOpen()).map(({ id }) => id)).toContain(device.id);
  });

  it("keeps a serial board's RFC 2217 address, baud rate, round trip and notice", async () => {
    const device = {
      ...aDevice(randomUUID(), `usb:${randomUUID()}`, new Date("2004-01-04T10:00:00Z")),
      kind: "serial-usb" as const,
    };
    await repository.insert(device);
    expect(await repository.find(device.id)).toMatchObject({
      rfc2217Url: null,
      baudRate: null,
      roundTripMs: null,
      notice: null,
    });

    await repository.update(device.id, (kept) =>
      deviceConnected(kept, "/dev/ttyACM0", kept.name, "rfc2217://127.0.0.1:2217"),
    );
    await repository.update(device.id, (kept) => deviceBaudRateSet(kept, 115_200));
    await repository.update(device.id, (kept) => deviceRoundTripMeasured(kept, 312));
    await repository.update(device.id, (kept) => deviceNoticed(kept, "port-busy"));

    expect(await repository.find(device.id)).toEqual({
      ...device,
      state: "connected",
      endpoint: "/dev/ttyACM0",
      rfc2217Url: "rfc2217://127.0.0.1:2217",
      baudRate: 115_200,
      roundTripMs: 312,
      notice: "port-busy",
    });
  });
});
